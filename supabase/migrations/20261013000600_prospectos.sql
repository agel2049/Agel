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
