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
