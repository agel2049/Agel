# Compartir temporalmente con un celular

Objetivo autorizado: abrir el showroom local mediante un QR, sin volver a armar el proyecto en el teléfono ni cargar sus medios a Supabase. Incluye Opening, fachada, plantas y escenas; el GLB se renderiza únicamente en la computadora fuente y se transmite su imagen interactiva, por elección expresa del usuario para proteger su original. El equipo fuente permanece abierto; lectura temporal, sin guardar proyectos/medios en IndexedDB del receptor. Se conserva el requisito de cuenta del equipo para contenido BIM.

## Flujo
En el panel, junto a Vista previa local, Compartir temporalmente abre una sesión de 30 minutos para un receptor. Muestra QR, copiar enlace, estado y Finalizar. Usa el último borrador guardado; indica guardar cambios primero. Cerrar el diálogo, cambiar proyecto/cuenta, cerrar pestaña o agotar el plazo termina la transferencia. El receptor inicia sesión si hace falta, conecta y abre el mismo showroom con un aviso discreto y botón Salir. No se crean publicaciones, prospectos ni métricas.

## Arquitectura
Supabase Realtime Broadcast privado intercambia solamente señales de conexión, cifradas con AES-GCM usando una clave aleatoria en el fragmento del QR. Dos políticas de realtime.messages autorizan solo miembros del proyecto, sin filas ni archivos persistentes. Protocolo WebSocket 1.0.0 documentado, JWT solo en payload de acceso. No alterar otras políticas ni activar servicios pagos.

WebRTC MediaStream transmite la imagen de un canvas del modelo, con marca de agua incrustada. El GLB y su geometría nunca entran al manifiesto ni al mapa de recursos. Los controles remotos se limitan a vistas, giro, zoom, desplazamiento, encuadre y filtros. No se ofrece AR en el celular para este modelo remoto. Las capturas de pantalla siguen siendo posibles; renders/videos/panorámicas también son recuperables por un usuario avanzado y no se promete DRM.

WebRTC DataChannel fiable/ordenado transfiere recursos comerciales permitidos por un manifiesto inmóvil de esa sesión. Solicitud de recurso, cabecera, pull de bloques binarios y cancelación; solicitudes multiplexadas y cola acotada. Rangos HTTP permiten reproducir y buscar videos sin cargar el archivo completo en RAM. Solo se leen archivos referenciados, nunca otros proyectos ni una URL enviada por el receptor. No hay límite artificial de tamaño de archivo; sí límites de metadatos (4 MiB), solicitudes simultáneas (16) y búfer de red.

Un Service Worker limitado a apps/share/ responde a URLs de medios de sesión mediante streams y MessagePorts del cliente conectado. No usa CacheStorage ni IndexedDB. Marca respuestas no-store/nosniff, acepta solo tipos de medios y no expone documentos ejecutables. El nuevo receptor reutiliza schema/render/experience/showroom y el motor panorámico intacto. El manifiesto recibido vuelve a pasar por sanitizeShowroom antes de renderizar.

Se usa conexión directa con STUN público. No se configura TURN de pago ni se promete funcionar en toda red; después de una espera acotada se explica cómo reintentar con ambos equipos en la misma red. La cámara AR sigue requiriendo HTTPS y dispositivo compatible.

## Aislamiento y cierre
IDs de sesión/recursos aleatorios; clave de enlace 256 bits; cifrado autenticado antes de interpretar SDP. Una sesión acepta un receptor. Señales con ID de receptor y destino; ignorar mensajes propios/tardíos. Autorización privada por proyecto, no canal público como fallback. Al cerrar se cancelan lecturas, PCs, socket, temporizadores y streams. Cambios de cuenta destruyen sesión local. No se transfieren tokens, credenciales, ajustes privados, UUID de usuarios ni datos técnicos APS.

## Verificación
Pruebas unitarias de rangos/multiplexación/cancelación, permisos SQL con usuario ajeno/anónimo, protocolo privado/cifrado, desconexiones y sesión tardía. Prueba en dos contextos reales Chromium con WebRTC real y señalización de prueba: Opening grande por rangos, plantas, transmisión de imagen del modelo sin transferir su original, cero escrituras de medios/DB y cierre remoto. No probar manualmente el visor 360 ni modificar packages/panorama/pano-engine.js. AR física sigue pendiente. CI completa antes de publicar y verificación de archivos desplegados.
