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
