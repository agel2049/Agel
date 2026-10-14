-- ═══════════════════════════════════════════════════════════════════════
--  AgelArq · Políticas de Storage (bucket "panoramas")
--  Registro versionado de lo que hay en Supabase y de lo que viene.
--  Se ejecuta a mano en: Supabase → SQL Editor → New query → Run.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. CONSULTAR EL ESTADO ACTUAL (solo lectura, se puede correr siempre) ──
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by cmd;

-- Resultado registrado el 13-oct-2026:
--
--   policyname                 cmd      roles
--   public_upload 1fcgrry_0    INSERT   {public}
--   public_select 1fcgrry_0    SELECT   {public}
--
-- Qué significa:
--   • SELECT público  → cualquiera descarga por URL. Es lo esperado: el visor
--                       de clientes lo necesita.
--   • INSERT público  → cualquiera con la llave anon puede SUBIR archivos.
--                       No puede borrar ni sobrescribir, pero sí consumir cuota.
--   • UPDATE / DELETE → no hay política = denegado. Nadie puede borrar ni
--                       sobrescribir, tampoco tú desde la app. Por eso
--                       "Eliminar" en el gestor de Supabase de la app falla
--                       (la app ahora lo explica en el aviso).
--
-- La llave anon/publicable PUEDE estar en el HTML: es pública por diseño.
-- Lo que decide qué se puede hacer son estas políticas. La llave que NUNCA
-- debe estar en el navegador es la "service_role" / secreta.


-- ── 2. CERRAR LA SUBIDA PÚBLICA ─────────────────────────────────────────
-- Está en su propio archivo para que no se ejecute por accidente:
-- supabase/manual/01-cerrar-subida-publica.sql (paso 8 de docs/PUBLICAR.md).

-- ── 3. COMPROBAR DESPUÉS DE CUALQUIER CAMBIO ──────────────────────────────
-- Las políticas se combinan con OR: basta UNA permisiva para anular las
-- restrictivas. Tras la fase 2, la consulta del punto 1 no debe mostrar
-- ninguna fila con cmd INSERT/UPDATE/DELETE y roles {public} o {anon}.
--
-- Una prueba de borrado sobre una ruta que NO existe no demuestra nada
-- (también falla con permisos abiertos). Para probar de verdad: subir un
-- archivo temporal, intentar borrarlo sin sesión (debe fallar) y con
-- sesión (debe funcionar), y confirmar en Storage que el estado final es
-- el esperado.
