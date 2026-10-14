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
