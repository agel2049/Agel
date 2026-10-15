-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 2 · Contenido central: activos, escenas, hotspots
--
--   • El navegador deja de ser el único lugar donde vive un proyecto.
--   • Guardado atómico del árbol (proyecto + escenas + hotspots) con
--     control de concurrencia: si otra persona guardó antes, se rechaza
--     en lugar de pisar su trabajo.
--   • Cada guardado queda en el historial (project_revisions).
--   • Las subidas se reservan antes: así se controla la cuota y Storage
--     solo acepta rutas reservadas por un editor del proyecto.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.assets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  bucket      text not null check (bucket in ('media', 'models', 'technical', 'panoramas')),
  path        text not null check (char_length(path) between 3 and 512),
  kind        text not null check (kind in ('pano', 'thumb', 'image', 'video', 'plan', 'model_html',
                                            'nwd', 'schedule', 'glb', 'doc', 'other')),
  mime        text check (char_length(mime) <= 120),
  bytes       bigint not null default 0 check (bytes >= 0),
  width       int, height int,
  sha256      text check (sha256 ~ '^[0-9a-f]{64}$'),
  derived_from uuid references public.assets(id) on delete set null,
  status      text not null default 'uploading' check (status in ('uploading', 'ready', 'failed', 'archived')),
  meta        jsonb not null default '{}'::jsonb,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (bucket, path),
  check (bucket = 'panoramas' or split_part(path, '/', 1) = project_id::text)
);
create index if not exists assets_project_idx on public.assets(project_id);

create table if not exists public.scenes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  position      int  not null default 0,
  name          text not null check (char_length(name) between 1 and 120),
  meta          text not null default '' check (char_length(meta) <= 200),
  level         text not null default '' check (char_length(level) <= 80),
  pano_url      text check (pano_url is null or (pano_url ~ '^https://' and char_length(pano_url) <= 2048)),
  thumb_url     text check (thumb_url is null or (thumb_url ~ '^https://' and char_length(thumb_url) <= 2048)),
  pano_asset_id uuid references public.assets(id) on delete set null,
  heading       real not null default 0 check (heading between -360 and 360),
  limits        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists scenes_project_idx on public.scenes(project_id, position);
-- Versión ligera (≈2048 px) para portadas y listas: la panorámica completa
-- (hasta 8K) solo se descarga al entrar al recorrido.
alter table public.scenes add column if not exists preview_url text
  check (preview_url is null or (preview_url ~ '^https://' and char_length(preview_url) <= 2048));

create table if not exists public.hotspots (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  scene_id        uuid not null references public.scenes(id) on delete cascade,
  position        int  not null default 0,
  type            text not null check (type in ('info', 'scene', 'link', 'media', 'bim')),
  x               real not null check (x between 0 and 100),
  y               real not null check (y between 0 and 100),
  title           text not null default '' check (char_length(title) <= 140),
  details         text[] not null default '{}' check (cardinality(details) <= 30),
  img_url         text check (img_url is null or (img_url ~ '^https://' and char_length(img_url) <= 2048)),
  target_scene_id uuid references public.scenes(id) on delete set null,
  payload         jsonb not null default '{}'::jsonb
);
create index if not exists hotspots_scene_idx on public.hotspots(scene_id, position);
create index if not exists hotspots_project_idx on public.hotspots(project_id);

create table if not exists public.project_revisions (
  id         bigserial primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  revision   int  not null,
  tree       jsonb not null,
  saved_by   uuid default auth.uid(),
  saved_at   timestamptz not null default now(),
  unique (project_id, revision)
);

drop trigger if exists scenes_touch on public.scenes;
create trigger scenes_touch before update on public.scenes
  for each row execute function app.touch_updated_at();

-- Coherencia: hotspot y destino en el mismo proyecto que su escena.
create or replace function app.hotspot_consistency() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select project_id from public.scenes where id = new.scene_id) is distinct from new.project_id then
    raise exception 'El hotspot no pertenece al proyecto de su escena';
  end if;
  if new.target_scene_id is not null and
     (select project_id from public.scenes where id = new.target_scene_id) is distinct from new.project_id then
    raise exception 'El destino del hotspot es de otro proyecto';
  end if;
  return new;
end $$;
drop trigger if exists hotspots_consistency on public.hotspots;
create trigger hotspots_consistency before insert or update on public.hotspots
  for each row execute function app.hotspot_consistency();

-- Historial acotado: se conservan las últimas 200 revisiones por proyecto.
create or replace function app.prune_revisions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.project_revisions
  where project_id = new.project_id and revision <= new.revision - 200;
  return null;
end $$;
drop trigger if exists revisions_prune on public.project_revisions;
create trigger revisions_prune after insert on public.project_revisions
  for each row execute function app.prune_revisions();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.assets            enable row level security;
alter table public.scenes            enable row level security;
alter table public.hotspots          enable row level security;
alter table public.project_revisions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['assets', 'scenes', 'hotspots'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.can_read_project(project_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.can_edit_project(project_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (app.can_edit_project(project_id))', t);
  end loop;
end $$;

drop policy if exists revisions_select on public.project_revisions;
create policy revisions_select on public.project_revisions for select to authenticated
  using (app.can_read_project(project_id));
drop policy if exists revisions_insert on public.project_revisions;
create policy revisions_insert on public.project_revisions for insert to authenticated
  with check (app.can_edit_project(project_id));

grant select, insert, update, delete on public.assets, public.scenes, public.hotspots to authenticated;
grant select, insert on public.project_revisions to authenticated;
grant usage on sequence public.project_revisions_id_seq to authenticated;
revoke all on public.assets, public.scenes, public.hotspots, public.project_revisions from anon;

-- ── Subidas con reserva y cuota ──────────────────────────────────────────
create or replace function app.org_used_bytes(p_org uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.bytes), 0)::bigint
  from public.assets a join public.projects p on p.id = a.project_id
  where p.org_id = p_org and a.status <> 'archived'
$$;
grant execute on function app.org_used_bytes(uuid) to authenticated;

create or replace function app.safe_filename(p text) returns text
language sql immutable as $$
  select left(coalesce(nullif(regexp_replace(
           regexp_replace(lower(translate(coalesce(p, ''),
             'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ',
             'aeiouaeiouaeiouaeiouncAEIOUAEIOUAEIOUAEIOUNC')),
           '[^a-z0-9._-]+', '_', 'g'), '^[._]+', ''), ''), 'archivo'), 80)
$$;

create or replace function public.reserve_upload(
  p_project uuid, p_bucket text, p_kind text, p_filename text, p_bytes bigint, p_mime text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_org uuid; v_quota bigint; v_used bigint; v_path text; v_id uuid;
begin
  if not app.can_edit_project(p_project) then
    raise exception 'No puedes subir archivos a este proyecto' using errcode = '42501';
  end if;
  if p_bucket not in ('media', 'models', 'technical') then raise exception 'Bucket no permitido'; end if;
  if p_bytes is null or p_bytes <= 0 then raise exception 'Tamaño inválido'; end if;
  select org_id into v_org from public.projects where id = p_project;
  select quota_bytes into v_quota from public.organizations where id = v_org;
  v_used := app.org_used_bytes(v_org);
  if v_used + p_bytes > v_quota then
    raise exception 'Cuota de almacenamiento agotada: % MB usados de % MB',
      round(v_used / 1048576.0), round(v_quota / 1048576.0) using errcode = '53400';
  end if;
  v_path := p_project::text || '/' || p_kind || '/' ||
            to_char(clock_timestamp(), 'YYYYMMDD"T"HH24MISSMS') || '_' ||
            substr(md5(random()::text), 1, 6) || '_' || app.safe_filename(p_filename);
  insert into public.assets (project_id, bucket, path, kind, mime, bytes, status)
  values (p_project, p_bucket, v_path, p_kind, p_mime, p_bytes, 'uploading')
  returning id into v_id;
  return jsonb_build_object('asset_id', v_id, 'bucket', p_bucket, 'path', v_path);
end $$;

create or replace function public.complete_upload(
  p_asset uuid, p_width int default null, p_height int default null, p_sha256 text default null, p_derived_from uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.assets;
begin
  update public.assets
     set status = 'ready', width = p_width, height = p_height, sha256 = p_sha256,
         derived_from = coalesce(p_derived_from, derived_from)
   where id = p_asset and status = 'uploading'
  returning * into r;
  if r.id is null then raise exception 'Reserva no encontrada o ya completada'; end if;
  return to_jsonb(r);
end $$;

grant execute on function public.reserve_upload(uuid, text, text, text, bigint, text) to authenticated;
grant execute on function public.complete_upload(uuid, int, int, text, uuid) to authenticated;
revoke execute on function public.reserve_upload(uuid, text, text, text, bigint, text) from public, anon;
revoke execute on function public.complete_upload(uuid, int, int, text, uuid) from public, anon;

-- Storage solo acepta rutas reservadas recientemente por un editor.
create or replace function app.upload_reserved(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assets a
    where a.bucket = p_bucket and a.path = p_name
      and a.status = 'uploading' and a.created_at > now() - interval '6 hours'
      and app.can_edit_project(a.project_id))
$$;
grant execute on function app.upload_reserved(text, text) to authenticated;

drop policy if exists "agel media/models insert" on storage.objects;
create policy "agel media/models insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('media', 'models')
              and app.can_edit_project(app.object_project(name))
              and app.upload_reserved(bucket_id, name));
drop policy if exists "agel technical insert" on storage.objects;
create policy "agel technical insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'technical'
              and app.can_edit_project(app.object_project(name))
              and app.upload_reserved(bucket_id, name));

-- ── Árbol del proyecto: leer y guardar ───────────────────────────────────
create or replace function public.load_project_tree(p_project uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'project', jsonb_build_object('id', p.id, 'org_id', p.org_id, 'name', p.name, 'subtitle', p.subtitle,
                                  'location', p.location, 'delivery', p.delivery, 'status', p.status,
                                  'progress', p.progress, 'kind', p.kind, 'showroom', p.showroom,
                                  'updated_at', p.updated_at),
    'role', app.project_role(p.id),
    'revision', p.revision,
    'scenes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'meta', s.meta, 'level', s.level, 'pano_url', s.pano_url,
        'thumb_url', s.thumb_url, 'preview_url', s.preview_url, 'heading', s.heading, 'limits', s.limits,
        'hs', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', h.id, 'type', h.type, 'x', h.x, 'y', h.y, 'title', h.title, 'details', to_jsonb(h.details),
                 'img_url', h.img_url, 'target_scene_id', h.target_scene_id, 'payload', h.payload) order by h.position)
               from public.hotspots h where h.scene_id = s.id), '[]'::jsonb)
      ) order by s.position)
      from public.scenes s where s.project_id = p.id), '[]'::jsonb)
  ) into v
  from public.projects p where p.id = p_project;
  if v is null then raise exception 'Proyecto no encontrado' using errcode = 'P0002'; end if;
  return v;
end $$;

-- Validación del árbol que llega de la app. Lanza con mensaje claro.
create or replace function app.check_tree(p_tree jsonb) returns void
language plpgsql immutable as $$
declare s jsonb; h jsonb; n_hs int;
begin
  if jsonb_typeof(p_tree) <> 'object' or jsonb_typeof(p_tree -> 'scenes') <> 'array' then
    raise exception 'Árbol inválido: falta la lista de escenas';
  end if;
  if jsonb_array_length(p_tree -> 'scenes') > 200 then raise exception 'Máximo 200 escenas por proyecto'; end if;
  for s in select * from jsonb_array_elements(p_tree -> 'scenes') loop
    if app.try_uuid(s ->> 'id') is null then raise exception 'Escena sin id válido'; end if;
    if coalesce(jsonb_typeof(s -> 'hs'), 'array') <> 'array' then raise exception 'Hotspots inválidos'; end if;
    n_hs := coalesce(jsonb_array_length(s -> 'hs'), 0);
    if n_hs > 100 then raise exception 'Máximo 100 hotspots por escena'; end if;
    for h in select * from jsonb_array_elements(coalesce(s -> 'hs', '[]'::jsonb)) loop
      if app.try_uuid(h ->> 'id') is null then raise exception 'Hotspot sin id válido'; end if;
      if coalesce(jsonb_typeof(h -> 'details'), 'array') <> 'array' then raise exception 'Detalles inválidos'; end if;
    end loop;
  end loop;
end $$;

create or replace function app.ids_owned_elsewhere(p_table text, p_ids uuid[], p_project uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v boolean;
begin
  execute format('select exists (select 1 from public.%I where id = any($1) and project_id <> $2)', p_table)
    into v using p_ids, p_project;
  return v;
end $$;

create or replace function public.save_project_tree(p_project uuid, p_tree jsonb, p_base_revision int)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_rev int; v_scene_ids uuid[]; v_hs_ids uuid[]; s jsonb; h jsonb; i int := 0; j int;
  v_target uuid; pr jsonb := coalesce(p_tree -> 'project', '{}'::jsonb);
begin
  if not app.can_edit_project(p_project) then
    raise exception 'No puedes editar este proyecto' using errcode = '42501';
  end if;
  perform app.check_tree(p_tree);

  -- Conflicto con código PT409 (PostgREST responde HTTP 409). NO usar 40001:
  -- PostgREST reintenta solo las transacciones con error de serialización y
  -- la petición quedaría colgada en un ciclo infinito.
  select revision into v_rev from public.projects where id = p_project for update;
  if v_rev is distinct from p_base_revision then
    raise exception 'Conflicto: el proyecto cambió (revisión % en el servidor, % en tu copia). Recarga para no sobrescribir.',
      v_rev, p_base_revision using errcode = 'PT409';
  end if;

  select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_scene_ids from jsonb_array_elements(p_tree -> 'scenes') e;
  select coalesce(array_agg((hh ->> 'id')::uuid), '{}') into v_hs_ids
    from jsonb_array_elements(p_tree -> 'scenes') e, jsonb_array_elements(coalesce(e -> 'hs', '[]'::jsonb)) hh;
  if app.ids_owned_elsewhere('scenes', v_scene_ids, p_project) or app.ids_owned_elsewhere('hotspots', v_hs_ids, p_project) then
    raise exception 'Hay ids de escenas u hotspots que pertenecen a otro proyecto' using errcode = '42501';
  end if;

  delete from public.hotspots where project_id = p_project and not (id = any(v_hs_ids));
  delete from public.scenes   where project_id = p_project and not (id = any(v_scene_ids));

  for s in select * from jsonb_array_elements(p_tree -> 'scenes') loop
    insert into public.scenes (id, project_id, position, name, meta, level, pano_url, thumb_url, preview_url, heading, limits)
    values ((s ->> 'id')::uuid, p_project, i,
            left(coalesce(nullif(trim(s ->> 'name'), ''), 'Escena ' || (i + 1)), 120),
            left(coalesce(s ->> 'meta', ''), 200), left(coalesce(s ->> 'level', ''), 80),
            nullif(s ->> 'pano_url', ''), nullif(s ->> 'thumb_url', ''), nullif(s ->> 'preview_url', ''),
            coalesce((s ->> 'heading')::real, 0), coalesce(s -> 'limits', '{}'::jsonb))
    on conflict (id) do update set
      position = excluded.position, name = excluded.name, meta = excluded.meta, level = excluded.level,
      pano_url = excluded.pano_url, thumb_url = excluded.thumb_url, preview_url = excluded.preview_url,
      heading = excluded.heading, limits = excluded.limits;
    i := i + 1;
  end loop;

  for s in select * from jsonb_array_elements(p_tree -> 'scenes') loop
    j := 0;
    for h in select * from jsonb_array_elements(coalesce(s -> 'hs', '[]'::jsonb)) loop
      v_target := app.try_uuid(h ->> 'target_scene_id');
      if v_target is not null and not (v_target = any(v_scene_ids)) then v_target := null; end if;
      insert into public.hotspots (id, project_id, scene_id, position, type, x, y, title, details, img_url, target_scene_id, payload)
      values ((h ->> 'id')::uuid, p_project, (s ->> 'id')::uuid, j,
              coalesce(nullif(h ->> 'type', ''), 'info'),
              greatest(0, least(100, coalesce((h ->> 'x')::real, 50))),
              greatest(0, least(100, coalesce((h ->> 'y')::real, 50))),
              left(coalesce(h ->> 'title', ''), 140),
              coalesce((select array_agg(left(d, 500)) from jsonb_array_elements_text(coalesce(h -> 'details', '[]'::jsonb)) d), '{}'),
              nullif(h ->> 'img_url', ''), v_target, coalesce(h -> 'payload', '{}'::jsonb))
      on conflict (id) do update set
        scene_id = excluded.scene_id, position = excluded.position, type = excluded.type, x = excluded.x, y = excluded.y,
        title = excluded.title, details = excluded.details, img_url = excluded.img_url,
        target_scene_id = excluded.target_scene_id, payload = excluded.payload;
      j := j + 1;
    end loop;
  end loop;

  perform set_config('app.saving_tree', 'on', true);
  update public.projects set
    revision = revision + 1,
    name     = left(coalesce(nullif(trim(pr ->> 'name'), ''), name), 160),
    subtitle = left(coalesce(pr ->> 'subtitle', subtitle), 240),
    location = left(coalesce(pr ->> 'location', location), 240),
    delivery = left(coalesce(pr ->> 'delivery', delivery), 80),
    status   = case when pr ->> 'status' in ('activo', 'revision', 'nuevo', 'archivado') then pr ->> 'status' else status end,
    progress = case when (pr ->> 'progress') ~ '^\d{1,3}$' then least(100, (pr ->> 'progress')::int) else progress end
  where id = p_project
  returning revision into v_rev;
  perform set_config('app.saving_tree', 'off', true);

  insert into public.project_revisions (project_id, revision, tree) values (p_project, v_rev, p_tree);
  return jsonb_build_object('revision', v_rev);
end $$;

create or replace function public.restore_project_revision(p_project uuid, p_revision int)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_tree jsonb; v_cur int;
begin
  select tree into v_tree from public.project_revisions where project_id = p_project and revision = p_revision;
  if v_tree is null then raise exception 'Revisión no encontrada' using errcode = 'P0002'; end if;
  select revision into v_cur from public.projects where id = p_project;
  return public.save_project_tree(p_project, v_tree, v_cur);
end $$;

grant execute on function public.load_project_tree(uuid)              to authenticated;
grant execute on function public.save_project_tree(uuid, jsonb, int)  to authenticated;
grant execute on function public.restore_project_revision(uuid, int)  to authenticated;
revoke execute on function public.load_project_tree(uuid)             from public, anon;
revoke execute on function public.save_project_tree(uuid, jsonb, int) from public, anon;
revoke execute on function public.restore_project_revision(uuid, int) from public, anon;
