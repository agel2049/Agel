begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $preflight$ begin
if (select count(*) from app.deployment_migrations)<>12 then raise exception 'Actualizar cancelado: revisa el historial; esta actualización exige exactamente las primeras 12 migraciones';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000100' and sha256='d16cb870e5429592813c50da09f60958df11ed21991aeb5be0248e7647bc6972') then raise exception 'Historial distinto para 20261013000100';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000200' and sha256='1106428f74d72cf38900fbcc36aec9e78d5ae6e723e0826391c51c803aaefd7d') then raise exception 'Historial distinto para 20261013000200';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000300' and sha256='1e42c8197b7c3b053e9fdad003d1cc0c0183c64e4dec013ce33a791fb4038edc') then raise exception 'Historial distinto para 20261013000300';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000400' and sha256='94458f775acb14442a9a9207055b007ae30a8e42276e61bce16c95ccc92e1117') then raise exception 'Historial distinto para 20261013000400';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000500' and sha256='6f8e7cf9a7fdba6bce682f482ecf96323b617e4451ea7ca1f1844f630610878f') then raise exception 'Historial distinto para 20261013000500';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000600' and sha256='6d1e432982d7abb5013f9cebeb4f2e39c301dd3ab6ca76cdf3611db36e9cfd48') then raise exception 'Historial distinto para 20261013000600';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000700' and sha256='99d5834f48d83c2affbd911d2ab2114f742aae24e937e3c5abfc516cca123f0c') then raise exception 'Historial distinto para 20261013000700';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000800' and sha256='090c424388d55008515e6304f5855a88b88f7c27bc4c365109426abc0b76a35b') then raise exception 'Historial distinto para 20261013000800';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013000900' and sha256='cd8f801f496a7fa7fa7ea4392cd1797f9218a222a873ce6345d2bd3549664fa9') then raise exception 'Historial distinto para 20261013000900';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013001000' and sha256='16043dc729666efd868d1c4373ddba3a6a06cdb42615ad46f826164f3bc3e1eb') then raise exception 'Historial distinto para 20261013001000';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013001100' and sha256='526a4a0f7d35471bfcfa57e57c504d83044d8f4ca8be04de907443240f4caa67') then raise exception 'Historial distinto para 20261013001100';end if;
if not exists(select 1 from app.deployment_migrations where version='20261013001200' and sha256='6a49fe4024d8bbd66e87f5329998c50054de057ff6fe765670084de4474ff134') then raise exception 'Historial distinto para 20261013001200';end if;
end $preflight$;

-- 20261014001300_catalogo_importacion.sql
-- Atomic catalog import; old CSVs remain building → unit, floors are optional.
create or replace function public.import_catalog(p_project uuid,p_catalog jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g jsonb;l jsonb;u jsonb;d jsonb;groups jsonb:='{}';levels jsonb:='{}';
  gid uuid;lid uuid;sid uuid;parent uuid;matches uuid[];created int:=0;updated int:=0;
begin
 if not app.can_edit_project(p_project) then raise exception 'No tienes permiso' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project::text,13));
 if jsonb_typeof(p_catalog->'groups') is distinct from 'array' or jsonb_typeof(p_catalog->'levels') is distinct from 'array'
    or jsonb_typeof(p_catalog->'units') is distinct from 'array' then raise exception 'Formato de catálogo inválido';end if;
 if jsonb_array_length(p_catalog->'units')>2000 then raise exception 'Máximo 2000 unidades';end if;
 if jsonb_array_length(coalesce(p_catalog->'problems','[]'))>0 then raise exception 'Corrige los problemas del CSV antes de importar';end if;
 if exists(select 1 from jsonb_array_elements(p_catalog->'units') x where nullif(trim(x->'data'->>'code'),'') is not null
   group by lower(trim(x->'data'->>'code')) having count(*)>1) then raise exception 'Clave duplicada dentro del CSV';end if;
 for g in select value from jsonb_array_elements(p_catalog->'groups') loop
  if nullif(trim(g->>'key'),'') is null or char_length(trim(g->>'name')) not between 1 and 120 then raise exception 'Edificio inválido';end if;
  select array_agg(id) into matches from public.spaces where project_id=p_project and parent_id is null and kind='edificio' and lower(trim(name))=lower(trim(g->>'name'));
  if coalesce(cardinality(matches),0)>1 then raise exception 'Hay edificios duplicados: %',g->>'name';end if;
  gid:=matches[1];if gid is null then insert into public.spaces(project_id,kind,name,position) values(p_project,'edificio',trim(g->>'name'),(select count(*)::int from jsonb_object_keys(groups))) returning id into gid;end if;
  groups:=groups||jsonb_build_object(g->>'key',gid);
 end loop;
 for l in select value from jsonb_array_elements(p_catalog->'levels') loop
  gid:=(groups->>(l->>'groupKey'))::uuid;
  if gid is null or char_length(trim(l->>'name')) not between 1 and 120 then raise exception 'Nivel sin edificio o nombre válido';end if;
  select array_agg(id) into matches from public.spaces where project_id=p_project and parent_id=gid and kind='nivel' and lower(trim(name))=lower(trim(l->>'name'));
  if coalesce(cardinality(matches),0)>1 then raise exception 'Hay niveles duplicados en este edificio';end if;
  lid:=matches[1];if lid is null then insert into public.spaces(project_id,parent_id,kind,name,position) values(p_project,gid,'nivel',trim(l->>'name'),(select count(*)::int from jsonb_object_keys(levels))) returning id into lid;end if;
  levels:=levels||jsonb_build_object(l->>'key',lid);
 end loop;
 for u in select value from jsonb_array_elements(p_catalog->'units') loop
  d:=u->'data';parent:=null;
  if nullif(u->>'levelKey','') is not null then parent:=(levels->>(u->>'levelKey'))::uuid;
   if parent is null then raise exception 'Nivel de unidad inexistente';end if;
  elsif nullif(u->>'groupKey','') is not null then parent:=(groups->>(u->>'groupKey'))::uuid;
   if parent is null then raise exception 'Edificio de unidad inexistente';end if;
  end if;
  if char_length(trim(d->>'name')) not between 1 and 120 or char_length(coalesce(d->>'code',''))>40 then raise exception 'Nombre o clave inválidos';end if;
  select array_agg(id) into matches from public.spaces where project_id=p_project and nullif(trim(d->>'code'),'') is not null and lower(trim(code))=lower(trim(d->>'code'));
  if coalesce(cardinality(matches),0)>1 then raise exception 'Clave existente ambigua: %',d->>'code';end if;
  sid:=matches[1];
  if sid is null then insert into public.spaces(project_id,parent_id,kind,name,code,position) values(p_project,parent,'unidad',trim(d->>'name'),coalesce(d->>'code',''),created+updated) returning id into sid;created:=created+1;
  else updated:=updated+1;end if;
  update public.spaces set parent_id=parent,kind='unidad',name=trim(d->>'name'),code=coalesce(d->>'code',''),
   area_m2=(d->>'area_m2')::numeric,bedrooms=(d->>'bedrooms')::int,bathrooms=(d->>'bathrooms')::numeric,parking=(d->>'parking')::int,
   price=(d->>'price')::numeric,currency=coalesce(d->>'currency','MXN'),show_price=coalesce((d->>'show_price')::boolean,false),
   availability=coalesce(d->>'availability','disponible') where id=sid and project_id=p_project;
 end loop;
 return jsonb_build_object('created',created,'updated',updated);
end $$;
revoke all on function public.import_catalog(uuid,jsonb) from public,anon;
grant execute on function public.import_catalog(uuid,jsonb) to authenticated;

insert into app.deployment_migrations(version,name,sha256) values('20261014001300','catalogo_importacion','b1057a6ff500708c84eb57e3129266f6cfc96ba505e9c11e5e495305e3229257');

-- 20261014001400_workspace_sync.sql
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

insert into app.deployment_migrations(version,name,sha256) values('20261014001400','workspace_sync','ae4f83a180709090c2250d79c86f0b87704bc9b558edde0629673f81651c0bd3');

-- 20261014001500_showroom_experience.sql
-- Public data is a whitelist; private model configuration never enters snapshots.
create function app.pick_json(v jsonb,keys text[]) returns jsonb
language sql immutable set search_path='' as $$select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(v)='object' then v else '{}' end) where key=any(keys)$$;
create function app.orient(a jsonb,b jsonb,c jsonb) returns numeric language sql immutable set search_path='' as $$
select ((b->>0)::numeric-(a->>0)::numeric)*((c->>1)::numeric-(a->>1)::numeric)-((b->>1)::numeric-(a->>1)::numeric)*((c->>0)::numeric-(a->>0)::numeric)$$;
create function app.segments_cross(a jsonb,b jsonb,c jsonb,d jsonb) returns boolean language sql immutable set search_path='' as $$
select app.orient(a,b,c)*app.orient(a,b,d)<=0 and app.orient(c,d,a)*app.orient(c,d,b)<=0
and greatest(least((a->>0)::numeric,(b->>0)::numeric),least((c->>0)::numeric,(d->>0)::numeric))<=least(greatest((a->>0)::numeric,(b->>0)::numeric),greatest((c->>0)::numeric,(d->>0)::numeric))
and greatest(least((a->>1)::numeric,(b->>1)::numeric),least((c->>1)::numeric,(d->>1)::numeric))<=least(greatest((a->>1)::numeric,(b->>1)::numeric),greatest((c->>1)::numeric,(d->>1)::numeric))$$;
create function app.validate_showroom_experience(p_project uuid,p_showroom jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare views jsonb:=coalesce(p_showroom->'views','[]');v jsonb;r jsonb;sp jsonb;point jsonb;t jsonb;e jsonb;pts jsonb;ids text[];scope uuid[];space uuid;i int;j int;n int;area numeric;
begin
 if jsonb_typeof(views)<>'array' or jsonb_array_length(views)>256 then raise exception 'Máximo 256 vistas';end if;
 select array_agg(x->>'id') into ids from jsonb_array_elements(views) x;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Vistas duplicadas';end if;
 for v in select * from jsonb_array_elements(views) loop
  if v->>'id' !~ '^[A-Za-z0-9_-]{1,40}$' or v->>'id' is null then raise exception 'ID de vista inválido';end if;
  if coalesce(v->>'image','') !~ '^https://[^/@[:space:]]+[^[:space:]]*$' or v->>'image' ~ '^https://[^/]*@' then raise exception 'Imagen local o dirección inválida';end if;
  if coalesce((v->>'w')::numeric,1600) not between 1 and 20000 or coalesce((v->>'h')::numeric,900) not between 1 and 20000 then raise exception 'Dimensiones inválidas';end if;
  space:=nullif(v->>'spaceId','')::uuid;
  if space is not null and not exists(select 1 from public.spaces where id=space and project_id=p_project) then raise exception 'Espacio inexistente';end if;
  if space is null then select array_agg(id) into scope from public.scenes where project_id=p_project and pano_url is not null;
  else
   with recursive descendants as(select id,parent_id,scene_ids,array[id] path from public.spaces where id=space and project_id=p_project
    union all select s.id,s.parent_id,s.scene_ids,d.path||s.id from public.spaces s join descendants d on s.parent_id=d.id where s.project_id=p_project and not(s.id=any(d.path)))
   select array_agg(distinct sid) into scope from descendants d cross join unnest(d.scene_ids) sid join public.scenes sc on sc.id=sid and sc.project_id=p_project and sc.pano_url is not null;
  end if;
  if jsonb_array_length(coalesce(v->'regions','[]'))>300 or jsonb_array_length(coalesce(v->'spots','[]'))>100 then raise exception 'Demasiadas zonas o escenas';end if;
  for r in select * from jsonb_array_elements(coalesce(v->'regions','[]')) loop
   if r->>'space' is not null and not exists(select 1 from public.spaces where id=(r->>'space')::uuid and project_id=p_project) then raise exception 'Zona de otro proyecto';end if;
   if coalesce((r->>'radius')::numeric,0) not between 0 and 2 then raise exception 'Radio inválido';end if;
   pts:=r->'points';n:=jsonb_array_length(pts);if n not between 3 and 80 then raise exception 'Zona requiere 3–80 vértices';end if;
   area:=0;
   for i in 0..n-1 loop
    point:=pts->i;if jsonb_array_length(point)<>2 or (point->>0)::numeric not between 0 and 100 or (point->>1)::numeric not between 0 and 100 or point->>0 is null or point->>1 is null then raise exception 'Punto fuera de imagen';end if;
    area:=area+(point->>0)::numeric*(pts->((i+1)%n)->>1)::numeric-(pts->((i+1)%n)->>0)::numeric*(point->>1)::numeric;
    for j in i+1..n-1 loop
     if point=pts->j then raise exception 'Vértice repetido';end if;
     if j<>i+1 and not(i=0 and j=n-1) and app.segments_cross(point,pts->((i+1)%n),pts->j,pts->((j+1)%n)) then raise exception 'Zona con intersección';end if;
    end loop;
   end loop;
   if area=0 then raise exception 'Zona sin área';end if;
   t:=r->'target';
   if jsonb_typeof(t)='object' then
    if t->>'type'='view' and not(t->>'id'=any(coalesce(ids,'{}'))) then raise exception 'Destino de vista inexistente';
    elsif t->>'type'='space' and not exists(select 1 from public.spaces where id=(t->>'id')::uuid and project_id=p_project) then raise exception 'Destino de espacio inexistente';
    elsif t->>'type'='scene' and not((t->>'id')::uuid=any(coalesce(scope,'{}'))) then raise exception 'Escena fuera de alcance';
    elsif t->>'type' not in ('view','space','scene') or t->>'type' is null then raise exception 'Destino inválido';end if;
   end if;
  end loop;
  for sp in select * from jsonb_array_elements(coalesce(v->'spots','[]')) loop
   if not(coalesce(sp->>'sceneId',sp->>'scene')::uuid=any(coalesce(scope,'{}'))) or coalesce((sp->>'x')::numeric,-1) not between 0 and 100 or coalesce((sp->>'y')::numeric,-1) not between 0 and 100 then raise exception 'Punto 360 fuera de alcance';end if;
  end loop;
 end loop;
 e:=coalesce(p_showroom->'experience','{}');
 if e->>'version'='1' then
  if not(coalesce(e->>'facadeViewId','')=any(coalesce(ids,'{}'))) then raise exception 'Fachada inexistente';end if;
  if e->>'entryTargetViewId' is not null and (e->>'entryTargetViewId'=e->>'facadeViewId' or not(e->>'entryTargetViewId'=any(coalesce(ids,'{}')))) then raise exception 'Entrada debe apuntar a otra planta';end if;
  if coalesce((e#>>'{entrance,x}')::numeric,50) not between 0 and 100 or coalesce((e#>>'{entrance,y}')::numeric,70) not between 0 and 100 then raise exception 'Entrada fuera de imagen';end if;
 end if;
 return p_showroom;
end $$;

create function app.public_showroom(sr jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;v jsonb;
begin
 result:=app.pick_json(sr,array['tagline','description','highlights','amenities','disclaimer','area_label']);
 result:=result||jsonb_build_object('location',app.pick_json(sr->'location',array['address','map_url','notes']),'contact',app.pick_json(sr->'contact',array['cta','whatsapp','email','hours']),'seo',app.pick_json(sr->'seo',array['title','description']),
 'model3d',app.pick_json(sr->'model3d',array['url','poster','title']),'opening',app.pick_json(sr->'opening',array['enabled','video','videoUrl','poster','title','subtitle','sub','button','btn','btnText']),
 'experience',app.pick_json(sr->'experience',array['version','facadeViewId','entryTargetViewId'])||jsonb_build_object('entrance',app.pick_json(sr#>'{experience,entrance}',array['x','y','label'])));
 select coalesce(jsonb_agg(case when jsonb_typeof(x)='string' then jsonb_build_object('url',x) else app.pick_json(x,array['url','caption']) end),'[]') into v from jsonb_array_elements(coalesce(sr->'gallery','[]')) x;result:=result||jsonb_build_object('gallery',v);
 select coalesce(jsonb_agg(app.pick_json(x,array['url','title'])),'[]') into v from jsonb_array_elements(coalesce(sr->'plans','[]')) x;result:=result||jsonb_build_object('plans',v);
 select coalesce(jsonb_agg(app.pick_json(x,array['date','title','note','images'])),'[]') into v from jsonb_array_elements(coalesce(sr->'progress','[]')) x;result:=result||jsonb_build_object('progress',v);
 select coalesce(jsonb_agg(app.pick_json(x,array['id','title','kind','role','spaceId','image','w','h'])||jsonb_build_object(
  'regions',(select coalesce(jsonb_agg(app.pick_json(r,array['id','space','points','radius'])||jsonb_build_object('target',case when r->'target' is not null then app.pick_json(r->'target',array['type','id']) else null end)),'[]') from jsonb_array_elements(coalesce(x->'regions','[]')) r),
  'spots',(select coalesce(jsonb_agg(app.pick_json(sp,array['scene','sceneId','x','y'])),'[]') from jsonb_array_elements(coalesce(x->'spots','[]')) sp))),'[]') into v from jsonb_array_elements(coalesce(sr->'views','[]')) x;
 return result||jsonb_build_object('views',v);
end $$;
-- Retain existing rendering contracts and historical snapshots; only future versions use the stricter wrapper.
alter function app.build_snapshot(uuid,text) rename to build_snapshot_legacy;
create function app.build_snapshot(p_project uuid,p_kind text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snap jsonb;sr jsonb;
begin
 select showroom into sr from public.projects where id=p_project;
 perform app.validate_showroom_experience(p_project,sr);
 sr:=app.public_showroom(sr);
 if sr::text ~ 'agel-local:|blob:|data:' then raise exception 'Hay archivos locales pendientes';end if;
 snap:=app.build_snapshot_legacy(p_project,p_kind);
 return snap||jsonb_build_object('showroom',sr,'opening',sr->'opening');
end $$;
revoke all on function app.build_snapshot_legacy(uuid,text),app.build_snapshot(uuid,text),app.pick_json(jsonb,text[]),app.orient(jsonb,jsonb,jsonb),app.segments_cross(jsonb,jsonb,jsonb,jsonb),app.public_showroom(jsonb),app.validate_showroom_experience(uuid,jsonb) from public,anon,authenticated;

-- Image-only showrooms are content too. Serialize version numbering per publication.
create or replace function public.create_publication_version(p_publication uuid, p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pub public.publications; v_ver int; v_id uuid; v_snap jsonb; v_rev int;
begin
  select * into v_pub from public.publications where id = p_publication for update;
  if v_pub.id is null or not app.can_edit_project(v_pub.project_id) then
    raise exception 'No puedes preparar versiones de esta publicación' using errcode = '42501';
  end if;
  v_snap := app.build_snapshot(v_pub.project_id, v_pub.kind);
  if v_pub.kind in ('visor', 'showroom') and jsonb_array_length(v_snap -> 'scenes') = 0
     and jsonb_array_length(v_snap -> 'spaces') = 0
     and jsonb_array_length(coalesce(v_snap#>'{showroom,views}','[]'))=0 and coalesce(v_snap -> 'showroom' ->> 'description', '') = '' then
    raise exception 'No hay contenido publicable: agrega escenas con panorámica o contenido del showroom';
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.publication_versions where publication_id = p_publication;
  select revision into v_rev from public.projects where id = v_pub.project_id;
  insert into public.publication_versions (publication_id, project_id, version, snapshot, note, source_revision, created_by)
  values (p_publication, v_pub.project_id, v_ver, v_snap, left(coalesce(p_note, ''), 500), v_rev, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

insert into app.deployment_migrations(version,name,sha256) values('20261014001500','showroom_experience','2aadbe408da35f8f9a65ac9d2e8d2f4e439ce6d8a80550113cb1e75a6187b0dd');

-- 20261014001600_bim_showroom_access.sql
-- Configuration is private. Public snapshots contain no model IDs or technical paths.
alter table app.workspace_settings enable row level security;
create function public.save_workspace_settings(p_project uuid,p_settings jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_version uuid;p jsonb;k text;
begin
 if not app.can_edit_project(p_project) then raise exception 'No tienes permiso' using errcode='42501';end if;
 if jsonb_typeof(p_settings)<>'object' or length(p_settings::text)>100000 then raise exception 'Configuración privada inválida';end if;
 v_version:=nullif(p_settings->>'bimVersionId','')::uuid;
 if v_version is not null and not exists(select 1 from public.model_versions where id=v_version and project_id=p_project) then raise exception 'Modelo de otro proyecto';end if;
 for k,p in select key,value from jsonb_each(coalesce(p_settings->'presets','{}')) loop
  if k not in ('complete','mep','finishes','grey') or jsonb_typeof(p)<>'object' then raise exception 'Preset inválido';end if;
  if exists(select 1 from jsonb_object_keys(p) x where x not in ('all','disciplines','levels','categories','ids')) then raise exception 'Campo de preset inválido';end if;
  if p?'all' and (k<>'complete' or p->'all'<>'true') then raise exception 'Solo Completo puede mostrar todo';end if;
  for k in select unnest(array['disciplines','levels','categories','ids']) loop
   if p?k and (jsonb_typeof(p->k)<>'array' or jsonb_array_length(p->k)>5000) then raise exception 'Lista de preset inválida';end if;
  end loop;
 end loop;
 insert into app.workspace_settings(project_id,settings) values(p_project,app.pick_json(p_settings,array['bimVersionId','presets']))
 on conflict(project_id) do update set settings=excluded.settings;
end $$;
create function public.load_workspace_settings(p_project uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not app.can_read_project(p_project) then raise exception 'No tienes permiso' using errcode='42501';end if;
 return coalesce((select settings from app.workspace_settings where project_id=p_project),'{}');
end $$;
alter function public.save_workspace_snapshot(uuid,jsonb,int) rename to save_workspace_snapshot_content;
alter function public.save_workspace_snapshot_content(uuid,jsonb,int) set schema app;
revoke all on function app.save_workspace_snapshot_content(uuid,jsonb,int) from public,anon,authenticated;
create function public.save_workspace_snapshot(p_project uuid,p_snapshot jsonb,p_base_revision int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not app.can_edit_project(p_project) then raise exception 'No tienes permiso' using errcode='42501';end if;
 result:=app.save_workspace_snapshot_content(p_project,p_snapshot,p_base_revision);
 perform public.save_workspace_settings(p_project,coalesce(p_snapshot->'privateSettings','{}'));
 return result;
end $$;
create function public.showroom_bim_access(p_publication uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare project uuid;v_version uuid;
begin
 select project_id into project from public.publications where id=p_publication and kind='showroom';
 if project is null or not app.can_read_project(project) then raise exception 'No tienes acceso a este proyecto' using errcode='42501';end if;
 select nullif(settings->>'bimVersionId','')::uuid into v_version from app.workspace_settings where project_id=project;
 return (select jsonb_build_object('version_id',id) from public.model_versions where id=v_version and project_id=project and status='ready');
end $$;
create or replace function public.get_publication(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',p.id,'slug',p.slug,'kind',p.kind,'title',p.title,'audience',p.audience,'version',v.version,'published_at',p.published_at,'snapshot',v.snapshot)
from public.publications p join public.publication_versions v on v.id=p.current_version_id where p.slug=lower(p_slug) and p.status='published' and p.kind in ('visor','showroom')$$;
create or replace function public.preview_version(p_version uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select jsonb_build_object('id',v.publication_id,'version',v.version,'snapshot',v.snapshot,'approved_at',v.approved_at) from public.publication_versions v where v.id=p_version$$;
revoke all on function public.save_workspace_settings(uuid,jsonb),public.load_workspace_settings(uuid),public.save_workspace_snapshot(uuid,jsonb,int),public.showroom_bim_access(uuid) from public,anon;
grant execute on function public.save_workspace_settings(uuid,jsonb),public.load_workspace_settings(uuid),public.save_workspace_snapshot(uuid,jsonb,int),public.showroom_bim_access(uuid) to authenticated;

insert into app.deployment_migrations(version,name,sha256) values('20261014001600','bim_showroom_access','98d955636acb5b7c77caaea35f3319eab0cc36e7f73dbe03f5b1768f4c55a998');
commit;
