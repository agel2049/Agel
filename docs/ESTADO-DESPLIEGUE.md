# Estado del despliegue — 14 de octubre de 2026

Repositorio: agel2049/Agel. Rama de revisión: `codex/agelarq-plataforma-revisada`. Pull Request: https://github.com/agel2049/Agel/pull/1 (borrador). GitHub Pages publica desde `main`, raíz, en https://agel2049.github.io/Agel/.

## Supabase verificado

Proyecto `ajvijnvmvniafevcrqfj`, plan gratuito. Se aplicó el despliegue inicial de doce migraciones en una transacción. El texto ejecutado coincide por SHA-256 con el archivo probado: `afef642480860d2529ab517be46e80556b1fb9f53f3ee52b69955ebe34134ca7`.

La comprobación posterior confirmó:

- Doce versiones y hashes correctos en `app.deployment_migrations`.
- Veinticuatro tablas public, todas con RLS activada.
- El cliente autenticado no puede insertar, modificar ni borrar directamente `assets`.
- Un visitante no puede ejecutar `load_project_tree`.
- Veinticuatro objetos de Storage, 436,510,947 bytes: se conserva el inventario previo.
- Nuevos buckets `media` (máximo 16 MiB), `models` (32 MiB) y `technical` privado (32 MiB).
- La base física consultada mide 12,840,083 bytes; el panel de facturación puede mostrar una métrica distinta y actualizarse con retraso.

Se configuraron Site URL y dos retornos exactos del sitio (`/Agel/` e `/Agel/index.html`). Se cerró el registro público de nuevas cuentas; las cuentas se crean desde la administración de Supabase.

## Acceso y almacenamiento verificados

El propietario creó su cuenta directamente en Supabase. Se confirmó el acceso real con esa cuenta y el guardado central. La contraseña no se registró en este repositorio.

Se creó un borrador separado, `Verificación técnica — 14 oct 2026`, dentro de la organización de prueba del propietario. Una imagen sintética de 1,515 bytes y sus dos derivados suman 6,889 bytes. Los tres registros quedaron `ready` y coinciden con los tamaños reales de Storage. El proyecto y la escena persistieron al recargar. El proyecto `torre de departamentos` no fue modificado ni se publicó el borrador de verificación. El inventario posterior fue de 27 objetos, 436,517,836 bytes.

Se ejecutó el cierre del INSERT público heredado, conservando `public_select 1fcgrry_0`. Esto conserva la lectura de los enlaces históricos; las nuevas subidas requieren la cuenta y las reservas de la plataforma. El SQL para restaurar el permiso anterior está documentado en `supabase/manual/01-cerrar-subida-publica.sql`.

El commit funcional y la corrección de sincronización de la prueba de showroom pasaron los nueve grupos locales (129 pruebas funcionales y revisión de sintaxis) y las dos ejecuciones de GitHub Actions del commit `fe7e2ba`. Falta integrar el PR y comprobar el estado de publicación de GitHub Pages. Por indicación del propietario, no se continuarán pruebas del visor; la revisión funcional de la plataforma queda a cargo del propietario tras publicar.

Las funciones de Autodesk y avisos externos siguen pendientes de credenciales y verificación de costes. El margen de archivos no limita egress ni garantiza las cuotas de otros proyectos. No se cambió de plan ni se eliminaron archivos.

El historial privado de `app.deployment_migrations` no sustituye el historial de Supabase CLI: antes de un futuro `db push`, conciliar las versiones ya instaladas. No repetir el despliegue inicial; rechaza esquemas public que ya tengan tablas.
