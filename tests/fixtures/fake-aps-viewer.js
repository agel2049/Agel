/* Visor de Autodesk SIMULADO, solo para pruebas (tests/e2e_bim.py).
   Implementa la parte de Autodesk.Viewing que usa packages/bim/aps-adapter.js
   y registra lo que la app le pide en window.__fake para comprobarlo.
   No dibuja un modelo real: muestra los elementos como botones. */
(function () {
  const CATS = [['Ducts', 'Supply Air'], ['Pipes', 'Domestic Cold Water'], ['Cable Trays', 'Power'], ['Walls', ''], ['Sprinklers', 'Wet Fire']];
  const N = 20;
  const els = Array.from({ length: N }, (_, i) => {
    const [cat, sys] = CATS[i % CATS.length];
    return { dbId: i + 1, externalId: `ext-${i + 1}`, name: `${cat} ${i + 1}`, properties: [
      { displayCategory: 'Element', displayName: 'Category', displayValue: cat },
      { displayCategory: 'Constraints', displayName: 'Reference Level', displayValue: i < 10 ? 'Level 1' : 'Level 2' },
      ...(sys ? [{ displayCategory: 'Mechanical', displayName: 'System Name', displayValue: sys }] : []),
      { displayCategory: 'Item', displayName: 'Layer', displayValue: i === N - 1 ? 'E-N2-ALUMBRADO' : 'A-MUROS' }] };
  });
  // el último elemento no tiene categoría: debe quedar sin clasificar
  els[N - 1].properties = els[N - 1].properties.filter(p => p.displayName !== 'Category' && p.displayName !== 'System Name');
  const F = window.__fake = { token: null, urn: null, hidden: new Set(), isolated: null, colors: {}, selection: [], state: null, restored: null, els };
  window.THREE = window.THREE || { Vector4: function (x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; } };
  const listeners = {};
  const AV = {
    SELECTION_CHANGED_EVENT: 'sel', GEOMETRY_LOADED_EVENT: 'geo',
    Initializer(opts, cb) { opts.getAccessToken((t, exp) => { F.token = t; F.exp = exp; cb(); }); },
    Document: { load(urn, ok, err) {
      if (!F.token) return err(4, 'sin token');
      F.urn = urn.replace(/^urn:/, '');
      ok({ getRoot: () => ({ getDefaultGeometry: () => ({ name: '3D' }) }) });
    } },
    GuiViewer3D: function (container) {
      const box = document.createElement('div');
      box.className = 'fake-viewer';
      box.style.cssText = 'position:absolute;inset:0;display:flex;flex-wrap:wrap;gap:4px;padding:10px;align-content:flex-start;overflow:auto;color:#ddd;font:12px sans-serif';
      container.appendChild(box);
      const draw = () => box.replaceChildren(...els.map(e => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = e.name; b.dataset.dbid = e.dbId;
        const hidden = F.hidden.has(e.dbId) || (F.isolated && F.isolated.length && !F.isolated.includes(e.dbId));
        b.style.cssText = `padding:6px;border:1px solid #555;background:${F.colors[e.dbId] || '#2a2d31'};color:#eee;opacity:${hidden ? .15 : 1}`;
        b.onclick = () => { F.selection = [e.dbId]; (listeners.sel || []).forEach(fn => fn()); draw(); };
        return b;
      }));
      const model = {
        isLoadDone: () => true,
        getBulkProperties(ids, opts, ok) { ok(ids.map(id => els[id - 1]).filter(Boolean).map(e => ({ dbId: e.dbId, externalId: e.externalId, name: e.name, properties: e.properties }))); },
        getExternalIdMapping(ok) { ok(Object.fromEntries(els.map(e => [e.externalId, e.dbId]))); },
        getInstanceTree() { return { getRootId: () => 0, getChildCount: id => id === 0 ? N : 0,
          enumNodeChildren(root, cb) { els.forEach(e => cb(e.dbId)); } }; }
      };
      this.start = () => { draw(); return 0; };
      this.loadDocumentNode = () => Promise.resolve(model);
      this.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
      this.getSelection = () => F.selection.slice();
      this.select = ids => { F.selection = ids.slice(); draw(); };
      this.getProperties = (id, ok) => { const e = els[id - 1]; ok({ dbId: id, name: e.name, externalId: e.externalId, properties: e.properties }); };
      this.isolate = ids => { F.isolated = ids.slice(); draw(); };
      this.showAll = () => { F.isolated = null; F.hidden.clear(); draw(); };
      this.hide = ids => { ids.forEach(i => F.hidden.add(i)); draw(); };
      this.show = ids => { ids.forEach(i => F.hidden.delete(i)); draw(); };
      this.setThemingColor = (id, v) => { F.colors[id] = `rgb(${Math.round(v.x * 255)},${Math.round(v.y * 255)},${Math.round(v.z * 255)})`; };
      this.clearThemingColors = () => { F.colors = {}; draw(); };
      this.fitToView = () => {};
      this.getState = () => ({ viewport: { eye: [1, 2, 3] }, objectSet: [{ isolated: F.isolated || [] }] });
      this.restoreState = s => { F.restored = s; };
      this.resize = () => {};
      this.finish = () => box.remove();
    }
  };
  window.Autodesk = { Viewing: AV };
})();
