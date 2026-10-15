/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · adaptador del visor de Autodesk (APS Viewer v7) — fase 4

   Todo lo que la app usa del visor pasa por aquí, en una interfaz pequeña:
   si Autodesk cambia algo, se corrige en un solo archivo, y las pruebas
   pueden sustituir el visor por uno simulado con la misma interfaz.

   AgelAPS.open(contenedor, { urn, getToken }) → BimView
   AgelBIMUpload.upload(cloud, versionId, archivo, onProgress) → { upload_key }
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const DEF_SCRIPT = 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js';
  const DEF_STYLE = 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css';

  let sdk = null;
  function loadSDK() {
    if (root.Autodesk && root.Autodesk.Viewing) return Promise.resolve();
    if (sdk) return sdk;
    const cfg = root.AGEL_CONFIG || {};
    sdk = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = cfg.apsViewerStyle || DEF_STYLE;
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = cfg.apsViewerScript || DEF_SCRIPT;
      s.onload = () => resolve();
      s.onerror = () => { sdk = null; reject(new Error('No se pudo descargar el visor de Autodesk. Revisa tu conexión.')); };
      document.head.appendChild(s);
    });
    return sdk;
  }

  const hexToVec4 = hex => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return new root.THREE.Vector4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
  };

  /**
   * Abre un modelo convertido. getToken() debe devolver { access_token, expires_in }
   * (el servidor entrega solo tokens de lectura: viewables:read).
   */
  async function open(container, { urn, getToken, onProgress }) {
    await loadSDK();
    const AV = root.Autodesk.Viewing;
    await new Promise((resolve, reject) => {
      try {
        AV.Initializer({ env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken: cb => {
          Promise.resolve(getToken()).then(t => cb(t.access_token, t.expires_in)).catch(e => { console.warn(e); });
        } }, resolve);
      } catch (e) { reject(e); }
    });
    const viewer = new AV.GuiViewer3D(container, { extensions: ['Autodesk.DocumentBrowser'] });
    const code = viewer.start();
    if (code > 0) throw new Error('Este navegador no puede mostrar modelos 3D (WebGL no disponible).');
    const doc = await new Promise((resolve, reject) => AV.Document.load('urn:' + urn, resolve,
      (code, msg) => reject(new Error(code === 4 ? 'No tienes acceso a este modelo en Autodesk.' : `Autodesk no pudo abrir el modelo (${code}${msg ? ': ' + msg : ''}).`))));
    const node = doc.getRoot().getDefaultGeometry();
    if (!node) throw new Error('El modelo no tiene vistas 3D.');
    const model = await viewer.loadDocumentNode(doc, node);
    await new Promise(r => { if (model.isLoadDone && model.isLoadDone()) r(); else viewer.addEventListener(AV.GEOMETRY_LOADED_EVENT, () => r(), { once: true }); });
    return new BimView(viewer, model, AV);
  }

  class BimView {
    constructor(viewer, model, AV) { this.viewer = viewer; this.model = model; this.AV = AV; }
    onSelect(fn) { this.viewer.addEventListener(this.AV.SELECTION_CHANGED_EVENT, () => fn(this.viewer.getSelection())); }
    selection() { return this.viewer.getSelection(); }
    select(dbIds) { this.viewer.select(dbIds); }
    props(dbId) { return new Promise((res, rej) => this.viewer.getProperties(dbId, res, rej)); }
    /** Propiedades de muchos elementos a la vez (null = todas). */
    bulk(dbIds, propFilter) {
      return new Promise((res, rej) => this.model.getBulkProperties(dbIds, propFilter ? { propFilter, needsExternalId: true } : { needsExternalId: true }, res, rej));
    }
    allDbIds() {
      const tree = this.model.getInstanceTree(); const ids = [];
      if (!tree) return ids;
      tree.enumNodeChildren(tree.getRootId(), id => { if (!tree.getChildCount(id)) ids.push(id); }, true);
      return ids;
    }
    externalIdMap() { return new Promise((res, rej) => this.model.getExternalIdMapping(res, rej)); }
    isolate(dbIds) { if(!dbIds?.length){this.viewer.hide(this.allDbIds());return;}this.viewer.showAll();this.viewer.isolate(dbIds); }
    showAll() { this.viewer.showAll(); }
    hide(dbIds) { if (dbIds.length) this.viewer.hide(dbIds); }
    show(dbIds) { if (dbIds.length) this.viewer.show(dbIds); }
    color(dbIds, hex) { const c = hexToVec4(hex); dbIds.forEach(id => this.viewer.setThemingColor(id, c, this.model, true)); }
    clearColors() { this.viewer.clearThemingColors(this.model); }
    fit(dbIds) { this.viewer.fitToView(dbIds && dbIds.length ? dbIds : undefined); }
    getState() { return this.viewer.getState({ viewport: true, objectSet: true, cutplanes: true, renderOptions: false }); }
    restoreState(s) { this.viewer.restoreState(s); }
    resize() { this.viewer.resize(); }
    dispose() { try { this.viewer.finish(); } catch (_) {} }
  }

  // ── subida directa a Autodesk por partes ─────────────────────────────
  const PART = 16 * 1024 * 1024;      // S3: mínimo 5 MB por parte (excepto la última)
  const BATCH = 25;                   // URLs por llamada a la función aps-upload
  function putPart(url, blob, onBytes) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      x.upload.onprogress = e => onBytes(e.loaded);
      x.onload = () => (x.status >= 200 && x.status < 300) ? resolve() : reject(new Error(`La parte no se subió (HTTP ${x.status})`));
      x.onerror = () => reject(new Error('Se cortó la conexión al subir'));
      x.send(blob);
    });
  }
  async function upload(cloud, versionId, file, onProgress) {
    const parts = Math.max(1, Math.ceil(file.size / PART));
    const loaded = new Array(parts).fill(0);
    const report = () => onProgress && onProgress(Math.min(99, Math.round(loaded.reduce((a, b) => a + b, 0) / file.size * 100)));
    let uploadKey = null;
    for (let first = 1; first <= parts; first += BATCH) {
      const n = Math.min(BATCH, parts - first + 1);
      const r = await cloud.invoke('aps-upload', { model_version_id: versionId, parts: n, first_part: first, upload_key: uploadKey });
      uploadKey = r.upload_key;
      const jobs = r.urls.map((url, i) => async () => {
        const idx = first - 1 + i;
        const blob = file.slice(idx * PART, Math.min(file.size, (idx + 1) * PART));
        for (let attempt = 1; ; attempt++) {
          try { await putPart(url, blob, b => { loaded[idx] = b; report(); }); loaded[idx] = blob.size; report(); return; }
          catch (e) { if (attempt >= 3) throw e; await new Promise(z => setTimeout(z, 800 * attempt)); }
        }
      });
      // tres partes a la vez
      let next = 0;
      await Promise.all([0, 1, 2].map(async () => { while (next < jobs.length) await jobs[next++](); }));
    }
    onProgress && onProgress(100);
    return { upload_key: uploadKey };
  }

  root.AgelAPS = { loadSDK, open, BimView };
  root.AgelBIMUpload = { upload, PART, BATCH };
})(window);
