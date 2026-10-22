/* Private, ephemeral Realtime signaling. Only encrypted connection metadata leaves this module.
 * Wire protocol: https://supabase.com/docs/guides/realtime/protocol (1.0.0). */
(function (root) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX_TEXT = 32768, MAX_WIRE = 65536;
  const encode = bytes => root.btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decode = value => Uint8Array.from(root.atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  function open(options) {
    let cancel = () => {};
    const promise = new Promise((resolve, reject) => {
      const { cloud, projectId, sessionId, key, onMessage, onClose } = options;
      let ws, cryptoKey, closed = false, joined = false, ref = 1, heartbeatRef = null;
      let offAuth, timeout, heartbeat, inbound = Promise.resolve(), pending = 0;
      const seen = new Set(), encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
      const topic = `realtime:agel-share:${projectId}:${sessionId}`, aad = encoder.encode(topic);
      const identity = cloud?.user?.id;
      function push(event, payload, target = topic, reference = String(++ref)) {
        if (closed || ws?.readyState !== 1) throw new Error('La conexión temporal está cerrada.');
        ws.send(JSON.stringify({ topic: target, event, payload, ref: reference, join_ref: target === topic ? '1' : null }));
        return reference;
      }
      function close(reason = 'Sesión finalizada.') {
        if (closed) return;
        closed = true;
        clearTimeout(timeout); clearInterval(heartbeat); offAuth?.();
        root.removeEventListener?.('storage', storageChanged);
        root.removeEventListener?.('pagehide', pageHidden);
        seen.clear();
        if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); }
        if (!joined) reject(new Error(reason));
        onClose?.(reason);
      }
      cancel = close;
      function pageHidden() { close(); }
      function storageChanged(event) {
        if (event.key !== null && event.key !== (cloud.storageKey || 'agel.session')) return;
        try {
          const session = JSON.parse(event.newValue || 'null');
          if (session?.user?.id !== identity) close('Cambió la cuenta. Vuelve a abrir el enlace.');
        } catch (_) { close('Cambió la cuenta. Vuelve a abrir el enlace.'); }
      }
      const api = {
        async send(message) {
          if (closed || !joined) throw new Error('La conexión temporal está cerrada.');
          const text = JSON.stringify(message);
          if (!text || encoder.encode(text).length > MAX_TEXT) throw new Error('Señal demasiado grande.');
          const iv = root.crypto.getRandomValues(new Uint8Array(12));
          const ciphertext = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, cryptoKey, encoder.encode(text));
          if (closed) throw new Error('La conexión temporal está cerrada.');
          if (ws.bufferedAmount > MAX_WIRE * 4) { close('La conexión temporal está saturada.'); throw new Error('Conexión saturada.'); }
          push('broadcast', { type: 'broadcast', event: 'signal', payload: { v: 1, iv: encode(iv), data: encode(ciphertext) } });
        }, close
      };
      async function receive(packet) {
        if (closed || !joined || packet?.v !== 1 || typeof packet.iv !== 'string' || packet.iv.length !== 16 || !/^[\w-]+$/.test(packet.iv) || typeof packet.data !== 'string' || packet.data.length > 44000 || !/^[\w-]+$/.test(packet.data) || seen.has(packet.iv)) return;
        try {
          const bytes = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(packet.iv), additionalData: aad }, cryptoKey, decode(packet.data));
          if (closed || bytes.byteLength > MAX_TEXT || seen.has(packet.iv)) return;
          const message = JSON.parse(decoder.decode(bytes));
          if (!message || typeof message !== 'object' || Array.isArray(message)) return;
          if (seen.size >= 4096) { close('Límite de señales alcanzado. Vuelve a compartir.'); return; }
          seen.add(packet.iv);
          onMessage?.(message);
        } catch (_) { /* Unauthenticated or malformed signals never reach the peer. */ }
      }
      (async () => {
        if (!UUID.test(projectId) || !UUID.test(sessionId) || typeof key !== 'string' || !/^[\w-]{43}$/.test(key)) throw new Error('Enlace temporal inválido.');
        const rawKey = decode(key);
        if (rawKey.length !== 32 || encode(rawKey) !== key) throw new Error('Clave temporal inválida.');
        if (!identity || !cloud.anonKey || !cloud.url || !cloud.onAuth) throw new Error('Inicia sesión con una cuenta del equipo.');
        timeout = setTimeout(() => close('No se pudo abrir el canal privado. Reintenta la conexión.'), 15000);
        root.addEventListener?.('storage', storageChanged); root.addEventListener?.('pagehide', pageHidden);
        offAuth = cloud.onAuth(session => {
          if (session?.user?.id !== identity) { close('Cambió la cuenta. Vuelve a abrir el enlace.'); return; }
          if (joined && session.access_token) { try { push('access_token', { access_token: session.access_token }); } catch (_) { close('Se perdió la sesión.'); } }
        });
        const token = await cloud.accessToken();
        if (closed) return;
        if (!token || cloud.user?.id !== identity) throw new Error('Inicia sesión con una cuenta del equipo.');
        cryptoKey = await root.crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
        rawKey.fill(0);
        if (closed) return;
        const url = new URL(cloud.url);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('La conexión requiere HTTPS.');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = `${url.pathname.replace(/\/$/, '')}/realtime/v1/websocket`;
        url.search = ''; url.hash = ''; url.searchParams.set('apikey', cloud.anonKey); url.searchParams.set('vsn', '1.0.0');
        ws = new root.WebSocket(url.href);
        ws.onopen = () => {
          try { push('phx_join', { config: { private: true, broadcast: { ack: false, self: false }, presence: { enabled: false }, postgres_changes: [] }, access_token: cloud.session?.access_token || token }, topic, '1'); }
          catch (_) { close('No se pudo abrir el canal privado.'); }
        };
        ws.onerror = () => close('No se pudo conectar al canal privado.');
        ws.onclose = () => close('Se perdió la conexión temporal.');
        ws.onmessage = event => {
          if (closed || typeof event.data !== 'string' || event.data.length > MAX_WIRE) return;
          let frame; try { frame = JSON.parse(event.data); } catch (_) { return; }
          if (frame.topic === 'phoenix' && frame.event === 'phx_reply' && frame.ref === heartbeatRef && frame.payload?.status === 'ok') { heartbeatRef = null; return; }
          if (frame.topic !== topic) return;
          if (frame.event === 'phx_error' || frame.event === 'phx_close' || (frame.event === 'system' && frame.payload?.status === 'error')) { close('El canal privado rechazó la conexión.'); return; }
          if (frame.event === 'phx_reply' && frame.ref === '1' && !joined) {
            if (frame.payload?.status !== 'ok') { close('Tu cuenta no tiene acceso al proyecto.'); return; }
            joined = true; clearTimeout(timeout);
            heartbeat = setInterval(() => {
              if (heartbeatRef) { close('Se perdió la conexión temporal.'); return; }
              try { heartbeatRef = push('heartbeat', {}, 'phoenix'); } catch (_) { close('Se perdió la conexión temporal.'); }
            }, 20000);
            resolve(api); return;
          }
          if (frame.event === 'broadcast' && frame.payload?.event === 'signal' && pending < 64) {
            pending++;
            inbound = inbound.then(() => receive(frame.payload.payload)).finally(() => { pending--; });
          }
        };
      })().catch(error => close(error.message || 'No se pudo abrir la sesión temporal.'));
    });
    // Peers can cancel startup before the authenticated join resolves.
    promise.close = reason => cancel(reason);
    return promise;
  }
  root.AgelShareSignal = Object.freeze({ open });
})(globalThis);
