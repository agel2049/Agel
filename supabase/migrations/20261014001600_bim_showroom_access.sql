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
