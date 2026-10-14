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
