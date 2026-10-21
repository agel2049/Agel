# Compartir temporalmente Implementation Plan

> **For agentic workers:** Use the independent protocol tasks in parallel, then integrate and perform an independent whole-branch review. Steps use checkbox syntax.

**Goal:** Abrir el showroom local en el celular mediante QR sin publicar sus medios.
**Architecture:** Broadcast privado cifrado para señales; DataChannel para medios por rangos; Service Worker sin persistencia para servir el showroom existente.
**Tech Stack:** JavaScript clásico, WebRTC, WebSocket Realtime 1.0.0, AES-GCM, Service Worker, Node y Playwright.
**Spec:** docs/superpowers/specs/2026-10-21-compartir-temporal-design.md

## Global Constraints
- No modificar packages/panorama/pano-engine.js ni probar manualmente el visor 360.
- No medios en Supabase/IndexedDB/CacheStorage del receptor. No TURN pago ni planes nuevos.
- Canal privado y membresía del proyecto; no tokens al otro dispositivo. Sesión 30 min y un receptor.
- URLs de medios propias HTTPS (localhost permitido para pruebas); nombre .glb preservado.

## Review Focus
- SDP tardío tras cerrar: no cámara/datos ni PC residual.
- Rangos inválidos, archivo vacío y tamaños >4 GiB: cabeceras correctas y memoria acotada.
- Solicitudes de otro recurso/proyecto, mensajes falsos y clave incorrecta: rechazar sin filtrar datos.
- Cierre durante lectura o vídeo: abortar streams, sin guardar copias.
- QR tardío, red aislada, cuenta cambiada: error accionable y recursos liberados.

### Task 1: Señalización privada y negociación
**Files:** packages/sharing/signal.js, packages/sharing/peer.js; tests/unit_share_signal.cjs; supabase/migrations/20261021001700_temporary_sharing.sql; pruebas SQL/emulación.
**Interfaces:** AgelShareSignal.open({cloud,projectId,sessionId,key,onMessage,onClose}) => Promise<{send(message),close()}>. key es base64url de 32 bytes. AgelSharePeer.host/guest({cloud,projectId,sessionId,key,expiresAt,onChannel,onState,signalOpen?,iceServers?}) => {ready:Promise,close()}. onChannel recibe DataChannel abierto. onState recibe {state,message}. Los constructores regresan sin esperar para permitir cierre durante inicio.
- [ ] RED: canal no público, cifrado/autenticación, key inválida y cierre tardío. `node --test tests/unit_share_signal.cjs`.
- [ ] Implementar mensajes pequeños, heartbeat/token, timeout y PC sin permisos de cámara. Probar los permisos por proyecto con Postgres.
- [ ] GREEN y commit de sus archivos.

### Task 2: Transferencia acotada y medios HTTP
**Files:** packages/sharing/transfer.js; apps/share/media-worker.js; tests/unit_share_transfer.cjs; pruebas de SW si corresponden.
**Interfaces:** AgelShareTransfer.serve(channel,{assets,onClose,onProgress}) => {close()}; assets Map<string,{getBlob:async()=>Blob}>. AgelShareTransfer.receive(channel,{onClose,onProgress}) => {pipe(asset,range,MessagePort),fetchBlob(asset,maxBytes?),close()}. El recurso especial 'manifest' es JSON con {snapshot,expiresAt}. pipe contesta {op:'headers',status,headers}, {op:'chunk',chunk:ArrayBuffer}, {op:'end'} o {op:'error',message}; el port solicita {op:'pull'} y {op:'cancel'}. IDs de solicitudes numéricos internos; no elegidos por receptor externo. SW solicita al cliente {type:'agel-share-fetch',session,asset,range} con port transferido.
- [ ] RED: rangos completos/parciales/sufijos/416/vacío; bytes exactos; pull/cancel/cierre; recursos desconocidos y límites. `node --test tests/unit_share_transfer.cjs`.
- [ ] Implementar frames binarios con uint32 requestId + bloque <=60 KiB, cola <=1 MiB, 16 solicitudes. MIME de medios, no-store, nosniff. SW solo apps/share/media/<session>/<asset>.<ext>, streams sin CacheStorage/IndexedDB.
- [ ] GREEN y commit de sus archivos.

### Task 3: UI, exportación segura e integración
**Files:** packages/core/workspace.js; packages/sharing/share-ui.js; apps/share/index.html, receiver.js, share.css; apps/panel/media-controls.js,index.html; apps/showroom/showroom.js.
**Interfaces:** workspace.sharePackage() => {snapshot,assets:Map}; snapshot es raw formato sanitizeShowroom con URLs https://agel-share.invalid/<asset>.<ext>. Sólo campos comerciales/escenas referenciadas, sin privateSettings. Host mapea refs propios mediante getBlob. Receptor valida snapshot, sustituye placeholders por URLs del Service Worker y expone window.AgelTemporarySession={ready:Promise<modelo normalizado>,onClose(fn)} antes de cargar showroom.js. AgelTemporaryShare.open({workspace,rootUrl?}) muestra diálogo/controla su cierre.
- [ ] RED: QR/botón ausentes y exportar manifiesto conserva escena/planta/Opening/GLB, excluye privados. Prueba dos contextos WebRTC real con señalización local de prueba.
- [ ] Implementar UI con identidad actual y QR local (dependencia vendorizada con licencia, sin enviar enlace a generador externo); estado, copiar, expirar, cierre/cuenta/proyecto. Reutilizar showroom en preview temporal (sin métricas/prospectos). Maqueta integrada para URLs .glb. Mostrar error de red directa sin crear TURN.
- [ ] GREEN: vídeos por rangos, binarios, restricciones de recursos, cero escrituras y cierre remoto; suites existentes afectadas.

### Task 4: Revisión y publicación
**Files:** .github/workflows/pruebas.yml; docs/COMPARTIR-TEMPORALMENTE.md; reporte de entrega.
- [ ] Ejecutar `node --test tests/unit_*.cjs`, sintaxis incluyendo apps/share/index.html, pruebas nuevas y afectadas; comprobar hash del motor.
- [ ] Revisión independiente: lifecycle, permisos, tamaño/metadatos, SW y protocolos. Corregir hallazgos con regresiones.
- [ ] Aplicar solo las dos políticas Realtime revisadas en Supabase y comprobar usuario ajeno/anónimo bloqueados, canal propio permitido; sin subir medios reales.
- [ ] PR, CI completo, merge autorizado, Pages y archivos desplegados comprobados. Documentar redes/hardware no validados y límite de conectividad sin TURN.
