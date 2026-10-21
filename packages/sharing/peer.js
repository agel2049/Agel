/* One ephemeral receiver. No media tracks or camera permission requests. */
(function (root) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const NETWORK = 'No se pudo establecer la conexión directa. Prueba con ambos equipos en la misma red y vuelve a compartir.';
  function connect(role, options) {
    const { cloud, projectId, sessionId, key, expiresAt, onChannel, onState, iceServers, signalOpen } = options;
    const id = root.crypto.randomUUID();
    let closed = false, opening, signal, pc, channel, remote, selected = false, delivered = false, helloTimer, deadline, connecting;
    let queue = Promise.resolve(), outgoing = Promise.resolve(), pending = 0, candidates = [], localCandidates = [], localSent = false, resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    ready.catch(() => {});
    function state(value, message) { onState?.({ state: value, message }); }
    function close(reason = 'Sesión finalizada.', notify = true) {
      if (closed) return;
      closed = true;
      clearTimeout(deadline); clearTimeout(connecting); clearInterval(helloTimer);
      candidates = []; localCandidates = [];
      if (notify && remote && signal) {
        // AES encryption is async: flushing the final signal must precede socket
        // shutdown. The data plane closes immediately; control cleanup is <=1s.
        const current = signal;
        let finished = false;
        const release = () => { if (finished) return; finished = true; clearTimeout(drain); current.close(); };
        const drain = setTimeout(release, 1000);
        try { Promise.resolve(current.send({ type: 'close', from: id, to: remote })).then(release, release); }
        catch (_) { release(); }
      } else if (signal) signal.close(); else opening?.close?.(reason);
      if (channel) { channel.onopen = channel.onclose = channel.onerror = null; channel.close(); }
      if (pc) { pc.onicecandidate = pc.ondatachannel = pc.onconnectionstatechange = null; pc.close(); }
      rejectReady(new Error(reason));
      state('closed', reason);
    }
    function fail(error) { if (!closed) close(error?.message || NETWORK); }
    async function send(message) {
      if (closed) return;
      const envelope = { ...message, from: id, ...(remote ? { to: remote } : {}) };
      outgoing = outgoing.then(() => { if (!closed) return signal.send(envelope); });
      await outgoing;
    }
    function attach(data) {
      if (closed || channel && channel !== data || data.label !== 'agel-share') { data.close(); return; }
      channel = data;
      data.binaryType = 'arraybuffer';
      function opened() {
        if (closed || delivered || data.readyState !== 'open') return;
        delivered = true; clearTimeout(connecting); clearInterval(helloTimer);
        data.maxMessageSize = pc.sctp?.maxMessageSize || 16384;
        state('connected', 'Conexión temporal lista.');
        onChannel?.(data); resolveReady(data);
      }
      data.onopen = opened;
      data.onclose = () => close('El otro equipo finalizó la sesión.', false);
      data.onerror = () => close(NETWORK);
      opened();
    }
    function createPC() {
      if (closed) return;
      pc = new root.RTCPeerConnection({ iceServers: iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] });
      pc.onicecandidate = event => {
        if (closed || !event.candidate) return;
        const candidate = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
        if (localSent) send({ type: 'ice', candidate }).catch(fail);
        else if (localCandidates.length < 128) localCandidates.push(candidate);
      };
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) close(NETWORK); };
      pc.ondatachannel = event => { if (role === 'guest') attach(event.channel); else event.channel.close(); };
      state('connecting', 'Conectando directamente con el otro equipo…');
      if (!connecting) connecting = setTimeout(() => close(NETWORK), 30000);
      return pc;
    }
    async function flushLocalCandidates() {
      localSent = true;
      for (const candidate of localCandidates.splice(0)) { if (closed) return; await send({ type: 'ice', candidate }); }
    }
    async function applyCandidates() {
      if (closed || !pc?.remoteDescription) return;
      for (const candidate of candidates.splice(0)) { if (closed) return; await pc.addIceCandidate(candidate); }
    }
    async function message(m) {
      if (closed || !m || typeof m !== 'object' || !UUID.test(m.from) || m.from === id) return;
      if (m.type === 'hello' && role === 'host') {
        if (selected) return;
        remote = m.from; selected = true;
        const current = createPC(); attach(current.createDataChannel('agel-share', { ordered: true }));
        const offer = await current.createOffer(); if (closed) return;
        await current.setLocalDescription(offer); if (closed) return;
        await send({ type: 'offer', sdp: current.localDescription.sdp }); if (closed) return;
        await flushLocalCandidates(); return;
      }
      if (m.to !== id || remote && m.from !== remote) return;
      if (m.type === 'offer' && role === 'guest' && !selected && typeof m.sdp === 'string' && m.sdp.length <= 24000) {
        remote = m.from; selected = true; clearInterval(helloTimer);
        const current = createPC();
        await current.setRemoteDescription({ type: 'offer', sdp: m.sdp }); if (closed) return;
        await applyCandidates(); if (closed) return;
        const answer = await current.createAnswer(); if (closed) return;
        await current.setLocalDescription(answer); if (closed) return;
        await send({ type: 'answer', sdp: current.localDescription.sdp }); if (closed) return;
        await flushLocalCandidates(); return;
      }
      if (!selected || !pc) return;
      if (m.type === 'close') { close('El otro equipo finalizó la sesión.', false); return; }
      if (m.type === 'answer' && role === 'host' && !pc.remoteDescription && typeof m.sdp === 'string' && m.sdp.length <= 24000) {
        await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); if (closed) return;
        await applyCandidates(); return;
      }
      if (m.type === 'ice' && m.candidate && typeof m.candidate.candidate === 'string' && m.candidate.candidate.length <= 4096) {
        if (pc.remoteDescription) await pc.addIceCandidate(m.candidate);
        else if (candidates.length < 128) candidates.push(m.candidate);
      }
    }
    function onMessage(m) {
      if (closed || pending >= 128) return;
      pending++;
      queue = queue.then(() => message(m)).catch(fail).finally(() => { pending--; });
    }
    (async () => {
      if (!UUID.test(projectId) || !UUID.test(sessionId) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('El enlace temporal venció. Vuelve a compartir.');
      deadline = setTimeout(() => close('La sesión temporal venció.'), Math.min(expiresAt - Date.now(), 1800000));
      state('waiting', role === 'host' ? 'Esperando al celular…' : 'Buscando al equipo fuente…');
      opening = (signalOpen || root.AgelShareSignal.open)({ cloud, projectId, sessionId, key, onMessage, onClose: reason => close(reason, false) });
      const result = await opening;
      if (closed) { result.close(); return; }
      signal = result;
      if (role === 'guest') {
        connecting = setTimeout(() => close(NETWORK), 30000);
        await send({ type: 'hello' }); if (closed) return;
        helloTimer = setInterval(() => { if (!selected) send({ type: 'hello' }).catch(fail); }, 1000);
      }
    })().catch(fail);
    return { ready, close };
  }
  root.AgelSharePeer = Object.freeze({ host: options => connect('host', options), guest: options => connect('guest', options) });
})(globalThis);
