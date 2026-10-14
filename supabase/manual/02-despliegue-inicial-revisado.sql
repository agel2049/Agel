begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $preflight$ begin
if exists(select 1 from pg_tables where schemaname='public') then
 raise exception 'Despliegue inicial cancelado: public ya contiene tablas; revisar migraciones aplicadas';
end if;
end $preflight$;
-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 1 · Acceso: organizaciones, proyectos y roles
--
--  Reglas (plan maestro, "Base segura"):
--   • Autenticarse NO da acceso a ningún proyecto.
--   • Organización: owner y admin administran TODOS sus proyectos;
--     member solo ve los proyectos a los que lo agregan.
--   • Proyecto: owner (todo), editor (contenido), reviewer (leer y
--     comentar), viewer (leer).
--   • Toda comprobación ocurre en Postgres (RLS + funciones), no en la app.
-- ═══════════════════════════════════════════════════════════════════════

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

do $$ begin
  create type public.org_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.project_role as enum ('owner', 'editor', 'reviewer', 'viewer');
exception when duplicate_object then null; end $$;

-- ── Tablas ───────────────────────────────────────────────────────────────
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  slug        text unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$'),
  branding    jsonb not null default '{}'::jsonb,
  quota_bytes bigint not null default 1073741824,           -- 1 GB, ajustable
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.memberships (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships(user_id);

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 160),
  subtitle    text not null default '' check (char_length(subtitle) <= 240),
  location    text not null default '' check (char_length(location) <= 240),
  delivery    text not null default '' check (char_length(delivery) <= 80),
  status      text not null default 'activo' check (status in ('activo', 'revision', 'nuevo', 'archivado')),
  progress    int  not null default 0 check (progress between 0 and 100),
  kind        text not null default 'desarrollo'
              check (kind in ('desarrollo', 'edificio', 'vivienda', 'ambiente', 'producto')),
  showroom    jsonb not null default '{}'::jsonb,
  revision    int  not null default 0,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_org_idx on public.projects(org_id);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.project_role not null default 'viewer',
  added_by   uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id);

-- ── Funciones de permiso ─────────────────────────────────────────────────
-- IMPORTANTE: devuelven siempre true/false, nunca NULL. Sin rol, el rol es
-- NULL y "NULL in (...)" también es NULL; en PL/pgSQL "if not NULL" NO
-- entra al bloque, así que una comprobación "if not app.can_…" dejaría
-- pasar a cualquiera. Las pruebas detectaron justo ese caso.
-- SECURITY DEFINER para leer membresías sin recursión de RLS. Solo
-- devuelven datos del usuario de la petición (auth.uid()).
create or replace function app.org_role(p_org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.org_id = p_org and m.user_id = auth.uid()
$$;

create or replace function app.project_role(p_project uuid) returns public.project_role
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.projects p
      join public.memberships m on m.org_id = p.org_id
      where p.id = p_project and m.user_id = auth.uid() and m.role in ('owner', 'admin')
    ) then 'owner'::public.project_role
    else (select pm.role from public.project_members pm
          where pm.project_id = p_project and pm.user_id = auth.uid())
  end
$$;

create or replace function app.can_read_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.project_role(p_project) is not null, false)
$$;
create or replace function app.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.project_role(p_project) in ('owner', 'editor'), false)
$$;
create or replace function app.can_admin_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.project_role(p_project) = 'owner', false)
$$;
create or replace function app.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.org_role(p_org) in ('owner', 'admin'), false)
$$;

-- Texto → uuid sin lanzar error (rutas de Storage manipuladas).
create or replace function app.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to anon, authenticated, service_role;

-- ── Triggers ─────────────────────────────────────────────────────────────
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function app.touch_updated_at();

-- Quien crea un proyecto queda como su propietario.
create or replace function app.project_creator_is_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    insert into public.project_members (project_id, user_id, role, added_by)
    values (new.id, auth.uid(), 'owner', auth.uid())
    on conflict (project_id, user_id) do update set role = 'owner';
  end if;
  return new;
end $$;
drop trigger if exists projects_creator_owner on public.projects;
create trigger projects_creator_owner after insert on public.projects
  for each row execute function app.project_creator_is_owner();

-- Un proyecto no cambia de organización desde la API.
create or replace function app.project_org_immutable() returns trigger
language plpgsql as $$
begin
  if new.org_id <> old.org_id then raise exception 'No se puede mover un proyecto de organización'; end if;
  if new.revision <> old.revision and current_setting('app.saving_tree', true) is distinct from 'on' then
    raise exception 'La revisión solo cambia al guardar el contenido';
  end if;
  return new;
end $$;
drop trigger if exists projects_org_immutable on public.projects;
create trigger projects_org_immutable before update on public.projects
  for each row execute function app.project_org_immutable();

-- Una organización nunca se queda sin propietario.
create or replace function app.keep_one_org_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := coalesce(old.org_id, new.org_id);
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' then
    if not exists (select 1 from public.memberships
                   where org_id = v_org and role = 'owner'
                     and user_id <> old.user_id) then
      -- Si la organización se está borrando completa, se permite.
      if exists (select 1 from public.organizations where id = v_org) then
        raise exception 'La organización necesita al menos un propietario';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists memberships_keep_owner on public.memberships;
create trigger memberships_keep_owner after update or delete on public.memberships
  for each row execute function app.keep_one_org_owner();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.organizations   enable row level security;
alter table public.memberships     enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;

-- Organizaciones: las ves si eres miembro; solo owner/admin editan; el
-- alta pasa por create_organization() para fijar al creador como owner.
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select to authenticated
  using (app.org_role(id) is not null);
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update to authenticated
  using (app.is_org_admin(id)) with check (app.is_org_admin(id));
drop policy if exists org_delete on public.organizations;
create policy org_delete on public.organizations for delete to authenticated
  using (app.org_role(id) = 'owner');

-- Membresías: ves las de tus organizaciones; owner/admin las gestionan,
-- pero solo un owner puede crear o tocar a otro owner.
drop policy if exists mem_select on public.memberships;
create policy mem_select on public.memberships for select to authenticated
  using (app.org_role(org_id) is not null);
drop policy if exists mem_insert on public.memberships;
create policy mem_insert on public.memberships for insert to authenticated
  with check (app.is_org_admin(org_id) and (role <> 'owner' or app.org_role(org_id) = 'owner'));
drop policy if exists mem_update on public.memberships;
create policy mem_update on public.memberships for update to authenticated
  using (app.is_org_admin(org_id) and (role <> 'owner' or app.org_role(org_id) = 'owner'))
  with check (app.is_org_admin(org_id) and (role <> 'owner' or app.org_role(org_id) = 'owner'));
drop policy if exists mem_delete on public.memberships;
create policy mem_delete on public.memberships for delete to authenticated
  using ((app.is_org_admin(org_id) and (role <> 'owner' or app.org_role(org_id) = 'owner'))
         or user_id = auth.uid());

-- Proyectos
drop policy if exists proj_select on public.projects;
create policy proj_select on public.projects for select to authenticated
  using (app.can_read_project(id));
drop policy if exists proj_insert on public.projects;
create policy proj_insert on public.projects for insert to authenticated
  with check (app.org_role(org_id) is not null and created_by = auth.uid());
drop policy if exists proj_update on public.projects;
create policy proj_update on public.projects for update to authenticated
  using (app.can_edit_project(id)) with check (app.can_edit_project(id));
drop policy if exists proj_delete on public.projects;
create policy proj_delete on public.projects for delete to authenticated
  using (app.can_admin_project(id));

-- Miembros de proyecto: los ven quienes pueden leer el proyecto; los
-- gestiona su owner. El alta por correo pasa por add_project_member().
drop policy if exists pm_select on public.project_members;
create policy pm_select on public.project_members for select to authenticated
  using (app.can_read_project(project_id));
drop policy if exists pm_update on public.project_members;
create policy pm_update on public.project_members for update to authenticated
  using (app.can_admin_project(project_id)) with check (app.can_admin_project(project_id));
drop policy if exists pm_delete on public.project_members;
create policy pm_delete on public.project_members for delete to authenticated
  using (app.can_admin_project(project_id) or user_id = auth.uid());

-- ── Funciones de la API ──────────────────────────────────────────────────
create or replace function public.create_organization(p_name text, p_slug text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión' using errcode = '28000'; end if;
  if (select count(*) from public.memberships where user_id = auth.uid() and role = 'owner') >= 20 then
    raise exception 'Límite de organizaciones alcanzado';
  end if;
  insert into public.organizations (name, slug, created_by)
  values (trim(p_name), nullif(lower(trim(p_slug)), ''), auth.uid())
  returning id into v_id;
  insert into public.memberships (org_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;

-- Alta de proyecto. Una función (en vez de INSERT directo) porque el
-- creador debe quedar como owner en la misma operación; con INSERT …
-- RETURNING la política de lectura rechazaría la fila recién creada.
create or replace function public.create_project(p_org uuid, p_name text, p_kind text default 'desarrollo')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión' using errcode = '28000'; end if;
  if app.org_role(p_org) is null then
    raise exception 'No perteneces a esa organización' using errcode = '42501';
  end if;
  insert into public.projects (org_id, name, kind, created_by)
  values (p_org, trim(p_name), coalesce(nullif(p_kind, ''), 'desarrollo'), auth.uid())
  returning id into v_id;
  return v_id;            -- el trigger ya agregó al creador como owner
end $$;

-- Agregar a alguien a un proyecto por correo. La cuenta debe existir
-- (créala en Supabase → Authentication → Users o que se registre).
create or replace function public.add_project_member(p_project uuid, p_email text, p_role public.project_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_org uuid;
begin
  if not app.can_admin_project(p_project) then
    raise exception 'Solo el propietario del proyecto puede agregar personas' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No existe una cuenta con ese correo' using errcode = 'P0002';
  end if;
  select org_id into v_org from public.projects where id = p_project;
  -- La persona entra a la organización como member (sin acceso a otros proyectos).
  insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'member')
  on conflict (org_id, user_id) do nothing;
  insert into public.project_members (project_id, user_id, role, added_by)
  values (p_project, v_user, p_role, auth.uid())
  on conflict (project_id, user_id) do update set role = excluded.role;
  return v_user;
end $$;

-- Lista de miembros con su correo (auth.users no es legible desde la API).
create or replace function public.list_project_members(p_project uuid)
returns table (user_id uuid, email text, role public.project_role, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select pm.user_id, u.email, pm.role, pm.created_at
  from public.project_members pm join auth.users u on u.id = pm.user_id
  where pm.project_id = p_project and app.can_read_project(p_project)
  order by pm.created_at
$$;

-- Lo que la app necesita al iniciar sesión.
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug,
                                                          'role', m.role, 'branding', o.branding) order by o.created_at)
                      from public.memberships m join public.organizations o on o.id = m.org_id
                      where m.user_id = auth.uid()), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'org_id', p.org_id, 'name', p.name,
                                                              'role', app.project_role(p.id), 'revision', p.revision,
                                                              'updated_at', p.updated_at) order by p.updated_at desc)
                          from public.projects p where app.can_read_project(p.id)), '[]'::jsonb)
  )
$$;

revoke execute on function public.create_organization(text, text)                         from public, anon;
revoke execute on function public.create_project(uuid, text, text)                         from public, anon;
grant  execute on function public.create_project(uuid, text, text)                         to authenticated;
revoke execute on function public.add_project_member(uuid, text, public.project_role)      from public, anon;
revoke execute on function public.list_project_members(uuid)                               from public, anon;
revoke execute on function public.my_access()                                              from public, anon;
grant  execute on function public.create_organization(text, text)                          to authenticated;
grant  execute on function public.add_project_member(uuid, text, public.project_role)      to authenticated;
grant  execute on function public.list_project_members(uuid)                               to authenticated;
grant  execute on function public.my_access()                                              to authenticated;

grant select, insert, update, delete on public.organizations, public.memberships,
  public.projects, public.project_members to authenticated;
revoke all on public.organizations, public.memberships, public.projects, public.project_members from anon;
-- La organización se crea por create_organization(); no por insert directo.
revoke insert on public.organizations from authenticated;
-- Los miembros de proyecto se agregan por add_project_member().
revoke insert on public.project_members from authenticated;
-- Los proyectos se crean por create_project().
revoke insert on public.projects from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 1 · Storage separado por función
--
--   media      Panorámicas, imágenes, planos y videos que se muestran
--              públicamente por URL. Lectura pública; escritura solo de
--              quien edita el proyecto.
--   models     HTML ejecutable (exportaciones D5). Supabase lo entrega
--              como texto plano; la app lo descarga y lo muestra en un
--              iframe aislado. Escritura solo de editores.
--   technical  Archivos técnicos privados (NWD, calendarios, originales).
--              Ni lectura ni escritura públicas.
--
--  Toda ruta empieza por el id del proyecto:  <project_id>/<carpeta>/<archivo>
--  El bucket heredado "panoramas" NO se toca aquí (ver supabase/manual/).
--
--  Upsert (x-upsert: true) requiere INSERT + SELECT + UPDATE: se conceden
--  los tres a editores para no romper las subidas de la app.
-- ═══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('media', 'media', true, 52428800,
   array['image/jpeg','image/png','image/webp','image/avif','image/gif',
         'video/mp4','video/webm','application/pdf','model/gltf-binary','application/json']),
  ('models', 'models', true, 524288000, array['text/html']),
  ('technical', 'technical', false, 524288000, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Proyecto al que pertenece un objeto (primer segmento de la ruta).
create or replace function app.object_project(p_name text) returns uuid
language sql immutable as $$
  select app.try_uuid((storage.foldername(p_name))[1])
$$;
grant execute on function app.object_project(text) to anon, authenticated, service_role;

-- media y models: leer (listar) quien lee el proyecto; la descarga pública
-- por URL no pasa por RLS al ser buckets públicos.
drop policy if exists "agel media/models select" on storage.objects;
create policy "agel media/models select" on storage.objects for select to authenticated
  using (bucket_id in ('media', 'models') and app.can_read_project(app.object_project(name)));

drop policy if exists "agel media/models insert" on storage.objects;
create policy "agel media/models insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('media', 'models') and app.can_edit_project(app.object_project(name)));

drop policy if exists "agel media/models update" on storage.objects;
create policy "agel media/models update" on storage.objects for update to authenticated
  using (bucket_id in ('media', 'models') and app.can_edit_project(app.object_project(name)))
  with check (bucket_id in ('media', 'models') and app.can_edit_project(app.object_project(name)));

drop policy if exists "agel media/models delete" on storage.objects;
create policy "agel media/models delete" on storage.objects for delete to authenticated
  using (bucket_id in ('media', 'models') and app.can_edit_project(app.object_project(name)));

-- technical: privado de punta a punta.
drop policy if exists "agel technical select" on storage.objects;
create policy "agel technical select" on storage.objects for select to authenticated
  using (bucket_id = 'technical' and app.can_read_project(app.object_project(name)));

drop policy if exists "agel technical insert" on storage.objects;
create policy "agel technical insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'technical' and app.can_edit_project(app.object_project(name)));

drop policy if exists "agel technical update" on storage.objects;
create policy "agel technical update" on storage.objects for update to authenticated
  using (bucket_id = 'technical' and app.can_edit_project(app.object_project(name)))
  with check (bucket_id = 'technical' and app.can_edit_project(app.object_project(name)));

drop policy if exists "agel technical delete" on storage.objects;
create policy "agel technical delete" on storage.objects for delete to authenticated
  using (bucket_id = 'technical' and app.can_admin_project(app.object_project(name)));

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

-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 3 · Catálogo comercial
--
--  Una sola estructura para todas las escalas del plan:
--    desarrollo   conjunto → edificio → nivel → unidad
--    edificio     área → nivel → espacio
--    vivienda     ambiente → detalle
--    producto     producto → variante
--  Los niveles intermedios son opcionales (parent_id puede ser null).
--  Precio y disponibilidad registran quién y cuándo los cambió.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.spaces (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  parent_id     uuid references public.spaces(id) on delete cascade,
  kind          text not null check (kind in ('conjunto', 'edificio', 'nivel', 'unidad', 'area',
                                              'espacio', 'ambiente', 'producto', 'variante')),
  name          text not null check (char_length(name) between 1 and 120),
  code          text not null default '' check (char_length(code) <= 40),
  position      int  not null default 0,
  summary       text not null default '' check (char_length(summary) <= 2000),
  area_m2       numeric(10,2) check (area_m2 is null or area_m2 between 0 and 1000000),
  bedrooms      int check (bedrooms is null or bedrooms between 0 and 50),
  bathrooms     numeric(4,1) check (bathrooms is null or bathrooms between 0 and 50),
  parking       int check (parking is null or parking between 0 and 50),
  price         numeric(14,2) check (price is null or price >= 0),
  currency      text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  show_price    boolean not null default false,
  availability  text not null default 'no_aplica'
                check (availability in ('disponible', 'apartada', 'vendida', 'no_aplica')),
  attributes    jsonb not null default '{}'::jsonb,
  scene_ids     uuid[] not null default '{}' check (cardinality(scene_ids) <= 60),
  plan_url      text check (plan_url is null or (plan_url ~ '^https://' and char_length(plan_url) <= 2048)),
  gallery       jsonb not null default '[]'::jsonb check (jsonb_typeof(gallery) = 'array'),
  price_owner   uuid references auth.users(id) on delete set null,
  price_updated_at timestamptz,
  price_updated_by uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists spaces_project_idx on public.spaces(project_id, parent_id, position);

drop trigger if exists spaces_touch on public.spaces;
create trigger spaces_touch before update on public.spaces
  for each row execute function app.touch_updated_at();

create or replace function app.spaces_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is not null and
     (select project_id from public.spaces where id = new.parent_id) is distinct from new.project_id then
    raise exception 'El espacio padre es de otro proyecto';
  end if;
  if new.parent_id = new.id then raise exception 'Un espacio no puede contenerse a sí mismo'; end if;
  if tg_op = 'INSERT' or new.price is distinct from old.price or new.availability is distinct from old.availability
     or new.show_price is distinct from old.show_price then
    new.price_updated_at := now();
    new.price_updated_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists spaces_guard on public.spaces;
create trigger spaces_guard before insert or update on public.spaces
  for each row execute function app.spaces_guard();

alter table public.spaces enable row level security;
drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces for select to authenticated using (app.can_read_project(project_id));
drop policy if exists spaces_insert on public.spaces;
create policy spaces_insert on public.spaces for insert to authenticated with check (app.can_edit_project(project_id));
drop policy if exists spaces_update on public.spaces;
create policy spaces_update on public.spaces for update to authenticated
  using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
drop policy if exists spaces_delete on public.spaces;
create policy spaces_delete on public.spaces for delete to authenticated using (app.can_edit_project(project_id));

grant select, insert, update, delete on public.spaces to authenticated;
revoke all on public.spaces from anon;

-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 2 · Publicaciones versionadas y enlaces antiguos
--
--  Borrador → revisión → publicación → archivo.
--  Una publicación apunta a una VERSIÓN congelada (snapshot). Editar el
--  proyecto no cambia lo que ven los clientes hasta que el propietario
--  publique una versión nueva. Volver atrás = apuntar a una versión previa.
--  Los enlaces ?visor=1&id=… existentes siguen funcionando (Storage) y
--  además pueden mapearse a una publicación nueva (legacy_links).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.publications (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  kind               text not null check (kind in ('visor', 'showroom', 'bim')),
  slug               text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$'),
  title              text not null default '' check (char_length(title) <= 160),
  status             text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  audience           text not null default 'public' check (audience in ('public', 'link')),
  current_version_id uuid,
  published_at       timestamptz,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists publications_project_idx on public.publications(project_id);

create table if not exists public.publication_versions (
  id              uuid primary key default gen_random_uuid(),
  publication_id  uuid not null references public.publications(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  version         int  not null,
  snapshot        jsonb not null,
  note            text not null default '' check (char_length(note) <= 500),
  source_revision int,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  approved_by     uuid,
  approved_at     timestamptz,
  unique (publication_id, version)
);

do $$ begin
  alter table public.publications add constraint publications_current_fk
    foreign key (current_version_id) references public.publication_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.legacy_links (
  legacy_id      text primary key check (legacy_id ~ '^[a-z0-9_-]{1,64}$'),
  kind           text not null check (kind in ('visor', 'modelo')),
  publication_id uuid not null references public.publications(id) on delete cascade,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);

drop trigger if exists publications_touch on public.publications;
create trigger publications_touch before update on public.publications
  for each row execute function app.touch_updated_at();

-- Estado y versión vigente solo cambian por las funciones de publicación.
create or replace function app.publication_guard() returns trigger
language plpgsql as $$
begin
  if current_setting('app.publishing', true) is distinct from 'on' then
    if new.status is distinct from old.status or new.current_version_id is distinct from old.current_version_id
       or new.project_id is distinct from old.project_id or new.published_at is distinct from old.published_at then
      raise exception 'Usa las acciones de publicación para cambiar el estado';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists publications_guard on public.publications;
create trigger publications_guard before update on public.publications
  for each row execute function app.publication_guard();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.publications         enable row level security;
alter table public.publication_versions enable row level security;
alter table public.legacy_links         enable row level security;

drop policy if exists pub_select on public.publications;
create policy pub_select on public.publications for select to authenticated using (app.can_read_project(project_id));
drop policy if exists pub_update on public.publications;
create policy pub_update on public.publications for update to authenticated
  using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
drop policy if exists pub_delete on public.publications;
create policy pub_delete on public.publications for delete to authenticated using (app.can_admin_project(project_id));

drop policy if exists pubv_select on public.publication_versions;
create policy pubv_select on public.publication_versions for select to authenticated using (app.can_read_project(project_id));

drop policy if exists legacy_select on public.legacy_links;
create policy legacy_select on public.legacy_links for select to authenticated
  using (exists (select 1 from public.publications p where p.id = publication_id and app.can_read_project(p.project_id)));
drop policy if exists legacy_delete on public.legacy_links;
create policy legacy_delete on public.legacy_links for delete to authenticated
  using (exists (select 1 from public.publications p where p.id = publication_id and app.can_admin_project(p.project_id)));

grant select, update, delete on public.publications to authenticated;
grant select on public.publication_versions to authenticated;
grant select, delete on public.legacy_links to authenticated;
revoke all on public.publications, public.publication_versions, public.legacy_links from anon;

-- ── Snapshot: lo que verá el público ─────────────────────────────────────
-- Solo datos publicables: sin correos, sin precios ocultos, sin ids de
-- usuarios. Las escenas sin panorámica no se incluyen.
create or replace function app.build_snapshot(p_project uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_scenes jsonb; v_spaces jsonb; v_proj record; v_brand jsonb; v_idx jsonb;
begin
  select p.*, o.branding into v_proj from public.projects p join public.organizations o on o.id = p.org_id
  where p.id = p_project;
  v_brand := coalesce(v_proj.branding, '{}'::jsonb);

  -- índice de escena (posición en la lista publicada) por id
  select coalesce(jsonb_object_agg(id::text, rn - 1), '{}'::jsonb) into v_idx
  from (select id, row_number() over (order by position) rn
        from public.scenes where project_id = p_project and pano_url is not null) q;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'meta', s.meta, 'level', s.level, 'url', s.pano_url,
      'thumb', s.thumb_url, 'preview', s.preview_url, 'heading', s.heading,
      'hs', coalesce((select jsonb_agg(
               jsonb_strip_nulls(jsonb_build_object(
                 'type', h.type, 'x', h.x, 'y', h.y, 'title', h.title, 'details', to_jsonb(h.details),
                 'img', h.img_url,
                 'targetScene', case when h.target_scene_id is not null then (v_idx ->> h.target_scene_id::text)::int end,
                 'payload', case when h.payload = '{}'::jsonb then null else h.payload end))
               order by h.position)
             from public.hotspots h where h.scene_id = s.id
               and (h.type <> 'scene' or (v_idx ? h.target_scene_id::text))), '[]'::jsonb)
    ) order by s.position), '[]'::jsonb)
  into v_scenes from public.scenes s where s.project_id = p_project and s.pano_url is not null;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', sp.id, 'parent_id', sp.parent_id, 'kind', sp.kind, 'name', sp.name, 'code', sp.code,
      'summary', sp.summary, 'area_m2', sp.area_m2, 'bedrooms', sp.bedrooms, 'bathrooms', sp.bathrooms,
      'parking', sp.parking,
      'price', case when sp.show_price then sp.price end,
      'currency', case when sp.show_price then sp.currency end,
      'price_updated_at', case when sp.show_price then sp.price_updated_at end,
      'availability', sp.availability, 'attributes', sp.attributes,
      'scenes', (select coalesce(jsonb_agg((v_idx ->> sid::text)::int), '[]'::jsonb)
                 from unnest(sp.scene_ids) sid where v_idx ? sid::text),
      'plan_url', sp.plan_url, 'gallery', sp.gallery)) order by sp.position, sp.name), '[]'::jsonb)
  into v_spaces from public.spaces sp where sp.project_id = p_project;

  return jsonb_build_object(
    'v', 3, 'kind', p_kind,
    'p', v_proj.name, 'sub', v_proj.subtitle,
    'project', jsonb_build_object('name', v_proj.name, 'subtitle', v_proj.subtitle, 'location', v_proj.location,
                                  'delivery', v_proj.delivery, 'kind', v_proj.kind),
    'branding', jsonb_build_object('name', coalesce(v_brand ->> 'name', ''), 'logo_url', v_brand ->> 'logo_url',
                                   'accent', v_brand ->> 'accent'),
    'showroom', coalesce(v_proj.showroom, '{}'::jsonb) - 'notify_email' - 'webhook',
    'opening', v_proj.showroom -> 'opening',
    'scenes', v_scenes,
    'spaces', case when p_kind = 'showroom' then v_spaces else '[]'::jsonb end
  );
end $$;

-- ── Acciones ─────────────────────────────────────────────────────────────
create or replace function public.create_publication(p_project uuid, p_kind text, p_slug text, p_title text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.can_edit_project(p_project) then raise exception 'No puedes publicar este proyecto' using errcode = '42501'; end if;
  insert into public.publications (project_id, kind, slug, title)
  values (p_project, p_kind, lower(trim(p_slug)), coalesce(p_title, ''))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Esa dirección ya está en uso, elige otra' using errcode = '23505';
end $$;

create or replace function public.create_publication_version(p_publication uuid, p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pub public.publications; v_ver int; v_id uuid; v_snap jsonb; v_rev int;
begin
  select * into v_pub from public.publications where id = p_publication;
  if v_pub.id is null or not app.can_edit_project(v_pub.project_id) then
    raise exception 'No puedes preparar versiones de esta publicación' using errcode = '42501';
  end if;
  v_snap := app.build_snapshot(v_pub.project_id, v_pub.kind);
  if v_pub.kind in ('visor', 'showroom') and jsonb_array_length(v_snap -> 'scenes') = 0
     and jsonb_array_length(v_snap -> 'spaces') = 0 and coalesce(v_snap -> 'showroom' ->> 'description', '') = '' then
    raise exception 'No hay contenido publicable: agrega escenas con panorámica o contenido del showroom';
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.publication_versions where publication_id = p_publication;
  select revision into v_rev from public.projects where id = v_pub.project_id;
  insert into public.publication_versions (publication_id, project_id, version, snapshot, note, source_revision, created_by)
  values (p_publication, v_pub.project_id, v_ver, v_snap, left(coalesce(p_note, ''), 500), v_rev, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.request_review(p_publication uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pub public.publications;
begin
  select * into v_pub from public.publications where id = p_publication;
  if v_pub.id is null or not app.can_edit_project(v_pub.project_id) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if v_pub.status = 'published' then return; end if;
  perform set_config('app.publishing', 'on', true);
  update public.publications set status = 'review' where id = p_publication;
end $$;

-- Publicar: solo el propietario del proyecto aprueba.
create or replace function public.publish_version(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.publication_versions;
begin
  select * into v from public.publication_versions where id = p_version;
  if v.id is null or not app.can_admin_project(v.project_id) then
    raise exception 'Solo el propietario del proyecto puede publicar' using errcode = '42501';
  end if;
  update public.publication_versions set approved_by = auth.uid(), approved_at = now()
   where id = p_version and approved_at is null;
  perform set_config('app.publishing', 'on', true);
  update public.publications
     set status = 'published', current_version_id = p_version, published_at = now()
   where id = v.publication_id;
end $$;

create or replace function public.rollback_publication(p_publication uuid, p_version int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select pv.id into v_id from public.publication_versions pv
   where pv.publication_id = p_publication and pv.version = p_version;
  if v_id is null then raise exception 'Versión no encontrada' using errcode = 'P0002'; end if;
  perform public.publish_version(v_id);
  return v_id;
end $$;

create or replace function public.archive_publication(p_publication uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pub public.publications;
begin
  select * into v_pub from public.publications where id = p_publication;
  if v_pub.id is null or not app.can_admin_project(v_pub.project_id) then
    raise exception 'Solo el propietario puede archivar' using errcode = '42501';
  end if;
  perform set_config('app.publishing', 'on', true);
  update public.publications set status = 'archived' where id = p_publication;
end $$;

-- Lectura pública: solo publicaciones visor/showroom en estado published.
create or replace function public.get_publication(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug', p.slug, 'kind', p.kind, 'title', p.title, 'audience', p.audience,
                            'version', v.version, 'published_at', p.published_at, 'snapshot', v.snapshot)
  from public.publications p join public.publication_versions v on v.id = p.current_version_id
  where p.slug = lower(p_slug) and p.status = 'published' and p.kind in ('visor', 'showroom')
$$;

-- Vista previa de una versión (borrador incluido) para miembros del proyecto.
create or replace function public.preview_version(p_version uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('version', v.version, 'snapshot', v.snapshot, 'approved_at', v.approved_at)
  from public.publication_versions v where v.id = p_version
$$;

-- Lista pública de publicaciones abiertas (para el sitemap del showroom).
create or replace function public.list_public_publications()
returns table (slug text, kind text, title text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select slug, kind, title, published_at from public.publications
  where status = 'published' and audience = 'public' and kind in ('visor', 'showroom')
  order by published_at desc limit 500
$$;

create or replace function public.map_legacy_link(p_legacy_id text, p_kind text, p_publication uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_project uuid;
begin
  select project_id into v_project from public.publications where id = p_publication;
  if v_project is null or not app.can_admin_project(v_project) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  insert into public.legacy_links (legacy_id, kind, publication_id) values (lower(p_legacy_id), p_kind, p_publication)
  on conflict (legacy_id) do update set publication_id = excluded.publication_id, kind = excluded.kind;
end $$;

create or replace function public.resolve_legacy_link(p_legacy_id text, p_kind text)
returns text language sql stable security definer set search_path = '' as $$
  select p.slug from public.legacy_links l join public.publications p on p.id = l.publication_id
  where l.legacy_id = lower(p_legacy_id) and l.kind = p_kind and p.status = 'published'
$$;

revoke execute on function public.create_publication(uuid, text, text, text)  from public, anon;
revoke execute on function public.create_publication_version(uuid, text)      from public, anon;
revoke execute on function public.request_review(uuid)                        from public, anon;
revoke execute on function public.publish_version(uuid)                       from public, anon;
revoke execute on function public.rollback_publication(uuid, int)             from public, anon;
revoke execute on function public.archive_publication(uuid)                   from public, anon;
revoke execute on function public.preview_version(uuid)                       from public, anon;
revoke execute on function public.map_legacy_link(text, text, uuid)           from public, anon;
revoke execute on function app.build_snapshot(uuid, text)                     from public, anon, authenticated;
grant  execute on function public.create_publication(uuid, text, text, text)  to authenticated;
grant  execute on function public.create_publication_version(uuid, text)      to authenticated;
grant  execute on function public.request_review(uuid)                        to authenticated;
grant  execute on function public.publish_version(uuid)                       to authenticated;
grant  execute on function public.rollback_publication(uuid, int)             to authenticated;
grant  execute on function public.archive_publication(uuid)                   to authenticated;
grant  execute on function public.preview_version(uuid)                       to authenticated;
grant  execute on function public.map_legacy_link(text, text, uuid)           to authenticated;
grant  execute on function public.get_publication(text)                       to anon, authenticated;
grant  execute on function public.list_public_publications()                  to anon, authenticated;
grant  execute on function public.resolve_legacy_link(text, text)             to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 3 · Prospectos (contacto con contexto)
--
--  El visitante no escribe en tablas: llama a submit_lead(), que valida,
--  limita la frecuencia y guarda proyecto, unidad elegida y origen. La web
--  solo confirma "recibimos tu solicitud" si esta función respondió bien.
--  Los datos personales solo los ven el propietario y los editores.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  publication_id uuid references public.publications(id) on delete set null,
  space_id       uuid references public.spaces(id) on delete set null,
  space_label    text not null default '' check (char_length(space_label) <= 200),
  name           text not null check (char_length(name) between 2 and 120),
  email          text not null check (char_length(email) <= 200 and email ~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$'),
  phone          text not null default '' check (char_length(phone) <= 40 and phone ~ '^[0-9+()\s.-]*$'),
  message        text not null default '' check (char_length(message) <= 2000),
  consent        boolean not null check (consent),
  source         jsonb not null default '{}'::jsonb,
  status         text not null default 'nuevo' check (status in ('nuevo', 'contactado', 'cerrado', 'descartado')),
  assigned_to    uuid references auth.users(id) on delete set null,
  notes          text not null default '' check (char_length(notes) <= 4000),
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists leads_project_idx on public.leads(project_id, created_at desc);
create index if not exists leads_email_idx on public.leads(lower(email), created_at desc);

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads for each row execute function app.touch_updated_at();

-- Lo capturado por el visitante no se reescribe desde el panel.
create or replace function app.leads_guard() returns trigger
language plpgsql as $$
begin
  if (new.name, new.email, new.phone, new.message, new.space_id, new.project_id, new.source, new.created_at)
     is distinct from (old.name, old.email, old.phone, old.message, old.space_id, old.project_id, old.source, old.created_at) then
    raise exception 'Los datos enviados por el visitante no se modifican';
  end if;
  return new;
end $$;
drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before update on public.leads for each row execute function app.leads_guard();

alter table public.leads enable row level security;
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (app.can_edit_project(project_id));
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated using (app.can_admin_project(project_id));

grant select, update, delete on public.leads to authenticated;
revoke all on public.leads from anon;

create or replace function public.submit_lead(
  p_slug text, p_space uuid, p_name text, p_email text, p_phone text,
  p_message text, p_consent boolean, p_source jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pub public.publications; v_space public.spaces; v_id uuid; v_recent int; v_label text := ''; v_sel jsonb := '[]'::jsonb;
begin
  select * into v_pub from public.publications
   where slug = lower(p_slug) and status = 'published' and kind in ('showroom', 'visor');
  if v_pub.id is null then raise exception 'Esta publicación no recibe solicitudes' using errcode = 'P0002'; end if;
  if not coalesce(p_consent, false) then raise exception 'Se necesita tu autorización para contactarte'; end if;
  if p_email is null or p_email !~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$' then raise exception 'Correo inválido'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe tu nombre'; end if;

  -- Frecuencia: 3 por correo por hora; 30 por publicación cada 10 minutos.
  select count(*) into v_recent from public.leads
   where lower(email) = lower(trim(p_email)) and created_at > now() - interval '1 hour';
  if v_recent >= 3 then raise exception 'Ya recibimos tus solicitudes recientes; te contactaremos pronto' using errcode = '53400'; end if;
  select count(*) into v_recent from public.leads
   where publication_id = v_pub.id and created_at > now() - interval '10 minutes';
  if v_recent >= 30 then raise exception 'Demasiadas solicitudes en este momento; intenta más tarde' using errcode = '53400'; end if;

  if p_space is not null then
    select * into v_space from public.spaces where id = p_space and project_id = v_pub.project_id;
    if v_space.id is null then raise exception 'La unidad elegida no pertenece a este proyecto'; end if;
    v_label := trim(v_space.name || case when v_space.code <> '' then ' · ' || v_space.code else '' end);
  end if;

  -- Selección guardada por el visitante (hasta 10 opciones del mismo proyecto).
  if jsonb_typeof(p_source -> 'selection') = 'array' then
    select coalesce(jsonb_agg(trim(sp.name || case when sp.code <> '' then ' · ' || sp.code else '' end) order by sp.position, sp.name), '[]'::jsonb)
      into v_sel
      from public.spaces sp
     where sp.project_id = v_pub.project_id
       and sp.id in (select app.try_uuid(x) from jsonb_array_elements_text(p_source -> 'selection') x limit 10);
  end if;

  insert into public.leads (project_id, publication_id, space_id, space_label, name, email, phone, message, consent, source)
  values (v_pub.project_id, v_pub.id, v_space.id, left(v_label, 200), left(trim(p_name), 120), lower(trim(p_email)),
          left(regexp_replace(coalesce(p_phone, ''), '[^0-9+()\s.-]', '', 'g'), 40),
          left(coalesce(p_message, ''), 2000), true,
          jsonb_build_object(
            'utm_source',   left(coalesce(p_source ->> 'utm_source', ''), 80),
            'utm_medium',   left(coalesce(p_source ->> 'utm_medium', ''), 80),
            'utm_campaign', left(coalesce(p_source ->> 'utm_campaign', ''), 120),
            'referrer',     left(coalesce(p_source ->> 'referrer', ''), 300),
            'path',         left(coalesce(p_source ->> 'path', ''), 300),
            'scene',        left(coalesce(p_source ->> 'scene', ''), 120),
            'seleccion',    v_sel,
            'version',      (select version from public.publication_versions where id = v_pub.current_version_id)))
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.submit_lead(text, uuid, text, text, text, text, boolean, jsonb) to anon, authenticated;

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

-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 6 · Operación empresarial
--
--   • Auditoría: quién cambió accesos, publicaciones, precios y prospectos.
--   • Marca por organización (validada) y cuota solo ajustable por servidor.
--   • Uso por organización y exportación completa de un proyecto.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.audit_log (
  id         bigserial primary key,
  org_id     uuid,
  project_id uuid,
  actor      uuid default auth.uid(),
  action     text not null,
  entity     text not null,
  entity_id  text,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists audit_org_idx on public.audit_log(org_id, at desc);
create index if not exists audit_project_idx on public.audit_log(project_id, at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using ((org_id is not null and app.is_org_admin(org_id)) or (project_id is not null and app.can_admin_project(project_id)));
grant select on public.audit_log to authenticated;
revoke all on public.audit_log from anon;

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_project uuid := app.try_uuid(coalesce(r ->> 'project_id', case when tg_table_name = 'projects' then r ->> 'id' end));
  v_org uuid := app.try_uuid(r ->> 'org_id');
  v_detail jsonb := '{}'::jsonb; k text;
begin
  if v_org is null and v_project is not null then
    select org_id into v_org from public.projects where id = v_project;
  end if;
  if tg_table_name = 'organizations' then v_org := app.try_uuid(r ->> 'id'); end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r) loop
      if k not in ('updated_at', 'revision') and (r -> k) is distinct from (o -> k) then
        v_detail := v_detail || jsonb_build_object(k, jsonb_build_object('antes', o -> k, 'despues', r -> k));
      end if;
    end loop;
    if v_detail = '{}'::jsonb then return null; end if;
  elsif tg_table_name in ('leads') then
    v_detail := jsonb_build_object('space_label', r -> 'space_label');          -- sin datos personales
  else
    v_detail := r - 'snapshot' - 'tree' - 'props' - 'showroom';
  end if;
  -- No guardar datos personales de prospectos en la auditoría.
  if tg_table_name = 'leads' then v_detail := v_detail - 'email' - 'phone' - 'name' - 'message'; end if;
  insert into public.audit_log (org_id, project_id, actor, action, entity, entity_id, detail)
  values (v_org, v_project, auth.uid(), lower(tg_op), tg_table_name, coalesce(r ->> 'id', r ->> 'user_id'), v_detail);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'memberships', 'projects', 'project_members', 'publications',
                           'publication_versions', 'spaces', 'leads', 'models', 'model_versions'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$s', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s
                    for each row execute function app.audit()', t);
  end loop;
end $$;

-- Marca validada y cuota protegida.
create or replace function app.org_guard() returns trigger
language plpgsql as $$
declare b jsonb := coalesce(new.branding, '{}'::jsonb); k text;
begin
  for k in select jsonb_object_keys(b) loop
    if k not in ('name', 'logo_url', 'accent', 'website', 'whatsapp', 'email') then
      raise exception 'Campo de marca no permitido: %', k;
    end if;
  end loop;
  if b ? 'logo_url' and (b ->> 'logo_url') !~ '^https://' then raise exception 'El logo debe ser una URL https'; end if;
  if b ? 'accent' and (b ->> 'accent') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'El color debe tener formato #RRGGBB'; end if;
  if b ? 'website' and (b ->> 'website') !~ '^https://' then raise exception 'El sitio debe ser una URL https'; end if;
  if tg_op = 'UPDATE' and new.quota_bytes is distinct from old.quota_bytes
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'La cuota se ajusta desde la administración del servicio';
  end if;
  return new;
end $$;
drop trigger if exists organizations_guard on public.organizations;
create trigger organizations_guard before insert or update on public.organizations
  for each row execute function app.org_guard();

create or replace function public.org_usage(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if app.org_role(p_org) is null then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return jsonb_build_object(
    'bytes_usados',  app.org_used_bytes(p_org),
    'cuota_bytes',   (select quota_bytes from public.organizations where id = p_org),
    'proyectos',     (select count(*) from public.projects where org_id = p_org),
    'publicaciones', (select count(*) from public.publications pu join public.projects p on p.id = pu.project_id
                      where p.org_id = p_org and pu.status = 'published'),
    'prospectos_30d', (select count(*) from public.leads l join public.projects p on p.id = l.project_id
                       where p.org_id = p_org and l.created_at > now() - interval '30 days'),
    'modelos',       (select count(*) from public.models m join public.projects p on p.id = m.project_id where p.org_id = p_org)
  );
end $$;

-- Exportación completa (portabilidad y respaldo). Prospectos solo para
-- propietario/editor; correos de miembros solo para el propietario.
create or replace function public.export_project(p_project uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v jsonb;
begin
  if not app.can_read_project(p_project) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  v := jsonb_build_object(
    'format', 'agelarq-project-export', 'version', 1, 'exported_at', now(),
    'tree', public.load_project_tree(p_project),
    'spaces', coalesce((select jsonb_agg(to_jsonb(s) order by s.position) from public.spaces s where s.project_id = p_project), '[]'),
    'assets', coalesce((select jsonb_agg(to_jsonb(a)) from public.assets a where a.project_id = p_project), '[]'),
    'publications', coalesce((select jsonb_agg(to_jsonb(pu) || jsonb_build_object('versions',
        (select jsonb_agg(jsonb_build_object('version', v.version, 'note', v.note, 'created_at', v.created_at,
                                             'approved_at', v.approved_at, 'snapshot', v.snapshot) order by v.version)
         from public.publication_versions v where v.publication_id = pu.id)))
        from public.publications pu where pu.project_id = p_project), '[]'),
    'models', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('versions',
        (select jsonb_agg(to_jsonb(mv) order by mv.version) from public.model_versions mv where mv.model_id = m.id)))
        from public.models m where m.project_id = p_project), '[]'),
    'viewpoints', coalesce((select jsonb_agg(to_jsonb(x)) from public.viewpoints x where x.project_id = p_project), '[]'),
    'issues', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('comments',
        (select jsonb_agg(to_jsonb(c) order by c.created_at) from public.issue_comments c where c.issue_id = i.id)))
        from public.issues i where i.project_id = p_project), '[]'),
    'classification_rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.position) from public.classification_rules r where r.project_id = p_project), '[]'),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('source_ids',
        (select jsonb_agg(tl.source_id) from public.task_links tl where tl.task_id = t.id)) order by t.position)
        from public.tasks t where t.project_id = p_project), '[]'),
    'leads', case when app.can_edit_project(p_project)
                  then coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.leads l where l.project_id = p_project), '[]')
                  else '[]'::jsonb end,
    'members', case when app.can_admin_project(p_project)
                    then coalesce((select jsonb_agg(to_jsonb(m)) from public.list_project_members(p_project) m), '[]')
                    else '[]'::jsonb end
  );
  return v;
end $$;

grant execute on function public.org_usage(uuid)      to authenticated;
grant execute on function public.export_project(uuid) to authenticated;
revoke execute on function public.org_usage(uuid)      from public, anon;
revoke execute on function public.export_project(uuid) from public, anon;

-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 3 (S04) · Medición sin datos personales
--
--  Contadores diarios por publicación y evento. No se guardan IP, cookies
--  ni identificadores de visitante: solo "cuántas veces pasó X hoy".
--  Eventos permitidos (lista cerrada): ver página, abrir recorrido, ver una
--  unidad, iniciar contacto, enviar contacto, error de carga.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.publication_metrics (
  publication_id uuid not null references public.publications(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  day            date not null default current_date,
  event          text not null check (event in ('page_view', 'tour_open', 'unit_view', 'contact_start',
                                                'lead_submitted', 'load_error', 'scene_view')),
  count          bigint not null default 0,
  primary key (publication_id, day, event)
);

alter table public.publication_metrics enable row level security;
drop policy if exists metrics_select on public.publication_metrics;
create policy metrics_select on public.publication_metrics for select to authenticated
  using (app.can_read_project(project_id));
grant select on public.publication_metrics to authenticated;
revoke all on public.publication_metrics from anon;

create or replace function public.track_event(p_slug text, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pub public.publications;
begin
  if p_event not in ('page_view', 'tour_open', 'unit_view', 'contact_start', 'lead_submitted', 'load_error', 'scene_view') then
    return;                                   -- eventos desconocidos se ignoran sin error
  end if;
  select * into v_pub from public.publications where slug = lower(p_slug) and status = 'published';
  if v_pub.id is null then return; end if;
  insert into public.publication_metrics (publication_id, project_id, day, event, count)
  values (v_pub.id, v_pub.project_id, current_date, p_event, 1)
  on conflict (publication_id, day, event) do update set count = public.publication_metrics.count + 1;
end $$;
grant execute on function public.track_event(text, text) to anon, authenticated;

-- Resumen para el panel: últimos N días por evento.
create or replace function public.publication_stats(p_publication uuid, p_days int default 30)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(event, total), '{}'::jsonb)
  from (select event, sum(count) total from public.publication_metrics
        where publication_id = p_publication and day > current_date - least(greatest(p_days, 1), 366)
        group by event) q
$$;
grant execute on function public.publication_stats(uuid, int) to authenticated;
revoke execute on function public.publication_stats(uuid, int) from public, anon;

-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Fase 4 · Apoyo para las funciones de servidor de Autodesk (APS)
--
--  Las funciones aps-upload / aps-translate / aps-status / aps-token
--  preguntan con el token del usuario qué puede hacer con una versión del
--  modelo. Esta función responde en una sola llamada y nunca revela una
--  versión de un proyecto ajeno (devuelve null).
--  El estado de conversión solo lo escriben esas funciones con la clave de
--  servicio (ver model_version_guard en la migración 0700).
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.model_version_access(p_version uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', mv.id, 'project_id', mv.project_id, 'model_id', mv.model_id, 'version', mv.version,
    'source_name', mv.source_name, 'source_bytes', mv.source_bytes, 'status', mv.status,
    'aps_bucket', mv.aps_bucket, 'aps_object_key', mv.aps_object_key, 'aps_urn', mv.aps_urn,
    'role', app.project_role(mv.project_id)::text,
    'can_edit', app.can_edit_project(mv.project_id))
  from public.model_versions mv
  where mv.id = p_version and app.can_read_project(mv.project_id)
$$;
revoke execute on function public.model_version_access(uuid) from public, anon;
grant  execute on function public.model_version_access(uuid) to authenticated;

-- Avisos de prospectos (fase 7): qué falta por notificar. Solo servidor.
create or replace function public.pending_lead_notifications(p_limit int default 50)
returns table (lead_id uuid, project_id uuid, project_name text, notify_email text, webhook text,
               name text, email text, phone text, message text, space_label text, source jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.project_id, p.name, nullif(p.showroom ->> 'notify_email', ''), nullif(p.showroom ->> 'webhook', ''),
         l.name, l.email, l.phone, l.message, l.space_label, l.source, l.created_at
  from public.leads l join public.projects p on p.id = l.project_id
  where l.notified_at is null and l.created_at > now() - interval '7 days'
    and (coalesce(p.showroom ->> 'notify_email', '') <> '' or coalesce(p.showroom ->> 'webhook', '') <> '')
  order by l.created_at limit least(greatest(p_limit, 1), 200)
$$;
revoke execute on function public.pending_lead_notifications(int) from public, anon, authenticated;
grant  execute on function public.pending_lead_notifications(int) to service_role;

create or replace function public.mark_lead_notified(p_lead uuid)
returns void language sql security definer set search_path = '' as $$
  update public.leads set notified_at = now() where id = p_lead and notified_at is null
$$;
revoke execute on function public.mark_lead_notified(uuid) from public, anon, authenticated;
grant  execute on function public.mark_lead_notified(uuid) to service_role;

-- Revisores: pueden guardar vistas (las incidencias guardan su punto de vista).
-- Solo editan o borran las suyas; propietario y editores, todas.
drop policy if exists viewpoints_insert on public.viewpoints;
create policy viewpoints_insert on public.viewpoints for insert to authenticated
  with check (app.can_comment_project(project_id) and created_by = auth.uid());
drop policy if exists viewpoints_update on public.viewpoints;
create policy viewpoints_update on public.viewpoints for update to authenticated
  using (app.can_edit_project(project_id) or (created_by = auth.uid() and app.can_comment_project(project_id)))
  with check (app.can_comment_project(project_id));
drop policy if exists viewpoints_delete on public.viewpoints;
create policy viewpoints_delete on public.viewpoints for delete to authenticated
  using (app.can_edit_project(project_id) or created_by = auth.uid());

-- Seguridad de subidas y presupuesto conservador de pruebas gratuitas.
-- No modifica buckets heredados ni elimina archivos. Los cambios de este
-- archivo deben aplicarse junto al resto de migraciones, antes de habilitar la app.
-- 800 MB es un límite local al proyecto, no un medidor de egress ni garantía de
-- la cuota de toda la organización. Los buckets heredados conservan sus políticas.

revoke all on public.assets from authenticated;
grant select on public.assets to authenticated;
-- El cliente siempre crea rutas nuevas: no necesita upsert ni UPDATE.
drop policy if exists "agel media/models update" on storage.objects;
drop policy if exists "agel technical update" on storage.objects;

-- Límites por archivo para esta etapa de pruebas; modelos grandes usan APS.
update storage.buckets set file_size_limit = case when id='media' then 16777216 else 33554432 end
where id in ('media','models','technical');

create or replace function app.org_used_bytes(p_org uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.bytes), 0)::bigint
  from public.assets a join public.projects p on p.id=a.project_id
  where p.org_id=p_org
$$;

create or replace function public.reserve_upload(
  p_project uuid, p_bucket text, p_kind text, p_filename text, p_bytes bigint, p_mime text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_quota bigint; v_used bigint; v_path text; v_id uuid; v_cap bigint; v_global bigint;
begin
  if not app.can_edit_project(p_project) then
    raise exception 'No puedes subir archivos a este proyecto' using errcode = '42501';
  end if;
  if p_bucket not in ('media', 'models', 'technical') then raise exception 'Bucket no permitido'; end if;
  if p_bytes is null or p_bytes <= 0 then raise exception 'Tamaño inválido'; end if;
  -- Reserva conservadora: Storage puede omitir size en la comprobación previa.
  -- El máximo del bucket evita eludir cuota declarando un archivo pequeño.
  select file_size_limit into v_cap from storage.buckets where id = p_bucket;
  if v_cap is null or p_bytes > v_cap then raise exception 'Archivo demasiado grande para el modo gratuito'; end if;
  perform pg_catalog.pg_advisory_xact_lock(20261013, 12);
  if exists (select 1 from storage.objects where metadata->>'size' is null) then
    raise exception 'No se puede verificar el consumo de archivos; revisa Storage antes de subir' using errcode = '53400';
  end if;
  select coalesce(sum((metadata->>'size')::bigint), 0) into v_global from storage.objects;
  select v_global + coalesce(sum(greatest(a.bytes - coalesce((o.metadata->>'size')::bigint, 0), 0)), 0)
    into v_global from public.assets a left join storage.objects o on o.bucket_id=a.bucket and o.name=a.path
    where a.status='uploading';
  if v_global + v_cap > 800000000 then
    raise exception 'Margen gratuito de archivos alcanzado (800 MB); reduce archivos antes de continuar' using errcode = '53400';
  end if;
  p_bytes := v_cap;
  select org_id into v_org from public.projects where id = p_project;
  select quota_bytes into v_quota from public.organizations where id = v_org for update;
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
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assets; v_size bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(20261013, 12);
  select * into r from public.assets where id=p_asset for update;
  if r.id is null or not app.can_edit_project(r.project_id) then
    raise exception 'No puedes completar este archivo' using errcode='42501';
  end if;
  if r.status <> 'uploading' then raise exception 'Reserva ya completada'; end if;
  select (metadata->>'size')::bigint into v_size from storage.objects where bucket_id=r.bucket and name=r.path;
  if v_size is null or v_size <= 0 or v_size > r.bytes then
    raise exception 'Archivo ausente o tamaño fuera de la reserva';
  end if;
  if p_derived_from is not null and not exists (
    select 1 from public.assets where id=p_derived_from and project_id=r.project_id
  ) then raise exception 'El archivo original pertenece a otro proyecto'; end if;
  update public.assets set status='ready', bytes=v_size, width=p_width, height=p_height,
    sha256=p_sha256, derived_from=coalesce(p_derived_from,derived_from)
    where id=p_asset returning * into r;
  return to_jsonb(r);
end $$;
revoke execute on function public.reserve_upload(uuid,text,text,text,bigint,text) from public,anon;
revoke execute on function public.complete_upload(uuid,int,int,text,uuid) from public,anon;
grant execute on function public.reserve_upload(uuid,text,text,text,bigint,text) to authenticated;
grant execute on function public.complete_upload(uuid,int,int,text,uuid) to authenticated;

-- Una cascada no debe borrar el registro y dejar los blobs sin contabilizar.
create or replace function app.keep_asset_ledger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.assets where project_id=old.id) then
    raise exception 'Conserva el proyecto hasta limpiar sus archivos y reservas desde el servidor';
  end if;
  return old;
end $$;
drop trigger if exists projects_keep_asset_ledger on public.projects;
create trigger projects_keep_asset_ledger before delete on public.projects
for each row execute function app.keep_asset_ledger();
revoke all on function app.keep_asset_ledger() from public,anon,authenticated;

create table app.deployment_migrations(version text primary key, name text not null, sha256 text not null, applied_at timestamptz not null default now());
revoke all on app.deployment_migrations from public,anon,authenticated;
insert into app.deployment_migrations(version,name,sha256) values ('20261013000100','acceso','d16cb870e5429592813c50da09f60958df11ed21991aeb5be0248e7647bc6972');
insert into app.deployment_migrations(version,name,sha256) values ('20261013000200','storage','1106428f74d72cf38900fbcc36aec9e78d5ae6e723e0826391c51c803aaefd7d');
insert into app.deployment_migrations(version,name,sha256) values ('20261013000300','contenido','1e42c8197b7c3b053e9fdad003d1cc0c0183c64e4dec013ce33a791fb4038edc');
insert into app.deployment_migrations(version,name,sha256) values ('20261013000400','catalogo','94458f775acb14442a9a9207055b007ae30a8e42276e61bce16c95ccc92e1117');
insert into app.deployment_migrations(version,name,sha256) values ('20261013000500','publicaciones','6f8e7cf9a7fdba6bce682f482ecf96323b617e4451ea7ca1f1844f630610878f');
insert into app.deployment_migrations(version,name,sha256) values ('20261013000600','prospectos','6d1e432982d7abb5013f9cebeb4f2e39c301dd3ab6ca76cdf3611db36e9cfd48');
insert into app.deployment_migrations(version,name,sha256) values ('20261013000700','bim','99d5834f48d83c2affbd911d2ab2114f742aae24e937e3c5abfc516cca123f0c');
insert into app.deployment_migrations(version,name,sha256) values ('20261013000800','etapas_4d','090c424388d55008515e6304f5855a88b88f7c27bc4c365109426abc0b76a35b');
insert into app.deployment_migrations(version,name,sha256) values ('20261013000900','operacion','cd8f801f496a7fa7fa7ea4392cd1797f9218a222a873ce6345d2bd3549664fa9');
insert into app.deployment_migrations(version,name,sha256) values ('20261013001000','medicion','16043dc729666efd868d1c4373ddba3a6a06cdb42615ad46f826164f3bc3e1eb');
insert into app.deployment_migrations(version,name,sha256) values ('20261013001100','aps','526a4a0f7d35471bfcfa57e57c504d83044d8f4ca8be04de907443240f4caa67');
insert into app.deployment_migrations(version,name,sha256) values ('20261013001200','subidas_seguras','6a49fe4024d8bbd66e87f5329998c50054de057ff6fe765670084de4474ff134');
commit;
