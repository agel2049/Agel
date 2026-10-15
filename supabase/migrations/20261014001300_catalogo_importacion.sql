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
