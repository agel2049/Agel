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
