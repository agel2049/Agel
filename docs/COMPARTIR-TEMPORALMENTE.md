# Abrir tu showroom en otro dispositivo

## Desde tu computadora

1. Abre **Panel → tu proyecto** y guarda los cambios del showroom.
2. Pulsa **Compartir temporalmente**, junto a **Vista previa local**.
3. Escanea el QR desde el celular o copia el enlace.
4. Mantén abierta la pestaña de la computadora durante la visita.
5. Pulsa **Finalizar** para cortar el acceso. Cambiar de proyecto/cuenta, cerrar la pestaña o alcanzar 30 minutos también termina la sesión.

Cada sesión admite un receptor. El QR no publica el proyecto ni contiene sus archivos. Usa el borrador guardado al iniciar; para mostrar nuevos cambios, guarda y genera otro QR.

## Desde el celular

Abre el enlace en un navegador compatible con HTTPS. Si hace falta, inicia sesión con una cuenta que tenga acceso al proyecto. No tienes que reconstruir el catálogo, cargar los archivos ni sincronizar el proyecto.

Verás Opening, fachada, plantas y escenas según la configuración del showroom. Los medios se solicitan cuando se necesitan. Los videos usan rangos para poder reproducirlos y buscar sin descargar de golpe el archivo entero. La vista es de solo lectura y no envía solicitudes comerciales ni métricas de publicación.

**Maqueta virtual** abre una transmisión interactiva del 3D. Los controles se ejecutan en la computadora: vistas, giro, zoom, encuadre, desplazamiento y filtros disponibles. La computadora debe poder renderizar el modelo. La calidad y respuesta dependen de ambos equipos y de la conexión.

## Protección de tu modelo

El **GLB permanece en la computadora**: no se entrega su geometría al celular ni se incluye entre los recursos descargables de la sesión. El teléfono recibe imágenes del modelo, con una marca de agua incorporada en los píxeles. No se usa cámara, micrófono ni captura del escritorio para generar la transmisión.

Este modo no permite colocar ese modelo mediante AR local en el celular, porque para hacerlo el dispositivo necesita la geometría. Tu visor local y su opción AR se mantienen para los equipos donde tú agregas el archivo.

No existe protección absoluta frente a capturas o grabación de pantalla. Los renders, panorámicas y videos enviados al navegador también pueden recuperarse con herramientas avanzadas. Cifrado, cuentas del proyecto, sesión limitada y cierre remoto controlan el acceso; no son DRM. Esta protección del GLB corresponde al intercambio temporal: publicar un GLB como archivo en una URL accesible tiene un alcance distinto.

## Almacenamiento y conexión

- Los medios temporales no se guardan en el catálogo, IndexedDB ni CacheStorage del receptor. Se usan streams y memoria del navegador, con respuestas `no-store`.
- Supabase intercambia únicamente pequeñas señales privadas cifradas para conectar los equipos; no recibe los videos, imágenes ni modelos del intercambio. No se crean filas ni publicaciones para compartir.
- El código del Service Worker queda limitado a la ruta de recepción. No guarda medios ni ofrece un modo sin conexión.
- No se habilita TURN de pago. Si la red bloquea una conexión directa, aparecerá un error. Prueba otra red o ambos equipos en una red doméstica que permita comunicación entre dispositivos; las redes de invitados pueden bloquearla incluso usando el mismo Wi-Fi.
- El enlace necesita un navegador con WebRTC y Service Workers; la página debe abrirse mediante HTTPS, salvo localhost para pruebas.

## Verificación

Las pruebas automatizadas usan proyectos y modelos sintéticos. Verifican permisos por proyecto, rechazo anónimo/ajeno, señalización privada, transferencia por rangos, cancelaciones, cierre y ausencia del GLB entre los archivos compartidos. La validación integrada en navegadores y la publicación se registran en el reporte de entrega. No se afirma una prueba física de AR en un teléfono.

Referencias oficiales: [canales de datos WebRTC](https://webrtc.org/getting-started/data-channels), [autorización Realtime](https://supabase.com/docs/guides/realtime/authorization) y [captura del canvas como MediaStream](https://www.w3.org/TR/mediacapture-fromelement/).
