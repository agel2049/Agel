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
