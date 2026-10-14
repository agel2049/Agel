-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 5 · Etapas y calendario 4D
--
--  Tres alcances del plan:
--   1. Etapas simples   → element_mappings.phase (clasificación por regla).
--   2. Calendario 4D    → tasks + task_links (tarea ↔ source_id estable).
--   3. Planeado vs real → fechas actual_start / actual_end en tasks.
--  Las asociaciones usan source_id (no dbid), así sobreviven a una nueva
--  versión del modelo; compare_model_versions() reporta lo que se rompe.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  model_id      uuid references public.models(id) on delete cascade,
  parent_id     uuid references public.tasks(id) on delete cascade,
  external_id   text check (char_length(external_id) <= 120),
  name          text not null check (char_length(name) between 1 and 300),
  task_type     text not null default 'construir' check (task_type in ('construir', 'demoler', 'temporal')),
  planned_start date,
  planned_end   date,
  actual_start  date,
  actual_end    date,
  responsible   text not null default '' check (char_length(responsible) <= 160),
  wbs           text not null default '' check (char_length(wbs) <= 60),
  position      int  not null default 0,
  created_at    timestamptz not null default now(),
  check (planned_end is null or planned_start is null or planned_end >= planned_start),
  check (actual_end is null or actual_start is null or actual_end >= actual_start)
);
create unique index if not exists tasks_external_uidx
  on public.tasks(project_id, coalesce(model_id, '00000000-0000-0000-0000-000000000000'::uuid), external_id)
  where external_id is not null;

create table if not exists public.task_links (
  task_id    uuid not null references public.tasks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id  text not null check (char_length(source_id) between 1 and 200),
  primary key (task_id, source_id)
);
create index if not exists task_links_source_idx on public.task_links(project_id, source_id);

do $$
declare t text;
begin
  foreach t in array array['tasks', 'task_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.can_read_project(project_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.can_edit_project(project_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (app.can_edit_project(project_id))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Importa tareas (desde el CSV/XML de TimeLiner ya convertido por la app).
-- p_tasks: [{external_id, parent_external_id, name, task_type, planned_start, planned_end,
--            actual_start, actual_end, responsible, wbs}]
create or replace function public.import_schedule(p_project uuid, p_model uuid, p_tasks jsonb, p_replace boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r jsonb; v_n int := 0; v_warn jsonb := '[]'::jsonb; v_type text; i int := 0;
begin
  if not app.can_edit_project(p_project) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_model is not null and not exists (select 1 from public.models where id = p_model and project_id = p_project) then
    raise exception 'El modelo no pertenece al proyecto';
  end if;
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) > 20000 then
    raise exception 'Calendario inválido o demasiado grande (máx. 20000 tareas)';
  end if;
  if p_replace then
    delete from public.tasks where project_id = p_project and model_id is not distinct from p_model;
  end if;
  for r in select * from jsonb_array_elements(p_tasks) loop
    v_type := coalesce(nullif(r ->> 'task_type', ''), 'construir');
    if v_type not in ('construir', 'demoler', 'temporal') then
      v_warn := v_warn || jsonb_build_object('external_id', r ->> 'external_id', 'aviso', 'tipo desconocido "' || v_type || '"; se usó construir');
      v_type := 'construir';
    end if;
    begin
      insert into public.tasks (project_id, model_id, external_id, name, task_type, planned_start, planned_end,
                                actual_start, actual_end, responsible, wbs, position)
      values (p_project, p_model, nullif(left(r ->> 'external_id', 120), ''), left(coalesce(nullif(r ->> 'name', ''), 'Tarea'), 300),
              v_type, (r ->> 'planned_start')::date, (r ->> 'planned_end')::date,
              (r ->> 'actual_start')::date, (r ->> 'actual_end')::date,
              left(coalesce(r ->> 'responsible', ''), 160), left(coalesce(r ->> 'wbs', ''), 60), i)
      on conflict do nothing;
      v_n := v_n + 1;
    exception when others then
      v_warn := v_warn || jsonb_build_object('external_id', r ->> 'external_id', 'aviso', sqlerrm);
    end;
    i := i + 1;
  end loop;
  update public.tasks c set parent_id = p.id
    from jsonb_array_elements(p_tasks) src, public.tasks p
   where c.project_id = p_project and c.model_id is not distinct from p_model and c.external_id = src ->> 'external_id'
     and p.project_id = p_project and p.model_id is not distinct from p_model
     and p.external_id = src ->> 'parent_external_id' and p.id <> c.id;
  return jsonb_build_object('importadas', v_n, 'avisos', v_warn);
end $$;

-- Asocia tareas con elementos por source_id. p_links: [{external_id, source_ids: [...]}]
create or replace function public.set_task_links(p_project uuid, p_model uuid, p_links jsonb, p_replace boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_n int; v_missing jsonb;
begin
  if not app.can_edit_project(p_project) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_replace then
    delete from public.task_links tl using public.tasks t
     where tl.task_id = t.id and t.project_id = p_project and t.model_id is not distinct from p_model;
  end if;
  insert into public.task_links (task_id, project_id, source_id)
  select t.id, p_project, left(sid, 200)
  from jsonb_array_elements(p_links) l
  join public.tasks t on t.project_id = p_project and t.model_id is not distinct from p_model and t.external_id = l ->> 'external_id'
  cross join lateral jsonb_array_elements_text(coalesce(l -> 'source_ids', '[]'::jsonb)) sid
  on conflict do nothing;
  get diagnostics v_n = row_count;
  select coalesce(jsonb_agg(l ->> 'external_id'), '[]'::jsonb) into v_missing
  from jsonb_array_elements(p_links) l
  where not exists (select 1 from public.tasks t where t.project_id = p_project and t.model_id is not distinct from p_model
                    and t.external_id = l ->> 'external_id');
  return jsonb_build_object('vinculos', v_n, 'tareas_no_encontradas', v_missing);
end $$;

-- Calendario listo para reproducir en una versión del modelo + reporte.
create or replace function public.schedule_for_version(p_version uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with v as (select mv.id, mv.model_id, mv.project_id from public.model_versions mv where mv.id = p_version),
  t as (select t.* from public.tasks t, v where t.project_id = v.project_id and (t.model_id = v.model_id or t.model_id is null)),
  l as (select tl.task_id, tl.source_id, em.dbid
        from public.task_links tl join t on t.id = tl.task_id
        left join public.element_mappings em on em.model_version_id = p_version and em.source_id = tl.source_id)
  select jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'external_id', t.external_id, 'parent_id', t.parent_id, 'name', t.name, 'type', t.task_type,
        'planned_start', t.planned_start, 'planned_end', t.planned_end,
        'actual_start', t.actual_start, 'actual_end', t.actual_end, 'responsible', t.responsible,
        'dbids', coalesce((select jsonb_agg(l.dbid) from l where l.task_id = t.id and l.dbid is not null), '[]'::jsonb))
        order by t.position) from t), '[]'::jsonb),
    'report', jsonb_build_object(
      'tareas_sin_elementos', coalesce((select jsonb_agg(t.name) from t
                                        where not exists (select 1 from l where l.task_id = t.id)
                                          and not exists (select 1 from t c where c.parent_id = t.id)), '[]'::jsonb),
      'vinculos_ausentes_en_version', (select count(*) from l where l.dbid is null),
      'tareas_sin_fechas', coalesce((select jsonb_agg(t.name) from t where t.planned_start is null or t.planned_end is null), '[]'::jsonb)
    )
  )
$$;

-- Compara dos versiones del modelo: qué elementos aparecen o desaparecen y
-- qué vistas, incidencias y tareas quedan con referencias rotas.
create or replace function public.compare_model_versions(p_old uuid, p_new uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with o as (select source_id from public.element_mappings where model_version_id = p_old),
       n as (select source_id from public.element_mappings where model_version_id = p_new),
       removed as (select source_id from o except select source_id from n),
       added   as (select source_id from n except select source_id from o)
  select jsonb_build_object(
    'eliminados', (select count(*) from removed),
    'agregados',  (select count(*) from added),
    'muestra_eliminados', coalesce((select jsonb_agg(source_id) from (select source_id from removed limit 50) q), '[]'::jsonb),
    'vistas_afectadas', coalesce((select jsonb_agg(jsonb_build_object('id', vp.id, 'name', vp.name))
        from public.viewpoints vp where vp.model_version_id = p_old
         and exists (select 1 from unnest(vp.element_source_ids) s where s in (select source_id from removed))), '[]'::jsonb),
    'incidencias_afectadas', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title))
        from public.issues i
        where i.project_id = (select project_id from public.model_versions where id = p_old)
          and exists (select 1 from unnest(i.element_source_ids) s where s in (select source_id from removed))), '[]'::jsonb),
    'vinculos_4d_rotos', (select count(*) from public.task_links tl
        where tl.project_id = (select project_id from public.model_versions where id = p_old)
          and tl.source_id in (select source_id from removed))
  )
$$;

grant execute on function public.import_schedule(uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.set_task_links(uuid, uuid, jsonb, boolean)  to authenticated;
grant execute on function public.schedule_for_version(uuid)                  to authenticated;
grant execute on function public.compare_model_versions(uuid, uuid)          to authenticated;
revoke execute on function public.import_schedule(uuid, uuid, jsonb, boolean) from public, anon;
revoke execute on function public.set_task_links(uuid, uuid, jsonb, boolean)  from public, anon;
revoke execute on function public.schedule_for_version(uuid)                  from public, anon;
revoke execute on function public.compare_model_versions(uuid, uuid)          from public, anon;
