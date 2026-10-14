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

## Pendientes antes de fusionar a main

1. Cuenta de la app creada por el propietario directamente en Supabase y confirmada en la lista de usuarios. La contraseña la eligió el propietario; no se registró en este repositorio.
2. Verificar inicio de sesión, guardado y una subida autenticada de un archivo pequeño.
3. Cerrar el INSERT público del bucket heredado con el procedimiento manual, conservando las descargas y enlaces existentes. Mientras siga abierto, sus subidas eluden el margen de la app.
4. Confirmar las pruebas automáticas del commit final y revisar el Pull Request.

Las funciones de Autodesk y avisos externos siguen pendientes de credenciales y verificación de costes. El margen de archivos no limita egress ni garantiza las cuotas de otros proyectos. No se cambió de plan ni se eliminaron archivos.

El historial privado de `app.deployment_migrations` no sustituye el historial de Supabase CLI: antes de un futuro `db push`, conciliar las versiones ya instaladas. No repetir el despliegue inicial; rechaza esquemas public que ya tengan tablas.
