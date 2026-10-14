-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 4 · BIM / MEP (Autodesk Platform Services)
--
--   • models / model_versions: cada NWD publicado es una versión con su
--     URN de APS y estado de conversión (lo actualizan las funciones de
--     servidor con la clave de servicio, nunca el navegador).
--   • element_mappings: identificador estable de origen (source_id) ↔ id
--     interno del visor (dbid) POR VERSIÓN, con su clasificación MEP. Los
--     dbid cambian entre versiones; source_id no.
--   • classification_rules: reglas revisables cuando faltan propiedades.
--     Lo que ninguna regla clasifica queda "sin_clasificar" (no se inventa).
--   • viewpoints: vistas guardadas, opcionalmente ligadas a una escena 360.
--   • issues / issue_comments: incidencias con responsable; los revisores
--     pueden crear y comentar.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function app.can_comment_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.project_role(p_project) in ('owner', 'editor', 'reviewer'), false)
$$;
grant execute on function app.can_comment_project(uuid) to authenticated;

create table if not exists public.models (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 160),
  kind        text not null default 'aps' check (kind in ('aps', 'd5_html', 'gltf')),
  description text not null default '' check (char_length(description) <= 2000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists models_project_idx on public.models(project_id);

create table if not exists public.model_versions (
  id             uuid primary key default gen_random_uuid(),
  model_id       uuid not null references public.models(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  version        int  not null,
  label          text not null default '' check (char_length(label) <= 160),
  source_name    text not null default '' check (char_length(source_name) <= 255),
  source_bytes   bigint,
  aps_bucket     text,
  aps_object_key text,
  aps_urn        text check (aps_urn is null or aps_urn ~ '^[A-Za-z0-9_-]+$'),
  status         text not null default 'pending'
                 check (status in ('pending', 'uploading', 'translating', 'ready', 'failed')),
  progress       text not null default '',
  messages       jsonb not null default '[]'::jsonb,
  units          text not null default '' check (char_length(units) <= 40),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (model_id, version)
);
drop trigger if exists model_versions_touch on public.model_versions;
create trigger model_versions_touch before update on public.model_versions
  for each row execute function app.touch_updated_at();

-- El estado de conversión solo lo cambia el servidor (service_role).
create or replace function app.model_version_guard() returns trigger
language plpgsql as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      if new.status not in ('pending') or new.aps_urn is not null then
        raise exception 'El estado de conversión lo asigna el servidor';
      end if;
    elsif (new.status, new.aps_urn, new.aps_bucket, new.aps_object_key, new.messages, new.progress)
          is distinct from (old.status, old.aps_urn, old.aps_bucket, old.aps_object_key, old.messages, old.progress) then
      raise exception 'El estado de conversión lo asigna el servidor';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists model_versions_guard on public.model_versions;
create trigger model_versions_guard before insert or update on public.model_versions
  for each row execute function app.model_version_guard();

create table if not exists public.element_mappings (
  id               bigserial primary key,
  model_version_id uuid not null references public.model_versions(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  source_id        text not null check (char_length(source_id) between 1 and 200),
  dbid             int,
  name             text not null default '' check (char_length(name) <= 300),
  discipline       text not null default '' check (char_length(discipline) <= 80),
  system           text not null default '' check (char_length(system) <= 120),
  level            text not null default '' check (char_length(level) <= 120),
  zone             text not null default '' check (char_length(zone) <= 120),
  category         text not null default '' check (char_length(category) <= 120),
  phase            text not null default '' check (char_length(phase) <= 120),
  classification   text not null default 'sin_clasificar'
                   check (classification in ('propiedad', 'regla', 'manual', 'sin_clasificar')),
  props            jsonb not null default '{}'::jsonb,
  unique (model_version_id, source_id)
);
create index if not exists element_mappings_version_idx on public.element_mappings(model_version_id);

create table if not exists public.classification_rules (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position   int  not null default 0,
  field      text not null check (field in ('discipline', 'system', 'level', 'zone', 'category', 'phase')),
  property   text not null check (char_length(property) between 1 and 200),
  operator   text not null default 'equals' check (operator in ('equals', 'contains', 'starts_with', 'regex', 'exists')),
  value      text not null default '' check (char_length(value) <= 200),
  set_value  text not null check (char_length(set_value) between 1 and 120),
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.viewpoints (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  model_id         uuid references public.models(id) on delete cascade,
  model_version_id uuid references public.model_versions(id) on delete set null,
  name             text not null check (char_length(name) between 1 and 160),
  state            jsonb not null default '{}'::jsonb,
  filters          jsonb not null default '{}'::jsonb,
  element_source_ids text[] not null default '{}',
  scene_id         uuid references public.scenes(id) on delete set null,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);

create table if not exists public.issues (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  model_id           uuid references public.models(id) on delete set null,
  model_version_id   uuid references public.model_versions(id) on delete set null,
  viewpoint_id       uuid references public.viewpoints(id) on delete set null,
  title              text not null check (char_length(title) between 1 and 200),
  body               text not null default '' check (char_length(body) <= 4000),
  status             text not null default 'abierta' check (status in ('abierta', 'en_proceso', 'resuelta', 'cerrada')),
  priority           text not null default 'media' check (priority in ('baja', 'media', 'alta')),
  assignee           uuid references auth.users(id) on delete set null,
  element_source_ids text[] not null default '{}' check (cardinality(element_source_ids) <= 500),
  due_date           date,
  created_by         uuid not null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
drop trigger if exists issues_touch on public.issues;
create trigger issues_touch before update on public.issues for each row execute function app.touch_updated_at();

create table if not exists public.issue_comments (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.issues(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['models', 'model_versions', 'element_mappings', 'classification_rules', 'viewpoints'] loop
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
grant usage on sequence public.element_mappings_id_seq to authenticated;

alter table public.issues enable row level security;
drop policy if exists issues_select on public.issues;
create policy issues_select on public.issues for select to authenticated using (app.can_read_project(project_id));
drop policy if exists issues_insert on public.issues;
create policy issues_insert on public.issues for insert to authenticated
  with check (app.can_comment_project(project_id) and created_by = auth.uid());
drop policy if exists issues_update on public.issues;
create policy issues_update on public.issues for update to authenticated
  using (app.can_edit_project(project_id) or (created_by = auth.uid() and app.can_comment_project(project_id)))
  with check (app.can_comment_project(project_id));
drop policy if exists issues_delete on public.issues;
create policy issues_delete on public.issues for delete to authenticated using (app.can_admin_project(project_id));

alter table public.issue_comments enable row level security;
drop policy if exists comments_select on public.issue_comments;
create policy comments_select on public.issue_comments for select to authenticated using (app.can_read_project(project_id));
drop policy if exists comments_insert on public.issue_comments;
create policy comments_insert on public.issue_comments for insert to authenticated
  with check (app.can_comment_project(project_id) and created_by = auth.uid()
              and exists (select 1 from public.issues i where i.id = issue_id and i.project_id = issue_comments.project_id));
drop policy if exists comments_delete on public.issue_comments;
create policy comments_delete on public.issue_comments for delete to authenticated
  using (created_by = auth.uid() or app.can_admin_project(project_id));

grant select, insert, update, delete on public.issues to authenticated;
grant select, insert, delete on public.issue_comments to authenticated;
revoke all on public.issues, public.issue_comments from anon;

-- ── Funciones ────────────────────────────────────────────────────────────
create or replace function public.create_model_version(p_model uuid, p_label text, p_source_name text, p_bytes bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_m public.models; v_ver int; v_id uuid;
begin
  select * into v_m from public.models where id = p_model;
  if v_m.id is null or not app.can_edit_project(v_m.project_id) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.model_versions where model_id = p_model;
  insert into public.model_versions (model_id, project_id, version, label, source_name, source_bytes)
  values (p_model, v_m.project_id, v_ver, left(coalesce(p_label, ''), 160), left(coalesce(p_source_name, ''), 255), p_bytes)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', v_ver);
end $$;

-- Carga masiva de correspondencias (la app las extrae del visor por lotes).
create or replace function public.upsert_element_mappings(p_version uuid, p_rows jsonb)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_project uuid; v_n int;
begin
  select project_id into v_project from public.model_versions where id = p_version;
  if v_project is null or not app.can_edit_project(v_project) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Envía como máximo 5000 elementos por lote';
  end if;
  insert into public.element_mappings (model_version_id, project_id, source_id, dbid, name, discipline, system,
                                       level, zone, category, phase, classification, props)
  select p_version, v_project, left(r ->> 'source_id', 200), (r ->> 'dbid')::int, left(coalesce(r ->> 'name', ''), 300),
         left(coalesce(r ->> 'discipline', ''), 80), left(coalesce(r ->> 'system', ''), 120),
         left(coalesce(r ->> 'level', ''), 120), left(coalesce(r ->> 'zone', ''), 120),
         left(coalesce(r ->> 'category', ''), 120), left(coalesce(r ->> 'phase', ''), 120),
         case when r ->> 'classification' in ('propiedad', 'regla', 'manual', 'sin_clasificar')
              then r ->> 'classification' else 'sin_clasificar' end,
         coalesce(r -> 'props', '{}'::jsonb)
  from jsonb_array_elements(p_rows) r
  where coalesce(r ->> 'source_id', '') <> ''
  on conflict (model_version_id, source_id) do update set
    dbid = excluded.dbid, name = excluded.name, discipline = excluded.discipline, system = excluded.system,
    level = excluded.level, zone = excluded.zone, category = excluded.category, phase = excluded.phase,
    classification = excluded.classification, props = excluded.props;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Resumen MEP para filtros: valores disponibles y cuántos quedan sin clasificar.
create or replace function public.model_facets(p_version uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'sin_clasificar', count(*) filter (where classification = 'sin_clasificar'),
    'discipline', (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(nullif(discipline, ''), 'sin clasificar') k, count(*) n from public.element_mappings where model_version_id = p_version group by 1) q),
    'system',     (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(nullif(system, ''), 'sin clasificar') k, count(*) n from public.element_mappings where model_version_id = p_version group by 1) q),
    'level',      (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(nullif(level, ''), 'sin nivel') k, count(*) n from public.element_mappings where model_version_id = p_version group by 1) q),
    'phase',      (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(nullif(phase, ''), 'sin etapa') k, count(*) n from public.element_mappings where model_version_id = p_version group by 1) q)
  )
  from public.element_mappings where model_version_id = p_version
$$;

grant execute on function public.create_model_version(uuid, text, text, bigint) to authenticated;
grant execute on function public.upsert_element_mappings(uuid, jsonb)           to authenticated;
grant execute on function public.model_facets(uuid)                            to authenticated;
revoke execute on function public.create_model_version(uuid, text, text, bigint) from public, anon;
revoke execute on function public.upsert_element_mappings(uuid, jsonb)           from public, anon;
revoke execute on function public.model_facets(uuid)                            from public, anon;
