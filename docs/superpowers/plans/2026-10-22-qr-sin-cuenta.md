# QR sin cuenta Implementation Plan

> Ejecución nativa en esta sesión; una revisión independiente al final. La autorización total de implementación y publicación del usuario sigue vigente y su solicitud actual autoriza explícitamente el acceso del visitante sin cuenta.

**Goal:** Abrir directamente la presentación del QR sin acceso al editor.
**Architecture:** Invitación cifrada con clave del enlace; señalización separada de la modalidad privada. El anfitrión permanece autenticado y el receptor usa solo configuración pública.
**Tech Stack:** JavaScript existente, Web Crypto, Realtime Broadcast y WebRTC.
**Spec:** docs/superpowers/specs/2026-10-22-qr-sin-cuenta-design.md

## Global Constraints
- No modificar el motor 360 ni probarlo manualmente; no entregar el GLB.
- No cambiar RLS ni ajustes de Supabase; no crear cuentas, filas o medios en nube.
- Preservar 30 minutos, un receptor y cierre remoto. El QR autoriza exclusivamente la presentación.

## Review Focus
- Nunca usar el token de cuenta del anfitrión en el receptor.
- Clave equivocada/tema manipulado: no llegan señales al peer.
- Modo privado: continúa exigiendo cuenta y no cambia a público tras un error.
- Visitante con otra cuenta abierta: no usa ni altera esa cuenta.
- Enlace expirado y cierre del equipo fuente: terminar presentación y liberar recursos.

### Task 1: Transporte de invitación
**Files:** packages/sharing/signal.js, peer.js; tests/unit_share_signal.cjs.
**Interfaces:** signal.open recibe presentation:boolean y guest:boolean; peer pasa presentation y fija guest según su rol. El modo predeterminado sigue siendo privado.
- [ ] Añadir tests RED de visitante sin identidad, tema derivado, cifrado/replay/clave errónea y anfitrión autenticado.
- [ ] Implementar SHA-256 con dominio para el tema y AES-GCM con AAD del tema. Solo guest+presentation omite Auth; anfitrión mantiene validaciones y observadores.
- [ ] Ejecutar unit_share_signal.cjs y preservar todas las regresiones privadas.

### Task 2: Presentación directa
**Files:** apps/share/index.html, receiver.js; apps/showroom/showroom.js; packages/sharing/share-ui.js; tests/unit_share_receiver.cjs, e2e_temporary_share.py, e2e_share_navigation.py.
**Interfaces:** receptor crea {url,anonKey} desde AGEL_CONFIG; abre peer.guest con presentation:true. La UI fuente usa peer.host con presentation:true. Showroom temporal no instancia AgelCloud.
- [ ] RED: navegador sin cuenta llega automáticamente al Opening; no formulario ni solicitudes de Auth/REST/Storage ni editor. Cuenta ajena abierta no cambia la visita.
- [ ] Retirar formulario/código de login del receptor y actualizar textos. Mantener auth del anfitrión.
- [ ] GREEN: unidades, navegación y flujo WebRTC con 80 MiB Opening, modelo por video, restart del worker y cierre.

### Task 3: Entrega
**Files:** docs/COMPARTIR-TEMPORALMENTE.md, docs/ENTREGA-COMPARTIR-TEMPORALMENTE.md.
- [ ] Actualizar guía, registrar cambio de autorización por QR y sus límites.
- [ ] Revisión independiente, pruebas afectadas y hash del motor; corregir hallazgos importantes con regresión.
- [ ] PR/CI, integración autorizada y comparación de archivos publicados.
