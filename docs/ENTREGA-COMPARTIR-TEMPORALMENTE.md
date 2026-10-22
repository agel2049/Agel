# Entrega de compartición temporal — 22 de octubre de 2026

Implementación y seguimiento: [PR #5](https://github.com/agel2049/Agel/pull/5). Instrucciones: [Compartir temporalmente](COMPARTIR-TEMPORALMENTE.md).

## Resultado

El panel permite generar un QR para abrir el borrador guardado en otro dispositivo con una cuenta del proyecto. La sesión admite un receptor y dura hasta 30 minutos. El equipo fuente conserva los archivos y debe permanecer abierto.

El GLB se renderiza en la computadora. El celular recibe video con marca de agua incorporada, vistas, zoom, giro, desplazamiento táctil y filtros. No se entrega su geometría. Opening, renders y panorámicas utilizan transferencia directa por rangos. El receptor no guarda medios en IndexedDB ni CacheStorage, y no crea publicaciones, métricas o prospectos.

Supabase recibió únicamente dos políticas privadas de Broadcast, `agel_share_receive` y `agel_share_send`. Registro de migración: `20261021001700`, checksum `76916454754402a90f07fe24371460ca1f2f410088c72ea74552829912a31b72`. No se subieron medios ni se habilitaron servicios de pago. La señalización también consume conexiones y mensajes de Realtime; este modo evita almacenamiento de medios, pero no promete uso ilimitado gratuito.

## Evidencia de verificación

- 99 pruebas unitarias, 53 pruebas de permisos en Postgres local, 14 de funciones con Autodesk simulado y 19 de clasificación/4D.
- Dos contextos Chromium aislados con WebRTC real: Opening reproducible de 80 MiB, rangos 206, fachada/lobby, píxeles del modelo filtrado, controles y cierre remoto. Cero transferencias GLB y cero escrituras de medios en el receptor.
- Reinicio real del Service Worker durante la visita: la siguiente petición recupera el receptor activo sin persistencia. Se conserva el aislamiento entre pestañas y se rechazan propietarios ambiguos.
- Regresiones de borrador, maqueta, navegación, Opening, escenas y retorno. Los anclajes normales y la renovación de token de la misma cuenta conservan la sesión; cambiar de cuenta la termina.
- Motor 360 sin modificaciones ni pruebas manuales. SHA-256: `05b2f1588586795faa2038c19fc33dc5109555f8cdcaa7122215330501e12e56`.
- CI completo y estado de integración: consultar las comprobaciones del PR enlazado. Las pruebas físicas y la conexión autenticada en producción no quedan acreditadas por estas pruebas locales.

## Revisión y decisiones

Las revisiones independientes de protocolos, integración y modelo no dejaron hallazgos críticos o importantes pendientes tras las correcciones. Se corrigieron pérdida de sesión por anclas, imágenes de planos que abrían otra pestaña, falta de desplazamiento táctil, giro desincronizado, ausencia del primer fotograma y pérdida de vínculo al reiniciar el Service Worker. Cada fallo funcional tuvo reproducción y regresión.

| Tema considerado | Decisión y alcance | Consecuencia práctica |
| --- | --- | --- |
| GLB y AR | El original permanece en la computadora; AR del modelo transmitido se excluye según la elección del usuario. | Para AR local se necesita entregar geometría al dispositivo. |
| Capturas y otros medios | No se promete DRM. El video 3D puede grabarse y los medios entregados al navegador pueden recuperarse. | La protección conserva el archivo GLB, no impide toda copia visual. |
| Revocación de membresía | Se conserva el ciclo de autorización de Realtime, que puede mantener permisos de una conexión existente hasta refrescar el token. | Para cortar inmediatamente una visita, usar **Finalizar** en la computadora. Límite máximo: 30 minutos. |
| Redes restrictivas | Sin TURN de pago. Se muestra un error si no es posible conectar directamente. | Algunas redes móviles, corporativas o Wi-Fi de invitados impedirán la visita. |
| Estado del borrador | Los datos comerciales se capturan al iniciar. La maqueta se abre bajo demanda desde el borrador fuente. | Conviene guardar y no cambiar el modelo durante la sesión; generar otro QR tras editar. |
| Validación externa | No se acredita prueba física en teléfono, Safari, AR ni rendimiento con el modelo real del usuario. | Hardware, red y tamaño pueden afectar calidad y respuesta. |
| Dependencia QR | Compilado local de Nayuki 1.8.0, licencia MIT y checksum documentados. Se conserva el archivo vendorizado, incluido su espacio final generado. | El enlace no se envía a un generador de QR externo. |

## Uso

Guardar el borrador → **Compartir temporalmente** → escanear QR → iniciar sesión con una cuenta del proyecto. Mantener el equipo fuente abierto y pulsar **Finalizar** al concluir. Para la guía completa, consultar el documento enlazado al inicio.
