# Presentación temporal por QR sin cuenta

El visitante abre el QR y ve la presentación directamente. Solo la computadora que comparte requiere cuenta del proyecto. El visitante no recibe sesión, permisos, editor, datos técnicos privados ni el GLB original. Se mantienen un receptor, 30 minutos, cierre remoto y transferencia de medios sin persistencia.

La invitación pasa a autorizarse mediante la clave aleatoria de 256 bits del fragmento del enlace. El modo nuevo usa un tema separado `agel-view:<project>:<session>:<SHA256(domain + key)>` y Broadcast público exclusivamente como transporte de señales cifradas y autenticadas con AES-GCM. El tema nunca contiene la clave de cifrado. El modo privado existente conserva sus permisos y no cambia como fallback. Un receptor sin la clave no puede producir señales válidas aunque conozca el tema; los datos siguen viajando por WebRTC. La persona que tenga el QR sí puede reenviarlo: esta es la autorización solicitada por el usuario.

El receptor usa solamente la configuración pública de conexión y nunca llama al cliente de cuenta, al login, al catálogo o al almacenamiento del proyecto. El anfitrión conserva los controles de cuenta y cambio de proyecto. La señalización conserva límites, protección de replay y cierre; el equipo fuente impone la expiración. No se modifican políticas RLS, tablas, planes ni ajustes de Supabase. La prueba de capacidad confirmó que el proyecto ya acepta Broadcast público sin cambiar configuración.

Se verifican apertura automática en navegador sin sesión, ausencia de peticiones de Auth/REST/Storage del receptor, señales cifradas, clave equivocada y modo privado sin degradación, expiración/cierre, aislamiento de editor y GLB retenido en fuente. Se actualiza la guía y se publica mediante PR con revisión independiente.

Fuentes: [Broadcast](https://supabase.com/docs/guides/realtime/broadcast), [conceptos de Realtime](https://supabase.com/docs/guides/realtime/concepts). Son transportes distintos; el modo nuevo aplica autorización criptográfica por invitación sobre el transporte público, no RLS de membresía.
