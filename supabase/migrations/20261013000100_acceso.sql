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
