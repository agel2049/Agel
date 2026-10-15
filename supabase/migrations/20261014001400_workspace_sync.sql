-- Explicit, resumable uploads. Reservations remain accounted for after network errors.
create table app.sync_assets (
 owner_id uuid not null references auth.users(id), project_id uuid not null references public.projects(id),
 local_id text not null check(local_id ~ '^[A-Za-z0-9_-]{1,100}$'),asset_id uuid not null references public.assets(id),
 declared_bytes bigint not null, declared_mime text not null, primary key(owner_id,project_id,local_id)
);
revoke all on app.sync_assets from public,anon,authenticated;
create table app.workspace_settings(project_id uuid primary key references public.projects(id) on delete cascade,settings jsonb not null default '{}');
revoke all on app.workspace_settings from public,anon,authenticated;

create function public.begin_sync_asset(p_project uuid,p_local_id text,p_bucket text,p_kind text,p_filename text,p_bytes bigint,p_mime text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assets;j app.sync_assets;v jsonb;allowed text[];
begin
 if not app.can_edit_project(p_project) then raise exception 'No tienes permiso' using errcode='42501';end if;
 if p_local_id !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'Identificador local inválido';end if;
 select allowed_mime_types into allowed from storage.buckets where id=p_bucket;
 if p_mime is null or (allowed is not null and not(p_mime=any(allowed))) then raise exception 'Tipo de archivo no permitido';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_project::text||p_local_id,14));
 select * into j from app.sync_assets where owner_id=auth.uid() and project_id=p_project and local_id=p_local_id;
 if j.asset_id is not null then
  select * into r from public.assets where id=j.asset_id;
  if r.bucket<>p_bucket or r.kind<>p_kind or j.declared_bytes<>p_bytes or j.declared_mime<>p_mime then raise exception 'El archivo local cambió; crea un identificador nuevo';end if;
 else
  v:=public.reserve_upload(p_project,p_bucket,p_kind,p_filename,p_bytes,p_mime);
  insert into app.sync_assets values(auth.uid(),p_project,p_local_id,(v->>'asset_id')::uuid,p_bytes,p_mime);
  select * into r from public.assets where id=(v->>'asset_id')::uuid;
 end if;
 return jsonb_build_object('asset_id',r.id,'bucket',r.bucket,'path',r.path,'status',r.status);
end $$;

create function public.complete_sync_asset(p_asset uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.assets;meta jsonb;allowed text[];cap bigint;expected bigint;
begin
 perform pg_advisory_xact_lock(20261013,12);
 select * into r from public.assets where id=p_asset for update;
 if r.id is null or not app.can_edit_project(r.project_id) then raise exception 'No tienes permiso' using errcode='42501';end if;
 if not exists(select 1 from app.sync_assets where asset_id=p_asset and owner_id=auth.uid()) then raise exception 'Reserva ajena' using errcode='42501';end if;
 select metadata into meta from storage.objects where bucket_id=r.bucket and name=r.path;
 if meta is null then return jsonb_build_object('asset_id',r.id,'bucket',r.bucket,'path',r.path,'status','uploading');end if;
 select file_size_limit,allowed_mime_types into cap,allowed from storage.buckets where id=r.bucket;
 select declared_bytes into expected from app.sync_assets where asset_id=r.id;
 if coalesce((meta->>'size')::bigint,0)<=0 or (meta->>'size')::bigint>cap or (meta->>'size')::bigint<>expected
 or coalesce(meta->>'mimetype','')<>r.mime or (allowed is not null and not(r.mime=any(allowed))) then raise exception 'El archivo real no coincide con la reserva';end if;
 if r.status='uploading' then perform public.complete_upload(r.id);elsif r.status<>'ready' then raise exception 'Reserva no disponible';end if;
 return jsonb_build_object('asset_id',r.id,'bucket',r.bucket,'path',r.path,'status','ready','bytes',(meta->>'size')::bigint);
end $$;

create function public.save_workspace_snapshot(p_project uuid,p_snapshot jsonb,p_base_revision int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v jsonb;s jsonb;ids uuid[];pending jsonb;next_pending jsonb;parent uuid;count_before int;rowdata public.spaces;
begin
 if not app.can_edit_project(p_project) then raise exception 'No tienes permiso' using errcode='42501';end if;
 if p_snapshot#>>'{tree,project,id}' is distinct from p_project::text then raise exception 'Proyecto incorrecto';end if;
 if jsonb_typeof(p_snapshot->'spaces')<>'array' or jsonb_array_length(p_snapshot->'spaces')>5000 then raise exception 'Catálogo inválido';end if;
 if p_snapshot::text ~ 'agel-local:|blob:|data:' then raise exception 'Hay archivos locales pendientes de sincronización';end if;
 select array_agg((e->>'id')::uuid) into ids from jsonb_array_elements(p_snapshot->'spaces') e;
 if cardinality(ids)<>(select count(distinct e) from unnest(ids) e) then raise exception 'Espacios duplicados';end if;
 if app.ids_owned_elsewhere('spaces',coalesce(ids,'{}'),p_project) then raise exception 'Espacio de otro proyecto' using errcode='42501';end if;
 for s in select * from jsonb_array_elements(p_snapshot->'spaces') loop
  if s->>'parent_id' is not null and not((s->>'parent_id')::uuid=any(coalesce(ids,'{}'))) then raise exception 'Padre ausente del catálogo';end if;
 end loop;
 v:=public.save_project_tree(p_project,p_snapshot->'tree',p_base_revision);
 pending:=p_snapshot->'spaces';
 while jsonb_array_length(pending)>0 loop
  count_before:=jsonb_array_length(pending);next_pending:='[]';
  for s in select * from jsonb_array_elements(pending) loop
   parent:=(s->>'parent_id')::uuid;
   -- A parent must have been processed in this snapshot; existing rows alone do not bypass cycle detection.
   if parent is not null and exists(select 1 from jsonb_array_elements(pending) x where x->>'id'=parent::text) then next_pending:=next_pending||jsonb_build_array(s);continue;end if;
   select * into rowdata from jsonb_populate_record(null::public.spaces,s);
   if exists(select 1 from unnest(coalesce(rowdata.scene_ids,'{}')) sc where not exists(select 1 from public.scenes where id=sc and project_id=p_project)) then raise exception 'Escena de otro proyecto';end if;
   insert into public.spaces(id,project_id,parent_id,kind,name,code,position,summary,area_m2,bedrooms,bathrooms,parking,price,currency,show_price,availability,attributes,scene_ids,plan_url,gallery)
   values(rowdata.id,p_project,parent,rowdata.kind,rowdata.name,coalesce(rowdata.code,''),coalesce(rowdata.position,0),coalesce(rowdata.summary,''),rowdata.area_m2,rowdata.bedrooms,rowdata.bathrooms,rowdata.parking,rowdata.price,coalesce(rowdata.currency,'MXN'),coalesce(rowdata.show_price,false),coalesce(rowdata.availability,'no_aplica'),coalesce(rowdata.attributes,'{}'),coalesce(rowdata.scene_ids,'{}'),rowdata.plan_url,coalesce(rowdata.gallery,'[]'))
   on conflict(id) do update set parent_id=excluded.parent_id,kind=excluded.kind,name=excluded.name,code=excluded.code,position=excluded.position,summary=excluded.summary,area_m2=excluded.area_m2,bedrooms=excluded.bedrooms,bathrooms=excluded.bathrooms,parking=excluded.parking,price=excluded.price,currency=excluded.currency,show_price=excluded.show_price,availability=excluded.availability,attributes=excluded.attributes,scene_ids=excluded.scene_ids,plan_url=excluded.plan_url,gallery=excluded.gallery;
  end loop;
  if jsonb_array_length(next_pending)=count_before then raise exception 'El catálogo contiene un ciclo';end if;pending:=next_pending;
 end loop;
 delete from public.spaces where project_id=p_project and not(id=any(coalesce(ids,'{}')));
 update public.projects set showroom=coalesce(p_snapshot->'showroom','{}'),kind=coalesce(p_snapshot#>>'{tree,project,kind}',kind) where id=p_project;
 return v;
end $$;
revoke all on function public.begin_sync_asset(uuid,text,text,text,text,bigint,text),public.complete_sync_asset(uuid),public.save_workspace_snapshot(uuid,jsonb,int) from public,anon;
grant execute on function public.begin_sync_asset(uuid,text,text,text,text,bigint,text),public.complete_sync_asset(uuid),public.save_workspace_snapshot(uuid,jsonb,int) to authenticated;
