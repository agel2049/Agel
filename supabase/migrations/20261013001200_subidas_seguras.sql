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
