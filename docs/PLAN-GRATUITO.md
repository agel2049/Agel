# AgelArq: operación durante la prueba gratuita

Verificación del 13 de octubre de 2026. Proyecto `ajvijnvmvniafevcrqfj`.

El panel indica Free, base 26/500 MB y archivos 0.44/1 GB. Consulta de solo lectura: 24 objetos, 436,510,947 bytes, ningún objeto sin tamaño. La base física consultada mide 11,201,683 bytes; es una métrica distinta de la cifra del panel. Los contadores de transferencia muestran 0.00 GB al consultar; pueden actualizarse con retraso y no acreditan que se haya resuelto el aviso anterior de gracia.

## Límites distintos

- Base de datos: 500 MB por proyecto en Free.
- Archivos: 1 GB, compartido con el resto de proyectos de la organización.
- Transferencia sin caché: 5 GB por ciclo.
- Transferencia con caché: otros 5 GB por ciclo, con contador independiente.

Referencia: [límites y facturación](https://supabase.com/docs/guides/platform/billing-on-supabase), [transferencia y caché](https://supabase.com/docs/guides/storage/serving/bandwidth).

## Protección implementada en la migración 12

La app rechaza una nueva reserva cuando los archivos existentes de todos los buckets del proyecto y las reservas pendientes superan 800,000,000 bytes. Reserva primero el máximo del bucket (16 MiB para media; 32 MiB para models y technical), y solo reduce el cargo al verificar el tamaño real del objeto. Esto evita depender del tamaño que declare el navegador. Las reservas incompletas conservan su cargo hasta una limpieza supervisada desde servidor.

El cliente no puede alterar ni borrar el registro de consumo. Los archivos usan rutas nuevas y no se sobrescriben. El navegador recibe una caché de siete días para las nuevas subidas; el showroom ya mantiene un pequeño caché de texturas y descarga la panorámica al entrar al recorrido. No se activan transformaciones de imágenes de pago.

## Límites de esta protección

El margen de 800 MB protege las nuevas subidas de la app en este proyecto. No limita archivos que se suban por el dashboard, por otros proyectos, por procesos de servidor ni por el antiguo bucket panoramas mientras conserve INSERT público. Antes del lanzamiento hay que cerrar esa política con el procedimiento manual, conservando la lectura de enlaces existentes y verificando primero una subida autenticada.

La cuota de archivos no controla los GB descargados. Cada visita puede consumir transferencia incluso con un archivo pequeño. La caché del navegador reduce descargas repetidas; los aciertos de caché de Supabase siguen consumiendo su cuota de cached egress. No se puede prometer un tope estricto de transferencia con URLs públicas de Supabase. Durante las pruebas mantener enlaces de difusión limitada, portadas ligeras, sin precarga masiva ni video automático. Si se necesita un tope estricto, se debe diseñar un punto de entrega controlado con medición antes de abrir el showroom al público.

No borrar archivos para intentar reducir el contador de transferencia: el consumo ya registrado no se deshace. Cualquier limpieza requiere inventario y copia aprobada de los archivos afectados. No cambiar plan ni contratar servicios.

## Pruebas y despliegue

Ejecutar las pruebas con Postgres/PostgREST y Auth/Storage simulados en local; no probar cargas repetidas contra producción. Aplicar las migraciones en una transacción y comprobar base, buckets y políticas después. No activar APS real ni notificaciones externas sin configurar sus credenciales y validar sus requisitos de coste.
