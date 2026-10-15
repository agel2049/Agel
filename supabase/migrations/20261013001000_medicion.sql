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
