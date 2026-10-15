/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · editor en modo nube (fases 1 y 2 del plan maestro)

   • Acceso: contraseña, enlace por correo o recuperación. Sin cuenta, el
     editor sigue funcionando "solo en este navegador" (ruta de recuperación).
   • Con sesión, los proyectos vienen de la base central según tus permisos
     y cada cambio se guarda con control de concurrencia: si alguien guardó
     antes, NO se pisa su trabajo; se avisa y se ofrece una copia.
   • Las panorámicas se suben al bucket "media/<proyecto>/…" con tu sesión.
   • Publicar crea una versión congelada; solo el propietario la aprueba.
   • Importar trae los proyectos que viven en este navegador, con un
     respaldo previo y un reporte de lo que falte.

   Se apoya en funciones del editor (PROJ, selScene, buildList…) mediante
   ganchos explícitos en index.html; no modifica el modo local.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const { h, icon, modal, field, notify } = AgelDOM;
  let cloud = null;
  try { cloud = AgelCloud.client(); } catch (e) { console.warn('[AgelArq] Sin configuración de nube:', e.message); }

  const LOCAL_MODE_KEY = 'agel.mode';
  const SAVE_DELAY = 1200;
  const say = (m, kind) => (typeof toast === 'function' && kind !== 'error') ? toast(m) : notify(m, kind);

  const CM = window.CloudMode = {
    active: false,
    access: null,
    orgId: null,
    dirty: new Set(),
    conflict: new Set(),
    _timer: null, _saving: false, _again: false, _readOnlyWarned: false,
    get cloud() { return cloud; },
    get available() { return !!cloud; },
  };

  // ── utilidades ──────────────────────────────────────────────────────────
  const uuid = () => AgelCloud.uuid();
  const authorRef = u => (typeof u==='string' && /^(https:\/\/|agel-local:[\w-]+$)/.test(u))?u:null;
  const workspaces=new Map();
  CM.workspace=async pi=>{const id=PROJ[pi]?._cloud?.id;if(!id)throw Error('Abre un proyecto con cuenta');if(!workspaces.has(id))workspaces.set(id,await AgelWorkspace.open({cloud,ownerId:cloud.user.id,projectId:id}));return workspaces.get(id);};
  const https = u => (typeof u === 'string' && /^https:\/\//i.test(u)) ? u : null;
  function blankScene(n = 1) { return { id: uuid(), name: 'Escena ' + n, meta: '', img: null, thumb: null, hs: [] }; }
  function canEdit(p) { return p && p._cloud && ['owner', 'editor'].includes(p._cloud.role); }
  CM.canEditCurrent = () => !CM.active || canEdit(PROJ[cP]);
  CM.isOwner = (p = PROJ[cP]) => p && p._cloud && p._cloud.role === 'owner';
  CM.isPublicLink = () => { const q = new URLSearchParams(location.search); return q.get('visor') === '1' || q.get('modelo') === '1' || !!q.get('pub'); };
  function dataUrlToBlob(d) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(d); if (!m) return null;
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: m[1] });
  }
  // Versión ligera de la panorámica (2048×1024 JPEG) para portadas y listas.
  const PREVIEW_W = 2048;
  function makePreview(blob) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(blob); const im = new Image();
      im.onload = () => {
        try {
          const w = Math.min(PREVIEW_W, im.naturalWidth), hgt = Math.round(w / 2);
          const c = document.createElement('canvas'); c.width = w; c.height = hgt;
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, w, hgt);
          c.toBlob(b => { URL.revokeObjectURL(u); b ? res(b) : rej(new Error('sin vista previa')); }, 'image/jpeg', 0.82);
        } catch (e) { URL.revokeObjectURL(u); rej(e); }
      };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('imagen ilegible')); };
      im.src = u;
    });
  }
  const _srcBlobs = new Map();          // url subida → archivo original (evita volver a descargarlo)
  async function ensurePreview(projectId, s) {
    if (s.previewUrl || s._previewTried || !https(s.supaUrl)) return;
    s._previewTried = true;
    try {
      let src = _srcBlobs.get(s.supaUrl);
      if (!src) { const r = await fetch(s.supaUrl, { mode: 'cors' }); if (!r.ok) return; src = await r.blob(); }
      const prev = await makePreview(src);
      const up = await cloud.upload(projectId, prev, { kind: 'image', filename: `${s.name || 'escena'}_vista.jpg`, contentType: 'image/jpeg' });
      s.previewUrl = up.url;
      _srcBlobs.delete(s.supaUrl);
    } catch (e) { console.warn('[AgelArq] vista previa no generada:', e.message); }
  }
  function imageSize(file) {
    return new Promise(res => {
      const u = URL.createObjectURL(file); const im = new Image();
      im.onload = () => { res({ width: im.naturalWidth, height: im.naturalHeight }); URL.revokeObjectURL(u); };
      im.onerror = () => { res({}); URL.revokeObjectURL(u); };
      im.src = u;
    });
  }

  // ── conversión proyecto del editor ⇄ árbol de la base ────────────────────
  function ensureIds(p) {
    (p.scenes || []).forEach(s => { if (!s.id) s.id = uuid(); (s.hs || []).forEach(h => { if (!h.id) h.id = uuid(); }); });
  }
  CM.toTree = function (p) {
    ensureIds(p);
    return {
      project: { name: p.name, subtitle: p.sub || '', location: p.loc || '', delivery: p.date || '',
                 status: p.status || 'activo', progress: Number(p.pct) || 0 },
      scenes: p.scenes.map(s => ({
        id: s.id, name: (s.name || 'Escena').slice(0, 120), meta: (s.meta || '').slice(0, 200), level: s.level || '',
        pano_url: authorRef(s.localRef)||authorRef(s.supaUrl)||authorRef(s.img), thumb_url: authorRef(s.thumbRef)||authorRef(s.thumbUrl)||authorRef(s.thumb),
        preview_url: https(s.previewUrl),
        heading: Number(s.heading) || 0, limits: s.limits || {},
        hs: (s.hs || []).map(h => ({
          id: h.id, type: h.type || 'info', x: Number(h.x) || 50, y: Number(h.y) || 50, title: h.title || '',
          details: Array.isArray(h.details) ? h.details : [], img_url: authorRef(h.localRef)||authorRef(h.img),
          target_scene_id: h.type === 'scene' && p.scenes[h.targetScene] ? p.scenes[h.targetScene].id : null,
          payload: h.payload || {}
        }))
      }))
    };
  };
  CM.fromTree = function (t) {
    const scenes = t.scenes.map(s => ({
      id: s.id, name: s.name, meta: s.meta || '', level: s.level || '',
      localRef:s.pano_url?.startsWith('agel-local:')?s.pano_url:null,thumbRef:s.thumb_url?.startsWith('agel-local:')?s.thumb_url:null,
      img: s.pano_url || null, supaUrl: s.pano_url || null, thumb: s.thumb_url || null, thumbUrl: s.thumb_url || null,
      previewUrl: s.preview_url || null,
      heading: s.heading || 0, limits: s.limits || {}, hs: []
    }));
    const idx = new Map(scenes.map((s, i) => [s.id, i]));
    t.scenes.forEach((s, i) => {
      scenes[i].hs = (s.hs || []).map(h => {
        const o = { id: h.id, type: h.type, x: h.x, y: h.y, title: h.title || '', details: h.details || [],
                    localRef:h.img_url?.startsWith('agel-local:')?h.img_url:null,img: h.img_url || null, payload: h.payload || {} };
        if (h.type === 'scene') {
          o.targetScene = idx.has(h.target_scene_id) ? idx.get(h.target_scene_id) : -1;
          o.targetSceneName = o.targetScene >= 0 ? scenes[o.targetScene].name : '';
        }
        return o;
      });
    });
    const pr = t.project;
    return {
      name: pr.name, sub: pr.subtitle || '', loc: pr.location || '', date: pr.delivery || '',
      status: pr.status || 'activo', pct: pr.progress || 0,
      scenes: scenes.length ? scenes : [blankScene()],
      _cloud: { id: pr.id, org_id: pr.org_id, revision: t.revision, role: t.role, loaded: true, lastSaved: null }
    };
  };

  // ── arranque ────────────────────────────────────────────────────────────
  CM.init = async function () {
    if (!cloud || CM.isPublicLink()) return;
    injectChrome();
    try {
      const type = cloud.consumeRedirect();
      if (type === 'recovery') return askNewPassword();
    } catch (e) { notify(e.message, 'error'); }
    if (cloud.session) return CM.enter();
    if (localStorage.getItem(LOCAL_MODE_KEY) === 'local') { renderAccount(); return; }
    CM.showGate();
  };

  CM.enter = async function () {
    setStatus('Conectando…');
    try {
      CM.access = await cloud.rpc('my_access');
    } catch (e) {
      if (e.isAuth) { for(const ws of workspaces.values())ws.close();workspaces.clear();
    await cloud.signOut(); CM.showGate(e.message); return; }
      setStatus('');
      notify('No se pudo conectar con la base: ' + e.message + ' — sigues en modo local', 'error');
      renderAccount(); return;
    }
    if (!CM.access.orgs.length) {
      const ok = await askCreateOrg();
      if (!ok) { for(const ws of workspaces.values())ws.close();workspaces.clear();
    await cloud.signOut(); renderAccount(); setStatus(''); return; }
      CM.access = await cloud.rpc('my_access');
    }
    const remembered = localStorage.getItem('agel.org');
    CM.orgId = (CM.access.orgs.find(o => o.id === remembered) || CM.access.orgs[0]).id;
    localStorage.removeItem(LOCAL_MODE_KEY);
    await switchToCloudProjects();
    if(typeof d5Load==='function')await d5Load();
    renderAccount();
    setStatus('Guardado');
  };

  async function switchToCloudProjects(selectId) {
    const list = CM.access.projects.filter(p => p.org_id === CM.orgId);
    CM.active = true;
    document.body.classList.add('cloud-mode');
    Object.keys(texCache).forEach(k => { try { texCache[k].dispose(); } catch (_) {} delete texCache[k]; });
    if (!list.length) {
      PROJ = [{ name: 'Sin proyectos', sub: 'Crea uno o importa los de este navegador', loc: '', date: '', status: 'nuevo', pct: 0,
                scenes: [blankScene()], _cloud: null }];
      cP = 0; cS = 0;
      refreshUI();
      emptyState();
      return;
    }
    PROJ = list.map(p => ({ name: p.name, sub: '', loc: '', date: '', status: 'activo', pct: 0, scenes: [blankScene()],
                            _cloud: { id: p.id, org_id: p.org_id, revision: p.revision, role: p.role, loaded: false } }));
    cP = Math.max(0, PROJ.findIndex(p => p._cloud.id === selectId));
    cS = 0;
    await CM.ensureLoaded(cP);
    refreshUI();
  }
  function refreshUI() {
    refreshProjHeader(); buildStrip(); buildList(); buildPips(); updateCount(); updateProgress();
    selScene(0);
    if (typeof updateClientCount === 'function') updateClientCount();
  }

  CM.ensureLoaded = async function (pi) {
    const p = PROJ[pi];
    if (!p || !p._cloud || p._cloud.loaded) return;
    setStatus('Cargando proyecto…');
    const ws=await CM.workspace(pi),d=await ws.load(),t=d.tree;
    Object.assign(p, CM.fromTree(t));p._localRevision=d.localRevision;
    for(const s of p.scenes){s.img=await ws.resolveMedia(s.img);s.thumb=await ws.resolveMedia(s.thumb);for(const hs of s.hs)hs.img=await ws.resolveMedia(hs.img);}
    p._cloud.lastSaved = JSON.stringify(CM.toTree(p));
    setStatus(canEdit(p) ? 'Guardado' : 'Solo lectura');
  };

  // ── guardado ────────────────────────────────────────────────────────────
  CM.markDirty = function (pi = cP) {
    if (!CM.active) return;
    const p = PROJ[pi];
    if (!p || !p._cloud) return;
    if (!canEdit(p)) {
      if (!CM._readOnlyWarned) { CM._readOnlyWarned = true; say('Tu rol en este proyecto es de solo lectura: los cambios no se guardan'); }
      return;
    }
    CM.dirty.add(pi);
    clearTimeout(CM._timer);
    CM._timer = setTimeout(CM.flush, SAVE_DELAY);
  };
  CM.flush = async function () {
    if (CM._saving) { CM._again = true; return; }
    CM._saving = true;
    try {
      for (const pi of [...CM.dirty]) { CM.dirty.delete(pi); await saveProject(pi); }
    } finally {
      CM._saving = false;
      if (CM._again) { CM._again = false; CM.flush(); }
    }
  };
  CM.pending = () => CM.dirty.size > 0 || CM._saving;

  async function saveProject(pi) {
    const p=PROJ[pi];if(!p?._cloud?.loaded||CM.conflict.has(pi))return;
    try{
      const ws=await CM.workspace(pi);
      for(const s of p.scenes){
        if(typeof s.thumb==='string'&&s.thumb.startsWith('data:')&&!s.thumbRef){s.thumbRef=(await ws.addMedia(new File([dataUrlToBlob(s.thumb)],`${s.name}.jpg`,{type:'image/jpeg'}),'thumb')).ref;p._localRevision=(await ws.load()).localRevision;}
        for(const hs of s.hs||[])if(typeof hs.img==='string'&&hs.img.startsWith('data:')){hs.localRef=(await ws.addMedia(new File([dataUrlToBlob(hs.img)],'hotspot.jpg',{type:'image/jpeg'}),'image')).ref;hs.img=await ws.resolveMedia(hs.localRef);p._localRevision=(await ws.load()).localRevision;}
      }
      const tree=CM.toTree(p),json=JSON.stringify(tree);if(json===p._cloud.lastSaved)return;
      const d=await ws.load();if(d.localRevision!==p._localRevision)throw Error('Hay cambios de otra pestaña. Reabre el proyecto antes de guardar.');
      d.tree.scenes=tree.scenes;Object.assign(d.tree.project,tree.project);await ws.save(d);p._localRevision=d.localRevision;p._cloud.lastSaved=json;setStatus('Guardado en este dispositivo');
    }catch(e){CM.dirty.add(pi);setStatus('Sin guardar');notify(e.message,'error');}
  }

  function showConflict(pi) {
    const p = PROJ[pi];
    modal({
      title: 'Otra persona guardó cambios',
      body: [h('p', {}, 'Mientras editabas «', p.name, '», alguien más guardó una versión más reciente. Para no borrar su trabajo, tus cambios no se enviaron.'),
             h('p', {}, 'Puedes descargar una copia de lo que tienes en pantalla y luego cargar la versión del servidor.')],
      dismissable: false,
      actions: [
        { label: 'Descargar mi copia', icon: 'download', onClick: () => downloadJson(CM.toTree(p), `copia-${AgelCloud.slugify(p.name)}.json`) },
        { label: 'Cargar la versión del servidor', primary: true, onClick: async m => {
            await (await CM.workspace(pi)).reloadCloud();CM.conflict.delete(pi);CM.dirty.delete(pi);p._cloud.loaded = false; await CM.ensureLoaded(pi); m.close();
            if (pi === cP) refreshUI(); } }
      ]
    });
  }
  function downloadJson(obj, name) {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ── subidas ─────────────────────────────────────────────────────────────
  CM.syncCurrent=async function(){
    await CM.flush();const p=PROJ[cP],ws=await CM.workspace(cP);if(CM.pending())throw Error('Guarda primero los cambios locales pendientes');
    try{const r=await AgelSync.run({workspace:ws,cloud,onProgress:setStatus}),d=await ws.load();Object.assign(p,CM.fromTree(d.tree));p._localRevision=d.localRevision;p._cloud.lastSaved=JSON.stringify(CM.toTree(p));setStatus('Sincronizado');return r;}
    catch(e){if(e.isConflict){CM.conflict.add(cP);setStatus('Conflicto');showConflict(cP);}throw e;}
  };
  CM.showSync=async function(){
    await CM.flush();const ws=await CM.workspace(cP),plan=await AgelSync.plan(await ws.load(),ws.store);
    modal({title:'Subir a la nube',body:[h('p',{},`${plan.assets.length} archivos · ${AgelDOM.formatBytes(plan.totalBytes)}`),...plan.blocked.map(x=>h('p',{class:'ag-error'},x))],actions:[{label:'Cancelar',onClick:m=>m.close()},{label:'Confirmar subida',primary:true,onClick:async m=>{if(plan.blocked.length)return;m.setBusy(true);try{await CM.syncCurrent();m.close();say('Contenido sincronizado');}catch(e){m.setBusy(false);notify(e.message,'error');}}}]});
  };
  CM.uploadPano = async function (file, pi, onProgress) {
    const p = PROJ[pi];
    if (!canEdit(p)) throw new Error('Tu rol en este proyecto no permite subir archivos');
    const ws=await CM.workspace(pi),r=await ws.addMedia(file,'pano');
    p._localRevision=(await ws.load()).localRevision;
    onProgress?.(100);return {ref:r.ref,url:await ws.resolveMedia(r.ref)};
  };

  // ── acceso (pantalla de entrada) ────────────────────────────────────────
  CM.showGate = function (errorText) {
    const email = h('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'tu@correo.com' });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '••••••••' });
    const err = h('div', { class: 'ag-error', role: 'alert' }, errorText || '');
    const form = h('form', { class: 'cm-gate-form', onsubmit: e => { e.preventDefault(); doLogin(); } },
      field('Correo', email), field('Contraseña', pass), err,
      h('button', { type: 'submit', class: 'ag-btn primary cm-wide' }, 'Entrar'));
    const m = modal({
      title: 'Entrar a AgelArq',
      dismissable: false,
      body: [
        h('p', {}, 'Tus proyectos se guardan en tu cuenta y solo los ven las personas que tú agregues.'),
        form,
        h('div', { class: 'cm-gate-links' },
          h('button', { type: 'button', class: 'ag-btn link', onclick: () => doMagic() }, 'Enviarme un enlace de acceso'),
          h('button', { type: 'button', class: 'ag-btn link', onclick: () => doReset() }, 'Olvidé mi contraseña')),
        h('hr', { class: 'ag-sep' }),
        h('button', { type: 'button', class: 'ag-btn cm-wide', onclick: () => { localStorage.setItem(LOCAL_MODE_KEY, 'local'); m.close(); renderAccount(); } },
          icon('device-laptop'), 'Seguir sin cuenta, solo en este navegador'),
        h('p', { class: 'ag-hint', style: { marginTop: '8px' } }, 'Sin cuenta, tus proyectos viven solo en este navegador. Usa «Respaldo» para no perderlos.')
      ]
    });
    m.el.classList.add('cm-gate');
    async function doLogin() {
      err.textContent = '';
      if (!email.value || !pass.value) { err.textContent = 'Escribe tu correo y tu contraseña'; return; }
      form.querySelector('button[type=submit]').disabled = true;
      try { await cloud.signInWithPassword(email.value, pass.value); m.close(); await CM.enter(); }
      catch (e) { err.textContent = e.message; }
      finally { const b = form.querySelector('button[type=submit]'); if (b) b.disabled = false; }
    }
    async function doMagic() {
      err.textContent = '';
      if (!email.value) { err.textContent = 'Escribe tu correo'; email.focus(); return; }
      try { await cloud.sendMagicLink(email.value); err.className = 'ag-error ag-ok'; err.textContent = 'Te enviamos un enlace. Ábrelo en este navegador.'; }
      catch (e) { err.className = 'ag-error'; err.textContent = e.message; }
    }
    async function doReset() {
      err.textContent = '';
      if (!email.value) { err.textContent = 'Escribe tu correo'; email.focus(); return; }
      try { await cloud.requestPasswordReset(email.value); err.className = 'ag-error ag-ok'; err.textContent = 'Te enviamos un correo para crear una contraseña nueva.'; }
      catch (e) { err.className = 'ag-error'; err.textContent = e.message; }
    }
  };

  function askNewPassword() {
    const p1 = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'ag-error', role: 'alert' });
    modal({
      title: 'Crea tu contraseña nueva', dismissable: false,
      body: [field('Contraseña nueva', p1, 'Al menos 8 caracteres'), field('Repítela', p2), err],
      actions: [{ label: 'Guardar', primary: true, onClick: async m => {
        if (p1.value.length < 8) { err.textContent = 'Usa al menos 8 caracteres'; return; }
        if (p1.value !== p2.value) { err.textContent = 'Las contraseñas no coinciden'; return; }
        try { await cloud.updatePassword(p1.value); m.close(); say('Contraseña actualizada ✓'); CM.enter(); }
        catch (e) { err.textContent = e.message; }
      } }]
    });
  }

  function askCreateOrg() {
    return new Promise(resolve => {
      const name = h('input', { type: 'text', maxlength: '120', placeholder: 'Ej: AgelArq Estudio' });
      const err = h('div', { class: 'ag-error', role: 'alert' });
      modal({
        title: 'Crea tu organización',
        body: [h('p', {}, 'Es el espacio que contiene tus proyectos y tu equipo. Puedes cambiar el nombre después.'),
               field('Nombre', name), err],
        onClose: r => resolve(!!r),
        actions: [
          { label: 'Ahora no', onClick: m => m.close(false) },
          { label: 'Crear', primary: true, onClick: async m => {
              if (!name.value.trim()) { err.textContent = 'Escribe un nombre'; return; }
              try { await cloud.rpc('create_organization', { p_name: name.value.trim() }); m.close(true); }
              catch (e) { err.textContent = e.message; }
          } }
        ]
      });
    });
  }

  // ── cuenta, estado y menú ───────────────────────────────────────────────
  function injectChrome() {
    if (document.getElementById('cmAccount')) return;
    const actions = document.querySelector('#topbar .tb-actions');
    if (!actions) return;
    const status = h('span', { id: 'cmStatus', class: 'cm-status', role: 'status', 'aria-live': 'polite' });
    const btn = h('button', { class: 'tba cm-account', id: 'cmAccount', type: 'button', 'aria-haspopup': 'menu', onclick: e => openMenu(e) }, icon('user-circle'));
    actions.insertBefore(status, actions.firstChild);
    actions.appendChild(btn);
    window.addEventListener('beforeunload', e => { if (CM.active && CM.pending()) { e.preventDefault(); e.returnValue = ''; } });
  }
  function setStatus(t) {
    const el = document.getElementById('cmStatus'); if (!el) return;
    el.textContent = t || '';
    el.dataset.state = /Guardado/.test(t) ? 'ok' : /Sin guardar|Conflicto/.test(t) ? 'bad' : 'busy';
  }
  function renderAccount() {
    const btn = document.getElementById('cmAccount'); if (!btn) return;
    const u = cloud && cloud.user;
    btn.replaceChildren(icon(u ? 'cloud-check' : 'login-2'), h('span', { class: 'cm-account-t' }, u ? (u.email || 'Cuenta').split('@')[0] : 'Entrar'));
    btn.setAttribute('aria-label', u ? `Cuenta ${u.email || ''}` : 'Entrar a tu cuenta');
    btn.title = u ? u.email || '' : 'Entrar para guardar en la nube';
  }
  function openMenu(ev) {
    if (!cloud.user) { CM.showGate(); return; }
    const p = PROJ[cP];
    const orgs = (CM.access && CM.access.orgs) || [];
    const item = (ic, label, fn, opts = {}) => h('button', { type: 'button', class: 'cm-menu-item' + (opts.danger ? ' danger' : ''), role: 'menuitem',
                                                             disabled: opts.disabled, onclick: () => { close(); fn(); } }, icon(ic), label);
    const menu = h('div', { class: 'cm-menu', role: 'menu' },
      h('div', { class: 'cm-menu-head' }, cloud.user.email || ''),
      orgs.length > 1 ? h('div', { class: 'cm-menu-sub' }, 'Organización') : null,
      orgs.length > 1 ? orgs.map(o => item(o.id === CM.orgId ? 'circle-check' : 'circle', o.name, () => switchOrg(o.id))) : null,
      item('plus', 'Proyecto nuevo', () => CM.createProject()),
      item('cloud-upload', 'Subir a la nube', () => CM.showSync(),{disabled:!p?._cloud}),
      item('world-upload', 'Publicar recorrido', () => CM.publish(), { disabled: !p || !p._cloud || !canEdit(p) }),
      item('database-import', 'Importar de este navegador', () => CM.importLocal()),
      item('layout-dashboard', 'Panel de administración', () => { location.href = 'apps/panel/'; }),
      item('logout', 'Cerrar sesión', () => signOut(), { danger: true }));
    const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); };
    const outside = e => { if (!menu.contains(e.target)) close(); };
    const esc = e => { if (e.key === 'Escape') { close(); ev.currentTarget && ev.currentTarget.focus(); } };
    const r = ev.currentTarget.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc, true); menu.querySelector('button:not([disabled])')?.focus(); });
  }
  async function signOut() {
    if (CM.pending()) await CM.flush();
    for(const ws of workspaces.values())ws.close();workspaces.clear();
    await cloud.signOut();
    location.reload();
  }
  async function switchOrg(id) {
    if (CM.pending()) await CM.flush();
    CM.orgId = id; localStorage.setItem('agel.org', id);
    await switchToCloudProjects();
  }

  function emptyState() {
    modal({
      title: 'Tu organización aún no tiene proyectos',
      body: h('p', {}, 'Crea uno nuevo o trae los que ya tienes en este navegador (se hace un respaldo antes).'),
      actions: [
        { label: 'Importar de este navegador', icon: 'database-import', onClick: m => { m.close(); CM.importLocal(); } },
        { label: 'Proyecto nuevo', primary: true, onClick: m => { m.close(); CM.createProject(); } }
      ]
    });
  }

  CM.createProject = function () {
    const name = h('input', { type: 'text', maxlength: '160', placeholder: 'Ej: Torre Mirador' });
    const kind = h('select', {},
      [['desarrollo', 'Desarrollo (conjunto, edificios, unidades)'], ['edificio', 'Edificio o empresa'], ['vivienda', 'Casa, departamento o local'],
       ['ambiente', 'Ambiente o remodelación'], ['producto', 'Producto']].map(([v, t]) => h('option', { value: v }, t)));
    const err = h('div', { class: 'ag-error', role: 'alert' });
    modal({
      title: 'Proyecto nuevo', body: [field('Nombre', name), field('Tipo', kind), err],
      actions: [{ label: 'Cancelar', onClick: m => m.close() }, { label: 'Crear', primary: true, onClick: async m => {
        if (!name.value.trim()) { err.textContent = 'Escribe un nombre'; return; }
        try {
          m.setBusy(true, 'Creando…');
          const id = await cloud.rpc('create_project', { p_org: CM.orgId, p_name: name.value.trim(), p_kind: kind.value });
          CM.access = await cloud.rpc('my_access');
          m.close();
          await switchToCloudProjects(id);
          say('Proyecto creado ✓ — sube la primera panorámica');
          document.getElementById('upl')?.classList.remove('hide');
        } catch (e) { m.setBusy(false); err.textContent = e.message; }
      } }]
    });
  };

  // ── publicar ────────────────────────────────────────────────────────────
  CM.publish = async function () {
    const p = PROJ[cP];
    if (!p || !p._cloud) return;
    if (CM.pending()) await CM.flush();
    if((await (await CM.workspace(cP)).load()).dirty)return say('Sube primero el borrador desde el panel de administración');
    if (CM.conflict.has(cP)) return say('Resuelve el conflicto de guardado antes de publicar');
    const owner = CM.isOwner(p);
    let pubs = [];
    try { pubs = await cloud.select('publications', `project_id=eq.${p._cloud.id}&kind=eq.visor&select=id,slug,title,status,current_version_id&order=created_at`); }
    catch (e) { return notify(e.message, 'error'); }
    const existing = pubs.find(x => x.status !== 'archived');
    const slug = h('input', { type: 'text', value: existing ? existing.slug : AgelCloud.slugify(p.name), maxlength: '80',
                              disabled: !!existing, pattern: '[a-z0-9-]+' });
    const note = h('input', { type: 'text', maxlength: '200', placeholder: 'Ej: acabados de lobby actualizados' });
    const err = h('div', { class: 'ag-error', role: 'alert' });
    const m = modal({
      title: existing ? 'Publicar una versión nueva' : 'Publicar recorrido',
      body: [
        h('p', {}, owner
          ? 'Se congela una versión de lo que ves ahora. Lo que edites después no cambia el enlace hasta que publiques otra versión.'
          : 'Tu versión quedará lista y se enviará al propietario del proyecto para que la apruebe.'),
        field('Dirección del enlace', slug, existing ? 'Ya publicada; la dirección no cambia.' : 'Solo minúsculas, números y guiones.'),
        field('Nota de la versión (opcional)', note), err
      ],
      actions: [{ label: 'Cancelar', onClick: m => m.close() },
                { label: owner ? 'Publicar' : 'Enviar a revisión', primary: true, onClick: async m => {
        try {
          m.setBusy(true, owner ? 'Publicando…' : 'Enviando…');
          let pubId = existing && existing.id;
          if (!pubId) pubId = await cloud.rpc('create_publication', { p_project: p._cloud.id, p_kind: 'visor', p_slug: slug.value.trim(), p_title: p.name });
          const versionId = await cloud.rpc('create_publication_version', { p_publication: pubId, p_note: note.value });
          if (owner) await cloud.rpc('publish_version', { p_version: versionId });
          else await cloud.rpc('request_review', { p_publication: pubId });
          m.close();
          if (owner) showPublished(existing ? existing.slug : slug.value.trim());
          else say('Enviado a revisión ✓ — el propietario lo aprueba desde el panel');
        } catch (e) { m.setBusy(false); err.textContent = e.message; }
      } }]
    });
  };
  CM.publicationUrl = slug => {
    const base = (AGEL_CONFIG.siteUrl || (location.origin + location.pathname)).replace(/index\.html$/, '').replace(/\/?$/, '/');
    return `${base}?pub=${encodeURIComponent(slug)}`;
  };
  function showPublished(slug) {
    const url = CM.publicationUrl(slug);
    const qr = h('div', { class: 'cm-qr', 'aria-hidden': 'true' });
    modal({
      title: 'Publicado ✓',
      body: [h('p', {}, 'Comparte este enlace con tu cliente:'), h('div', { class: 'ag-code', id: 'cmPubUrl' }, url), qr,
             h('p', { class: 'ag-hint' }, 'Para volver a una versión anterior o ver quién publicó, usa el panel de administración.')],
      actions: [{ label: 'Abrir', icon: 'external-link', onClick: () => window.open(url, '_blank', 'noopener') },
                { label: 'Copiar enlace', primary: true, icon: 'copy', onClick: () => navigator.clipboard.writeText(url).then(() => say('Enlace copiado ✓')) }]
    });
    try { new QRCode(qr, { text: url, width: 148, height: 148, colorDark: '#111', colorLight: '#fff' }); } catch (_) {}
  }

  // ── importar los proyectos de este navegador ─────────────────────────────
  CM.importLocal = async function () {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (_) {}
    const projs = (local && local.proj) || [];
    if (!projs.length) return say('No hay proyectos guardados en este navegador');
    const checks = projs.map((p, i) => {
      const imgs = p.scenes.filter(s => s.supaUrl).length;
      const cb = h('input', { type: 'checkbox', checked: true, value: String(i) });
      return { cb, row: h('label', { class: 'ag-check' }, cb, h('span', {}, h('strong', {}, p.name), ` · ${p.scenes.length} escenas, ${imgs} en la nube`)) };
    });
    const err = h('div', { class: 'ag-error', role: 'alert' });
    const progress = h('div', { class: 'ag-hint', 'aria-live': 'polite' });
    modal({
      title: 'Importar de este navegador', wide: true,
      body: [h('p', {}, 'Se copian a tu organización. Los proyectos de este navegador no se borran, y antes de empezar se descarga un respaldo completo.'),
             ...checks.map(c => c.row), progress, err],
      actions: [{ label: 'Cancelar', onClick: m => m.close() }, { label: 'Importar', primary: true, onClick: async m => {
        const chosen = checks.filter(c => c.cb.checked).map(c => Number(c.cb.value));
        if (!chosen.length) { err.textContent = 'Elige al menos un proyecto'; return; }
        m.setBusy(true, 'Importando…');
        try {
          if (typeof exportBackup === 'function') await exportBackup();
          const report = [];
          for (const i of chosen) report.push(await importOne(projs[i], i, t => { progress.textContent = t; }));
          CM.access = await cloud.rpc('my_access');
          m.close();
          await switchToCloudProjects(report[report.length - 1].id);
          showImportReport(report);
        } catch (e) { m.setBusy(false); err.textContent = e.message; }
      } }]
    });
  };

  async function importOne(lp, pi, progress) {
    const r = { name: lp.name, id: null, scenes: 0, uploaded: 0, kept: 0, missing: [], hsImages: 0 };
    progress(`Creando «${lp.name}»…`);
    r.id = await cloud.rpc('create_project', { p_org: CM.orgId, p_name: lp.name || 'Proyecto importado', p_kind: 'desarrollo' });
    const p = { name: lp.name, sub: lp.sub, loc: lp.loc, date: lp.date, status: lp.status, pct: lp.pct, scenes: [],
                _cloud: { id: r.id, revision: 0, role: 'owner', loaded: true } };
    for (let si = 0; si < lp.scenes.length; si++) {
      const s = lp.scenes[si];
      const sc = { id: uuid(), name: s.name, meta: s.meta || '', img: null, supaUrl: null, thumb: null,
                   hs: (s.hs || []).map(h => Object.assign({ id: uuid() }, h)) };
      progress(`«${lp.name}»: escena ${si + 1} de ${lp.scenes.length}…`);
      if (https(s.supaUrl)) { sc.supaUrl = s.supaUrl; r.kept++; }
      else {
        const blob = await idbGet(`img_${pi}_${si}`).catch(() => null);
        if (blob instanceof Blob) {
          const up = await cloud.upload(r.id, blob, { kind: 'pano', filename: `${s.name || 'pano'}.jpg`, ...(await imageSize(blob)) });
          sc.supaUrl = up.url; r.uploaded++;
          _srcBlobs.set(up.url, blob);
        } else r.missing.push(`${s.name}: sin panorámica`);
      }
      sc.img = sc.supaUrl;
      await ensurePreview(r.id, sc);
      for (const hs of sc.hs) {
        if (typeof hs.img === 'string' && hs.img.startsWith('data:')) {
          const b = dataUrlToBlob(hs.img);
          if (b) { const up = await cloud.upload(r.id, b, { kind: 'image', filename: 'hotspot.jpg' }); hs.img = up.url; r.hsImages++; }
        } else if (hs.img && !https(hs.img)) { r.missing.push(`${s.name} · ${hs.title || 'hotspot'}: imagen temporal (${String(hs.img).slice(0, 5)}…) no recuperable`); hs.img = null; }
      }
      p.scenes.push(sc);
      r.scenes++;
    }
    if (!p.scenes.length) p.scenes.push(blankScene());
    await cloud.rpc('save_project_tree', { p_project: r.id, p_tree: CM.toTree(p), p_base_revision: 0 });
    return r;
  }

  function showImportReport(list) {
    modal({
      title: 'Importación terminada', wide: true,
      body: list.map(r => h('div', { class: 'cm-report' },
        h('strong', {}, r.name),
        h('div', {}, `${r.scenes} escenas · ${r.kept} panorámicas ya en la nube · ${r.uploaded} subidas desde este navegador · ${r.hsImages} imágenes de hotspots`),
        r.missing.length ? h('ul', { class: 'cm-missing' }, r.missing.map(t => h('li', {}, t))) : h('div', { class: 'ag-ok' }, 'Sin faltantes'))),
      actions: [{ label: 'Listo', primary: true, onClick: m => m.close() }]
    });
  }
})();
