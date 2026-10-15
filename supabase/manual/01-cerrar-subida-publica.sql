-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Cerrar la subida pública al bucket "panoramas"
--  Paso 8 de docs/PUBLICAR.md. Córrelo SOLO cuando ya entres con tu cuenta
--  y publiques desde la nube.
--
--  Con las migraciones de supabase/migrations, todo lo nuevo se guarda en el
--  bucket `media`, por carpeta de proyecto y con permisos por rol. El bucket
--  `panoramas` queda como archivo histórico: se sigue LEYENDO (los enlaces que
--  ya compartiste funcionan), pero nadie puede subir ni borrar.
--
--  Consecuencia: en el modo "Seguir sin cuenta" ya no se pueden crear
--  enlaces nuevos de visor (?visor=1&id=…). Para compartir, entra y usa Publicar.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "public_upload 1fcgrry_0" on storage.objects;

-- Comprobación: debe quedar solo la política de lectura del bucket panoramas.
select policyname, cmd, roles from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname ilike '%1fcgrry%';

-- Para deshacerlo (volver a permitir subir sin sesión):
--   create policy "public_upload 1fcgrry_0" on storage.objects
--   for insert to public with check ( bucket_id = 'panoramas' );
