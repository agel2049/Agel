/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · showroom público (rama Showroom Virtual, S1–S4)

   Direcciones:
     apps/showroom/?p=<slug>            versión publicada (cualquiera)
     apps/showroom/?preview=<version>   vista previa para miembros con sesión
     p/<slug>/                          página pre-generada (mismo código)
   Parámetros: ?unidad=<id> abre esa ficha · ?escena=<n> abre el 360° ·
               ?sel=<id,id> recupera una selección compartida.

   La página se dibuja con AgelShowroom.renderBody (todo texto escapado y
   toda URL validada como https). Aquí solo se añade la interacción.
   El recorrido 360° (three.js + motor) se descarga solo al abrirlo.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const params = new URLSearchParams(location.search);
  const app = document.getElementById('sr-app');
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  // Raíz del sitio a partir de la dirección de este mismo archivo (sirve igual
  // en apps/showroom/ y en las páginas pre-generadas p/<slug>/).
  const ROOT = ((document.currentScript && document.currentScript.src) || '').replace(/apps\/showroom\/showroom\.js(\?.*)?$/, '');
  const ENGINE_URL = ROOT + 'packages/panorama/pano-engine.js';
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_SEL = 10;

  let cloud = null;
  try { cloud = AgelCloud.client(); } catch (e) { console.warn('[showroom]', e.message); }

  const state = {
    slug: (app.dataset.slug || params.get('p') || '').toLowerCase(),
    preview: params.get('preview'),
    m: null, version: null, x: null, sel: []
  };

  // ── utilidades DOM sin innerHTML ─────────────────────────────────────
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const put = (el, ...kids) => { el.replaceChildren(...kids.flat().filter(k => k != null && k !== false)); return el; };
  const leaf = id => state.x && state.x.cat.leaves.find(l => l.id === id);
  const label = l => l.name + (l.code ? ` (${l.code})` : '');

  let toastTimer = null;
  function notice(text) {
    let t = $('.sr-toast');
    if (!t) { t = h('div', { class: 'sr-toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
    t.textContent = text; t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 4200);
  }

  // ── medición (contadores anónimos) ───────────────────────────────────
  const sent = new Set();
  function track(ev, once) {
    if (!cloud || !state.slug || state.preview) return;
    if (once) { if (sent.has(once)) return; sent.add(once); }
    cloud.rpc('track_event', { p_slug: state.slug, p_event: ev }, { anon: true }).catch(() => {});
  }

  // ── carga ────────────────────────────────────────────────────────────
  function embedded() {
    const n = document.getElementById('sr-data');
    if (!n) return null;
    try { const d = JSON.parse(n.textContent || 'null'); return d && d.snapshot ? d : null; } catch (_) { return null; }
  }

  function showState(title, text) {
    app.replaceChildren(h('main', { class: 'sr-state', id: 'contenido' }, h('h1', { text: title }), h('p', { class: 'sr-note', text: text })));
    document.title = title;
  }

  async function boot() {
    if(params.get('local')){
      try{if(!cloud?.user)throw Error('Inicia sesión con la cuenta que creó el borrador');const ws=await AgelWorkspace.open({cloud,ownerId:cloud.user.id,projectId:params.get('local')});state.preview='local';hydrate(null,'Local',await ws.previewManifest());window.addEventListener('pagehide',()=>ws.close(),{once:true});}
      catch(e){showState('Borrador local no disponible',e.message);}return;
    }
    const pre = embedded();
    if (pre) hydrate(pre.snapshot, pre.version);
    else app.append(h('div', { class: 'sr-loading', role: 'progressbar', 'aria-label': 'Cargando' }));
    if (!cloud) { if (!pre) showState('Falta configuración', 'Este sitio no tiene config.js con los datos de Supabase.'); return; }
    try {
      let pub;
      if (state.preview) {
        if (!cloud.session) {
          showState('Vista previa privada', 'Inicia sesión en el editor de AgelArq con una cuenta del proyecto y vuelve a abrir este enlace.');
          return;
        }
        pub = await cloud.rpc('preview_version', { p_version: state.preview });
      } else if (state.slug) {
        pub = await cloud.rpc('get_publication', { p_slug: state.slug }, { anon: true });
      }
      if (!pub || !pub.snapshot) {
        if (!pre) showState('Esta página no está disponible', 'Puede que el enlace esté mal escrito o que la publicación se haya retirado. Pide un enlace nuevo a quien te lo compartió.');
        return;
      }
      if (!pre || pre.version !== pub.version) hydrate(pub.snapshot, pub.version);
      if (pub.audience === 'link') document.head.append(h('meta', { name: 'robots', content: 'noindex' }));   // solo con enlace: fuera de buscadores
      if(state.experience&&cloud.session&&pub.id){try{const access=await cloud.rpc('showroom_bim_access',{p_publication:pub.id});if(access)state.experience.setBimAccess(()=>{const url=new URL(ROOT+'apps/bim/',location.href);url.searchParams.set('v',access.version_id);url.searchParams.set('return',location.pathname+location.search);location.href=url.href;});}catch{}}
      track('page_view');
    } catch (e) {
      console.warn('[showroom]', e);
      track('load_error');
      if (!pre) showState(state.preview ? 'No puedes ver esta vista previa' : 'No pudimos cargar la página',
        state.preview ? 'Tu cuenta no tiene acceso a este proyecto o la versión ya no existe.' : 'Revisa tu conexión e inténtalo de nuevo en un momento.');
    }
  }

  function hydrate(snapshot, version, providedModel) {
    let m;
    try { m = providedModel || sanitizeShowroom(snapshot); }
    catch (e) { showState('Esta página no está disponible', 'La publicación tiene un formato que no se pudo leer.'); return; }
    state.experience?.dispose();state.experience=null;
    state.m = m; state.version = version;
    state.x = AgelShowroom.model(m);
    const root = document.documentElement;
    root.style.setProperty('--sr-accent', m.brand.accent);
    root.style.setProperty('--sr-accent-ink', m.brand.accentText);
    const md = AgelShowroom.meta(m);
    document.title = md.title;
    let d = document.querySelector('meta[name="description"]');
    if (!d) { d = h('meta', { name: 'description' }); document.head.append(d); }
    d.setAttribute('content', md.desc);
    if (state.preview) document.head.append(h('meta', { name: 'robots', content: 'noindex' }));
    // renderBody escapa todo texto con esc() y solo recibe URLs https validadas
    // por sanitizeShowroom (ver tests/e2e_showroom.py: inyeccion_no_ejecuta).
    app.innerHTML = AgelShowroom.renderBody(m, { preview: state.preview ? version : null });
    if(m.content.experience?.version===1){
      document.body.classList.add('sr-immersive');
      const host=h('div');app.querySelector('.sr-top')?.after(host);if(!host.isConnected)app.prepend(host);
      const onLocalModel=state.preview==='local'?()=>{const u=new URL(ROOT+'apps/bim/',location.href);u.searchParams.set('local',params.get('local'));u.searchParams.set('return',location.pathname+location.search+location.hash);location.href=u.href;}:null;
      const onModel=/\.glb(\?|$)/i.test(m.content.model3d?.url||'')?()=>openMaquetteModel().catch(()=>{}):null;
      state.navigation=AgelShowroomNavigation.create(m);state.experience=AgelShowroomExperience.mount(host,{manifest:m,navigation:state.navigation,onLocalModel,onModel,openTour:args=>AgelTourBridge.open({...args,openExisting:openTour})});
    }else document.body.classList.remove('sr-immersive');
    loadSelection();
    if(!state.experience){bindHorizon();bindExplore();}bindUnits(); bindTourButtons(); bindGallery(); bindForm(); bindModel();
    renderSelection();
    if(m.content.experience?.version===1)return;
    const u = params.get('unidad');
    if (u) {
      if (leaf(u)) openUnit(u, true);
      else {
        notice(`La ${state.x.labels.one} que buscabas ya no está publicada. Te mostramos las disponibles.`);
        setParam('unidad', null);
        const chk = $('[data-only-available]'); if (chk) { chk.checked = true; chk.dispatchEvent(new Event('change')); }
        const sec = $('#unidades'); if (sec) sec.scrollIntoView({ block: 'start' });
      }
    }
    const esc = params.get('escena');
    if (esc != null && /^\d+$/.test(esc) && +esc < m.scenes.length) openTour(+esc);
  }

  // ── franja de horizonte (panorámica en el encabezado) ────────────────
  function bindHorizon() {
    const band = $('.sr-horizon:not(.sr-horizon-still)');
    if (!band) return;
    const pan = $('.sr-horizon-pan', band);
    let off = 0, imgW = 0, drift = !reduceMotion(), visible = true, last = 0, raf = 0;
    const width = () => band.clientHeight * 2;                      // equirectangular 2:1
    const heading = Number(band.dataset.heading) || 0;
    const center = () => { imgW = width(); off = band.clientWidth / 2 - imgW * ((heading + 180) / 360); apply(); };
    const apply = () => {
      imgW = imgW || width();
      off = ((off % imgW) + imgW) % imgW - imgW;
      band.style.setProperty('--hx', off.toFixed(1) + 'px');
      const lookAt = ((band.clientWidth / 2 - off) / imgW) * 360 - 180;
      pan.setAttribute('aria-valuenow', String(Math.round(((lookAt % 360) + 360) % 360)));
    };
    const moved = () => { drift = false; band.classList.add('is-moved'); };
    center();
    new ResizeObserver(() => { const r = imgW ? off / imgW : 0; imgW = width(); off = r * imgW; apply(); }).observe(band);
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible && drift) loop(); }).observe(band);
    function loop() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function step(t) {
        if (!drift || !visible || document.hidden) { last = 0; return; }
        if (last) { off -= (t - last) * 0.012; apply(); }
        last = t; raf = requestAnimationFrame(step);
      });
    }
    if (drift) loop();
    let start = null;
    pan.addEventListener('pointerdown', e => { if (e.button) return; start = { x: e.clientX, off }; pan.setPointerCapture(e.pointerId); moved(); });
    pan.addEventListener('pointermove', e => { if (!start) return; off = start.off + (e.clientX - start.x); apply(); });
    const end = () => { start = null; };
    pan.addEventListener('pointerup', end); pan.addEventListener('pointercancel', end);
    pan.addEventListener('keydown', e => {
      const step = imgW / 36;
      if (e.key === 'ArrowLeft') off += step; else if (e.key === 'ArrowRight') off -= step;
      else if (e.key === 'Home') { center(); moved(); return; }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTour(0); return; }
      else return;
      e.preventDefault(); moved(); apply();
    });
  }

  // ── explorar: zonas sobre render o plano ─────────────────────────────
  function bindExplore() {
    const sec = $('#explora');
    if (!sec) return;
    const tip = $('.sr-zone-tip', sec);
    const tabs = $$('[data-view-tab]', sec);
    const show = i => {
      tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
      $$('.sr-view', sec).forEach((f, k) => { f.hidden = k !== i; });
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => show(i));
      t.addEventListener('keydown', e => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault(); const n = (i + d + tabs.length) % tabs.length; show(n); tabs[n].focus();
      });
    });
    const tipFor = (z, ev) => {
      tip.textContent = z.getAttribute('aria-label');
      tip.hidden = false;
      const stage = z.closest('.sr-view-stage').getBoundingClientRect(), s = sec.getBoundingClientRect();
      let x, y;
      if (ev && ev.clientX != null) { x = ev.clientX; y = ev.clientY; }
      else { const b = z.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top + b.height / 2; }
      tip.style.left = Math.max(8, Math.min(s.width - 8, x - s.left)) + 'px';
      tip.style.top = (y - s.top) + 'px';
      void stage;
    };
    const activate = z => {
      const id = z.dataset.space;
      if (z.dataset.kind === 'unit') return openUnit(id);
      // Edificio o nivel: filtra la lista y la muestra.
      const chip = $(`[data-filter="${CSS.escape(id)}"]`);
      if (chip) chip.click();
      else { const f = $('#f-q'); void f; }
      const sp = state.x.cat.byId.get(id);
      notice(`Mostrando ${state.x.labels.list.toLowerCase()} de ${sp ? sp.name : 'esta zona'}`);
      $('#unidades').scrollIntoView({ block: 'start' });
    };
    $$('.sr-zone', sec).forEach(z => {
      z.addEventListener('click', () => activate(z));
      z.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(z); } });
      z.addEventListener('pointerenter', e => tipFor(z, e));
      z.addEventListener('pointermove', e => tipFor(z, e));
      z.addEventListener('pointerleave', () => { tip.hidden = true; });
      z.addEventListener('focus', () => tipFor(z));
      z.addEventListener('blur', () => { tip.hidden = true; });
    });
  }
  /** Lleva al plano o render donde está esa unidad y la resalta. */
  function locateOnView(id) {
    const sec = $('#explora'); if (!sec) return false;
    const z = $(`.sr-zone[data-space="${CSS.escape(id)}"]`, sec);
    if (!z) return false;
    const fig = z.closest('.sr-view'), i = +fig.dataset.view;
    const tab = $(`[data-view-tab="${i}"]`, sec); if (tab) tab.click();
    sec.scrollIntoView({ block: 'start' });
    z.classList.add('is-located');
    setTimeout(() => z.classList.remove('is-located'), 2600);
    setTimeout(() => z.focus({ preventScroll: true }), reduceMotion() ? 0 : 300);
    return true;
  }
  const hasZone = id => !!$(`#explora .sr-zone[data-space="${CSS.escape(id)}"]`);

  // ── tabla de unidades: búsqueda, filtros y orden ─────────────────────
  function bindUnits() {
    const sec = $('#unidades');
    if (!sec) return;
    const f = { q: '', bed: '', price: '', area: '', group: '', only: false };
    const tbody = $('tbody', sec), empty = $('.sr-empty', sec), count = $('[data-count]', sec), clear = $('[data-clear]', sec);
    const rows = $$('tr[data-unit-row]', sec), total = rows.length, L = state.x.labels.list.toLowerCase();
    const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const apply = () => {
      let shown = 0;
      const q = norm(f.q.trim());
      rows.forEach(r => {
        const d = r.dataset;
        const ok = (!q || norm(d.q).includes(q))
          && (!f.bed || (d.bed !== '' && +d.bed >= +f.bed))
          && (!f.price || (d.price !== '' && +d.price <= +f.price))
          && (!f.area || (d.area !== '' && +d.area >= +f.area))
          && (!f.group || d.groups.split(' ').includes(f.group))
          && (!f.only || d.avail === 'disponible');
        r.hidden = !ok; if (ok) shown++;
      });
      const active = !!(f.q.trim() || f.bed || f.price || f.area || f.group || f.only);
      count.textContent = active ? `Mostrando ${shown} de ${total} ${L}` : `${total} ${L}`;
      clear.hidden = !active;
      empty.hidden = shown > 0;
    };
    $$('[data-f]', sec).forEach(el => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => { f[el.dataset.f] = el.value; apply(); }));
    const chips = $$('[data-filter]', sec);
    chips.forEach(b => b.addEventListener('click', () => {
      f.group = b.dataset.filter;
      chips.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      apply();
    }));
    const chk = $('[data-only-available]', sec);
    if (chk) chk.addEventListener('change', () => { f.only = chk.checked; apply(); });
    clear.addEventListener('click', () => {
      Object.assign(f, { q: '', bed: '', price: '', area: '', group: '', only: false });
      $$('[data-f]', sec).forEach(el => { el.value = ''; });
      if (chk) chk.checked = false;
      chips.forEach(o => o.setAttribute('aria-pressed', String(o.dataset.filter === '')));
      apply(); $('#f-q').focus();
    });
    // Orden por superficie o precio (sin dato: al final).
    $$('.sr-sort', sec).forEach(b => b.addEventListener('click', () => {
      const th = b.closest('th'), key = b.dataset.sort === 'area_m2' ? 'area' : 'price';
      const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
      $$('th[aria-sort]', sec).forEach(t => t.setAttribute('aria-sort', 'none'));
      th.setAttribute('aria-sort', dir);
      const val = r => r.dataset[key] === '' ? null : +r.dataset[key];
      rows.slice().sort((a, c) => {
        const va = val(a), vc = val(c);
        if (va == null && vc == null) return 0; if (va == null) return 1; if (vc == null) return -1;
        return dir === 'ascending' ? va - vc : vc - va;
      }).forEach(r => tbody.append(r));
    }));
    $$('.sr-unit-open', sec).forEach(b => b.addEventListener('click', () => openUnit(b.dataset.unit)));
    $$('[data-save]', sec).forEach(b => b.addEventListener('click', () => toggleSel(b.dataset.save)));
    apply();
  }

  function setParam(k, v) {
    const u = new URL(location.href);
    if (v == null) u.searchParams.delete(k); else u.searchParams.set(k, v);
    history.replaceState(null, '', u);
  }

  function dialog(cls, title, onClose) {
    const d = h('dialog', { class: `sr-dialog ${cls}`, 'aria-label': title });
    d.addEventListener('close', () => { d.remove(); if (onClose) onClose(); });
    d.addEventListener('click', e => { if (e.target === d) d.close(); });     // clic en el fondo
    document.body.append(d);
    return d;
  }
  const closeBtn = d => h('button', { type: 'button', class: 'sr-x', 'aria-label': 'Cerrar', onclick: () => d.close() }, '×');

  // ── selección guardada, comparación y compartir ──────────────────────
  const selKey = () => `agel.sel.${state.slug || 'preview'}`;
  function loadSelection() {
    let ids = [];
    try { ids = JSON.parse(localStorage.getItem(selKey()) || '[]'); } catch (_) {}
    const shared = params.get('sel');
    if (shared) {
      const asked = shared.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, MAX_SEL);
      ids = asked.filter(leaf);
      const gone = asked.length - ids.length;
      setTimeout(() => notice(gone ? `Abriste una selección compartida. ${gone} ${gone === 1 ? 'opción ya no está publicada' : 'opciones ya no están publicadas'}.`
                                   : 'Abriste una selección compartida.'), 50);
      setParam('sel', null);
    }
    state.sel = [...new Set(ids.filter(leaf))].slice(0, MAX_SEL);
    saveSelection();
  }
  function saveSelection() { try { localStorage.setItem(selKey(), JSON.stringify(state.sel)); } catch (_) {} }
  function toggleSel(id) {
    const i = state.sel.indexOf(id);
    if (i >= 0) state.sel.splice(i, 1);
    else {
      if (state.sel.length >= MAX_SEL) { notice(`Puedes guardar hasta ${MAX_SEL} opciones.`); return; }
      state.sel.push(id);
    }
    saveSelection(); renderSelection();
    const l = leaf(id);
    notice(i >= 0 ? `Quitaste ${l.name} de tu selección` : `Guardaste ${l.name}. Tienes ${state.sel.length} en tu selección.`);
  }
  function shareUrl() {
    const u = new URL(location.href);
    ['unidad', 'escena', 'preview'].forEach(k => u.searchParams.delete(k));
    u.searchParams.set('sel', state.sel.join(','));
    u.hash = '';
    return u.href;
  }
  async function share() {
    const url = shareUrl();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: document.title, url }); return; }
      await navigator.clipboard.writeText(url); notice('Enlace de tu selección copiado');
    } catch (_) { window.prompt('Copia el enlace de tu selección:', url); }
  }
  function renderSelection() {
    const n = state.sel.length;
    $$('[data-save]').forEach(b => {
      const on = state.sel.includes(b.dataset.save); const l = leaf(b.dataset.save);
      b.setAttribute('aria-pressed', String(on));
      if (l) b.setAttribute('aria-label', `${on ? 'Quitar de tu selección' : 'Guardar'} ${l.name}`);
    });
    const bar = $('.sr-selbar');
    if (bar) {
      bar.hidden = !n;
      put(bar, n ? [
        h('p', null, h('strong', { text: `Tu selección: ${n}` }), h('span', { class: 'sr-selbar-names', text: state.sel.map(id => leaf(id).name).join(', ') })),
        h('div', { class: 'sr-selbar-act' },
          h('button', { type: 'button', class: 'sr-btn sr-btn-small sr-btn-quiet', onclick: () => openCompare() }, n >= 2 ? 'Comparar' : 'Comparar (elige otra)'),
          h('button', { type: 'button', class: 'sr-btn sr-btn-small sr-btn-quiet', onclick: share }, 'Compartir'),
          h('a', { class: 'sr-btn sr-btn-small', href: '#contacto' }, 'Pedir información'))
      ] : []);
    }
    const ws = $('.sr-with-sel');
    if (ws) { ws.hidden = !n; const s = $('[data-sel-summary]', ws); if (s) s.textContent = `Incluir mi selección (${n}): ${state.sel.map(id => leaf(id).name).join(', ')}`; }
    document.body.classList.toggle('has-selbar', n > 0);
  }

  function openCompare(a, b) {
    const L = state.x.cat.leaves, S = AgelShowroom, x = state.x;
    if (L.length < 2) return;
    let A = a || state.sel[0] || L[0].id;
    let B = b || state.sel.find(id => id !== A) || L.find(l => l.id !== A && l.availability === 'disponible')?.id || L.find(l => l.id !== A).id;
    const opener = document.activeElement;
    const d = dialog('sr-compare', 'Comparar opciones', () => opener && opener.focus && opener.focus());
    const pick = (cur, other, set) => h('select', { 'aria-label': 'Cambiar opción', onchange: e => { set(e.target.value); draw(); } },
      [...(state.sel.length ? [h('optgroup', { label: 'Tu selección' }, state.sel.filter(id => id !== other).map(id => h('option', { value: id, selected: id === cur }, label(leaf(id)))))] : []),
       h('optgroup', { label: `Todas las ${x.labels.list.toLowerCase()}` }, L.filter(l => l.id !== other && !state.sel.includes(l.id)).map(l => h('option', { value: l.id, selected: l.id === cur }, label(l))))]);
    const table = h('table', { class: 'sr-compare-table' });
    const body = h('div', { class: 'sr-compare-body' },
      h('h2', { text: 'Comparar' }),
      h('p', { class: 'sr-note', text: 'Las diferencias aparecen resaltadas. «Sin dato» significa que esa información no está publicada.' }),
      h('div', { class: 'sr-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Comparación' }, table));
    d.append(closeBtn(d), body);
    function draw() {
      const la = leaf(A), lb = leaf(B);
      const attrKeys = [...new Set([...Object.keys(la.attributes), ...Object.keys(lb.attributes)])];
      const rowsDef = [
        ['Ubicación', l => l.path.map(p => p.name).join(', ')],
        [x.areaLabel, l => l.area_m2 != null ? `${S.num(l.area_m2, 1)} m²` : '', l => l.area_m2],
        ['Recámaras', l => l.bedrooms != null ? S.num(l.bedrooms) : ''],
        ['Baños', l => l.bathrooms != null ? S.num(l.bathrooms, 1) : ''],
        ['Estacionamientos', l => l.parking != null ? S.num(l.parking) : ''],
        ['Precio', l => l.price != null ? S.money(l.price, l.currency) : (x.tracks ? 'Consultar' : ''), l => l.price],
        ['Estado', l => { const s = S.availOf(l, x); return s ? s.label : ''; }],
        ...attrKeys.map(k => [k, l => l.attributes[k] || '']),
        ['Recorrido 360°', l => l.scenes.length ? `${l.scenes.length} ${l.scenes.length === 1 ? 'escena' : 'escenas'}` : 'No disponible'],
        ['Plano', l => l.plan_url ? 'Sí' : 'No disponible']
      ];
      put(table,
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-vh' }, 'Dato')),
          h('th', { scope: 'col' }, pick(A, B, v => { A = v; })), h('th', { scope: 'col' }, pick(B, A, v => { B = v; })))),
        h('tbody', null, rowsDef.map(([k, f, raw]) => {
          const va = f(la), vb = f(lb);
          const diff = va && vb && va !== vb;
          const better = raw && diff ? null : null; void better;
          return h('tr', { class: diff ? 'is-diff' : null },
            h('th', { scope: 'row', text: k }),
            h('td', { class: va ? null : 'is-missing', text: va || 'Sin dato' }),
            h('td', { class: vb ? null : 'is-missing', text: vb || 'Sin dato' }));
        })),
        h('tfoot', null, h('tr', null, h('td'), [la, lb].map(l => h('td', null, h('div', { class: 'sr-compare-act' },
          h('button', { type: 'button', class: 'sr-btn sr-btn-small sr-btn-quiet', onclick: () => { d.close(); openUnit(l.id); } }, 'Ver ficha'),
          l.availability !== 'vendida' ? h('button', { type: 'button', class: 'sr-btn sr-btn-small', onclick: () => { d.close(); askAbout(l.id); } }, 'Pedir información') : null))))));
    }
    draw();
    d.showModal();
    track('unit_view');
  }

  function askAbout(id) {
    const sel = $('#f-unit'); if (sel) sel.value = id;
    $('#contacto').scrollIntoView({ block: 'start' });
    setTimeout(() => $('#f-name') && $('#f-name').focus({ preventScroll: true }), reduceMotion() ? 0 : 350);
  }

  // ── ficha de unidad ──────────────────────────────────────────────────
  function openUnit(id, fromUrl) {
    if(state.experience){state.navigation.dispatch({type:'OPEN_SPACE',id});app.querySelector('.ax-experience')?.scrollIntoView({behavior:reduceMotion()?'auto':'smooth'});return;}
    const L = state.x.labels, x = state.x, S = AgelShowroom;
    const u = leaf(id);
    if (!u) return;
    const opener = document.activeElement;
    track('unit_view');
    if (!fromUrl) setParam('unidad', id);
    const d = dialog('sr-drawer', `${cap(L.one)} ${u.name}`, () => { setParam('unidad', null); if (opener && opener.focus && document.contains(opener)) opener.focus(); });
    const st = S.availOf(u, x);
    const facts = [
      [x.areaLabel, u.area_m2 != null ? `${S.num(u.area_m2, 1)} m²` : null],
      ['Recámaras', u.bedrooms != null ? S.num(u.bedrooms) : null],
      ['Baños', u.bathrooms != null ? S.num(u.bathrooms, 1) : null],
      ['Estacionamientos', u.parking != null ? S.num(u.parking) : null],
      ['Precio', S.priceOf(u, x) || null],
      ['Estado', st ? st.label : null],
      ...Object.entries(u.attributes)
    ].filter(f => f[1]);
    const saved = () => state.sel.includes(u.id);
    const saveBtn = h('button', { type: 'button', class: 'sr-btn sr-btn-quiet', 'aria-pressed': String(saved()), onclick: () => {
      toggleSel(u.id); saveBtn.setAttribute('aria-pressed', String(saved())); saveBtn.textContent = saved() ? 'Guardada en tu selección' : 'Guardar';
    } }, saved() ? 'Guardada en tu selección' : 'Guardar');
    const body = h('div', { class: 'sr-drawer-body' },
      h('h2', { text: label(u) }),
      u.path.length ? h('p', { class: 'sr-path', text: u.path.map(p => p.name).join(', ') }) : null,
      facts.length ? h('dl', null, facts.map(([k, v]) => h('div', null, h('dt', { text: k }), h('dd', { text: v })))) : null,
      u.price != null && u.price_updated_at ? h('p', { class: 'sr-fine', text: `Precio y estado actualizados el ${S.dayMonthYear(u.price_updated_at)}. Sujetos a cambio.` }) : null,
      u.summary ? h('div', { class: 'sr-prose' }, u.summary.split(/\n{2,}/).map(t => h('p', { text: t }))) : null,
      u.plan_url ? h('a', { href: u.plan_url, target: '_blank', rel: 'noopener' },
        /\.pdf(\?|$)/i.test(u.plan_url) ? 'Ver plano (PDF)' : h('img', { class: 'sr-plan', src: u.plan_url, alt: `Plano de ${u.name}` })) : null,
      u.gallery.length ? h('div', { class: 'sr-drawer-shots' }, u.gallery.slice(0, 9).map((g, i) =>
        h('a', { href: g.url, target: '_blank', rel: 'noopener', 'aria-label': g.caption || `Imagen ${i + 1} de ${u.name}` },
          h('img', { src: g.url, alt: '', loading: 'lazy' })))) : null,
      h('div', { class: 'sr-drawer-actions' },
        u.availability !== 'vendida' ? h('button', { type: 'button', class: 'sr-btn', onclick: () => { d.close(); askAbout(u.id); } }, `Pedir información de ${u.name}`) : null,
        u.scenes.length ? h('button', { type: 'button', class: 'sr-btn sr-btn-quiet', onclick: () => { d.close(); openTour(u.scenes[0], u.scenes, u.id); } },
          `Ver ${u.name} en 360°`) : null,
        hasZone(u.id) ? h('button', { type: 'button', class: 'sr-btn sr-btn-quiet', onclick: () => { d.close(); locateOnView(u.id); } }, 'Ver en el plano') : null,
        saveBtn,
        x.cat.leaves.length > 1 ? h('button', { type: 'button', class: 'sr-link-btn', onclick: () => { d.close(); openCompare(u.id); } }, 'Comparar con otra') : null));
    d.append(closeBtn(d), body);
    d.showModal();
    body.querySelector('h2').setAttribute('tabindex', '-1');
    body.querySelector('h2').focus();
  }

  // ── galería ampliada (galería y avance de obra) ──────────────────────
  function bindGallery() {
    $$('.sr-shot[data-shot]').forEach(b => b.addEventListener('click', () => openShot(state.m.content.gallery, +b.dataset.shot, 'Galería')));
    $$('.sr-shot[data-progress]').forEach(b => b.addEventListener('click', () => {
      const [ei, ii] = b.dataset.progress.split(':').map(Number);
      const e = state.m.content.progress[ei];
      openShot(e.images, ii, e.title || 'Avance de obra');
    }));
  }
  function openShot(g, i, title) {
    const opener = document.activeElement;
    const d = dialog('sr-lightbox', title, () => opener && opener.focus && opener.focus());
    const img = h('img', { alt: '' }), capEl = h('span'), count = h('span', { 'aria-live': 'polite' });
    const show = n => { i = (n + g.length) % g.length; img.src = g[i].url; img.alt = g[i].caption || `Imagen ${i + 1}`;
                        capEl.textContent = g[i].caption; count.textContent = `${i + 1} de ${g.length}`; };
    const nav = g.length > 1 ? h('span', { class: 'sr-nav' },
      h('button', { type: 'button', 'aria-label': 'Imagen anterior', onclick: () => show(i - 1) }, 'Anterior'),
      h('button', { type: 'button', 'aria-label': 'Imagen siguiente', onclick: () => show(i + 1) }, 'Siguiente')) : null;
    d.append(closeBtn(d), h('figure', null, img, h('figcaption', null, h('span', null, capEl, ' ', count), nav)));
    d.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') show(i - 1); else if (e.key === 'ArrowRight') show(i + 1); });
    show(i); d.showModal();
  }

  // ── recorrido 360° bajo demanda ──────────────────────────────────────
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    return (loaded[src] = new Promise((res, rej) => {
      const s = h('script', { src }); s.onload = res;
      s.onerror = () => { delete loaded[src]; rej(new Error('No se pudo descargar ' + src)); };
      document.head.append(s);
    }));
  }
  async function engineReady() {
    if (!window.THREE) await loadScript(THREE_URL);
    if (!window.AgelPano) await loadScript(ENGINE_URL);
  }

  function bindTourButtons() {
    $$('[data-tour]').forEach(b => b.addEventListener('click', () => openTour(+b.dataset.tour)));
  }

  /** Vistas (planos/renders) donde está ubicada una escena. */
  const viewsWithScene = i => (state.m.content.views || []).map((v, vi) => ({ v, vi, spot: v.spots.find(s => s.scene === i) })).filter(o => o.spot);
  const viewsWithSpots = () => (state.m.content.views || []).filter(v => v.spots.length);

  function openTour(index, subset, fromUnit, options={}) {
    const m = state.m;
    if (!m.scenes.length) return;
    const list = (subset && subset.length ? subset : m.scenes.map((_, i) => i)).filter(i => m.scenes[i]);
    const opener = document.activeElement;
    let engine = null, current = -1, closed = false, mapOpen = !!options.autoMap, mapView = null,goSeq=0;
    const mapViews=()=>options.mapViews||viewsWithSpots();
    const mapHere=i=>mapViews().filter(v=>v.spots.some(sp=>sp.scene===i)).map(v=>({v}));
    const cache = new Map();
    track('tour_open');
    const L = AgelShowroom.LABELS[m.project.kind] || AgelShowroom.LABELS.desarrollo;
    const d = dialog('sr-tour-dlg', `${L.tour} de ${m.project.name}`, () => {
      closed = true;
      setParam('escena', null);
      if (engine) { cache.forEach(t => t.dispose && t.dispose()); engine.dispose(); engine = null; }
      options.onClose?.();
      if (opener && opener.focus && document.contains(opener)) opener.focus();
    });
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    // El escenario recibe el foco: flechas para mirar, + y − para acercar.
    const stage = h('div', { class: 'sr-tour-stage', tabindex: '0', role: 'group', 'aria-roledescription': 'vista 360°',
                            'aria-label': 'Vista 360°. Usa las flechas para mirar alrededor y + o − para acercar.' }, canvas);
    const layer = h('div', { class: 'sr-hs-layer' });
    const msg = h('div', { class: 'sr-tour-msg', role: 'status' }, 'Cargando recorrido…');
    const title = h('p', { class: 'sr-tour-title' });
    const tools = h('div', { class: 'sr-tour-tools' });
    const scenesNav = h('ol', { class: 'sr-tour-scenes', 'aria-label': 'Ambientes' });
    const mini = h('div', { class: 'sr-minimap', hidden: true, role: 'region', 'aria-label': 'Plano de ubicación' });
    let card = null;
    if(options.immersive){tools.append(h('button',{type:'button',onclick:()=>d.close()},'Volver al departamento'));}
    else if (fromUnit && leaf(fromUnit)) {
      tools.append(h('button', { type: 'button', onclick: () => { d.close(); openUnit(fromUnit); } }, `Volver a ${leaf(fromUnit).name}`));
    }
    let mapBtn = null;
    if (mapViews().length) {
      mapBtn = h('button', { type: 'button', 'aria-pressed': 'false', 'aria-controls': 'sr-minimap', onclick: () => { mapOpen = !mapOpen; drawMap(); } }, 'Plano');
      mini.id = 'sr-minimap';
      tools.append(mapBtn);
    }
    d.append(stage, layer, msg, mini, h('div', { class: 'sr-tour-bar' }, title, tools), scenesNav, closeBtn(d));
    d.addEventListener('keydown', e => {
      if (!engine || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const k = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
      if (k && !e.target.closest('.sr-tour-scenes, .sr-minimap')) { e.preventDefault(); engine.setView(engine.lon + k[0], engine.lat + k[1], engine.fov); }
      else if (e.key === '+' || e.key === '=') engine.animateFov(engine.fov - 10);
      else if (e.key === '-') engine.animateFov(engine.fov + 10);
    });
    list.forEach(i => scenesNav.append(h('li', null, h('button', { type: 'button', 'data-go': i, onclick: () => go(i) }, m.scenes[i].name))));
    d.showModal();
    stage.focus();

    // Plano con "Estás aquí": orientación continua entre plano y 360°.
    function drawMap() {
      if (!mapBtn) return;
      mapBtn.setAttribute('aria-pressed', String(mapOpen));
      mini.hidden = !mapOpen;
      if (!mapOpen) return;
      const here = mapHere(current);
      const all = mapViews();
      if (!mapView || !all.includes(mapView)) mapView = here.length ? here[0].v : all[0];
      const v = mapView;
      put(mini,
        all.length > 1 ? h('select', { 'aria-label': 'Elegir plano', onchange: e => { mapView = all[+e.target.value]; drawMap(); } },
          all.map((o, i) => h('option', { value: i, selected: o === v }, o.title))) : h('p', { class: 'sr-minimap-t', text: v.title }),
        h('div', { class: 'sr-minimap-stage', style: `--ratio:${v.ratio}` },
          h('img', { src: v.image, alt: '' }),
          v.spots.map(sp => {
            const isHere = sp.scene === current;
            return h('button', { type: 'button', class: 'sr-mini-spot' + (isHere ? ' is-here' : ''), style: `left:${sp.x}%;top:${sp.y}%`,
              'aria-current': isHere ? 'location' : null, 'aria-label': `${m.scenes[sp.scene].name}${isHere ? ', estás aquí' : ''}`,
              onclick: () => go(sp.scene) }, isHere ? h('span', { text: 'Estás aquí' }) : null);
          })),
        here.length ? null : h('p', { class: 'sr-minimap-note', text: 'Esta escena aún no está ubicada en el plano.' }));
    }

    function closeCard() { if (card) { card.remove(); card = null; } }
    function info(hs) {
      closeCard();
      card = h('div', { class: 'sr-card', role: 'dialog', 'aria-label': hs.title },
        h('button', { type: 'button', class: 'sr-x', 'aria-label': 'Cerrar información', onclick: () => { closeCard(); stage.focus(); } }, '×'),
        h('h3', { text: hs.title }),
        hs.details.length ? h('ul', null, hs.details.map(t => h('li', { text: t }))) : null,
        hs.img ? h('img', { src: hs.img, alt: '' }) : null);
      d.append(card);
      card.querySelector('button').focus();
    }
    async function texture(i) {
      if (cache.has(i)) return cache.get(i);
      const t = await engine.loadTexture(m.scenes[i].url);
      cache.set(i, t);
      // memoria: se conservan como máximo 3 panorámicas
      if (cache.size > 3) for (const [k, v] of cache) { if (k !== i && !engine.texturesInUse().includes(v)) { v.dispose(); cache.delete(k); break; } }
      return t;
    }
    async function go(i) {
      if (closed || i === current) return;
      if(!list.includes(i))return;const seq=++goSeq;
      const sc = m.scenes[i];
      closeCard();
      msg.hidden = false; msg.textContent = `Cargando ${sc.name}…`;
      try {
        const t = await texture(i);
        if (closed||seq!==goSeq) {if(closed)t.dispose?.();return;}
        engine.setPano(t, current < 0);
        engine.setView(sc.heading || 0, 0, engine.fov);
        current = i; msg.hidden = true;
      } catch (e) {
        msg.textContent = 'No se pudo cargar esta panorámica. Revisa tu conexión.'; track('load_error'); return;
      }
      put(title, document.createTextNode(sc.name), sc.meta ? h('small', { text: sc.meta }) : null);
      $$('button', scenesNav).forEach(b => b.setAttribute('aria-current', String(+b.dataset.go === i)));
      if(!options.immersive)setParam('escena', String(i));options.onSceneChange?.(i);
      put(layer);
      const items = sc.hs.filter(hs=>hs.type!=='scene'||list.includes(hs.targetScene)).map(hs => {
        const el = hs.type === 'scene'
          ? h('button', { type: 'button', class: 'sr-hs sr-hs-scene', 'aria-label': `Ir a ${hs.targetSceneName || hs.title}` }, h('span', { text: hs.title }))
          : h('button', { type: 'button', class: 'sr-hs sr-hs-info', 'aria-label': `Información: ${hs.title}`, title: hs.title });
        // Arrastrar sobre el marcador gira la vista; solo un toque lo activa.
        engine.bindMarker(el, () => hs.type === 'scene' ? go(hs.targetScene) : info(hs));
        layer.append(el);
        return { el, hs, x: hs.x, y: hs.y };
      });
      if(options.immersive)AgelHotspotPresentation.mount(layer,{engine,items});
      engine.setHotspots(items);
      drawMap();
      track('scene_view');
    }

    engineReady().then(async () => {
      if (closed) return;
      engine = new AgelPano.PanoEngine({ canvas, container: stage, fov: 70, minFov: 30, maxFov: 100,
                                         isMobile: () => matchMedia('(pointer: coarse)').matches });
      // Recorrido guiado: avanza solo por las escenas; cualquier gesto lo detiene.
      if (list.length > 1) {
        let guide = null;
        const gbtn = h('button', { type: 'button', 'aria-pressed': 'false' }, 'Recorrido guiado');
        const stopGuide = () => { if (!guide) return; clearInterval(guide); guide = null; engine.autoRotate = false; gbtn.setAttribute('aria-pressed', 'false'); gbtn.textContent = 'Recorrido guiado'; };
        gbtn.addEventListener('click', () => {
          if (guide) return stopGuide();
          gbtn.setAttribute('aria-pressed', 'true'); gbtn.textContent = 'Detener recorrido';
          engine.autoRotate = !reduceMotion();
          guide = setInterval(() => { const k = list.indexOf(current); go(list[(k + 1) % list.length]); }, window.AGEL_GUIDE_MS || 9000);
        });
        canvas.addEventListener('pointerdown', stopGuide);
        layer.addEventListener('pointerdown', stopGuide);
        d.addEventListener('keydown', e => { if (e.key.startsWith('Arrow')) stopGuide(); });
        d.addEventListener('close', stopGuide);
        tools.prepend(gbtn);
      }
      if (await engine.xrSupported()) {
        tools.append(h('button', { type: 'button', onclick: () => engine.enterVR().catch(e => { msg.hidden = false; msg.textContent = e.message; }) }, 'Ver con visor VR'));
      }
      go(index);
    }).catch(() => { msg.textContent = 'No se pudo abrir el recorrido. Revisa tu conexión e inténtalo de nuevo.'; track('load_error'); });
    return {close:()=>d.close()};
  }

  // ── modelo 3D (model-viewer, se descarga solo al pedirlo) ────────────
  const MODEL_VIEWER = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';
  let maquetteSDK;
  async function loadMaquette(){
    if(window.AgelMaquette)return;if(maquetteSDK)return maquetteSDK;
    maquetteSDK=(async()=>{for(const path of ['classify.js','glb-filters.js','maquette-math.js','glb-ar.js','glb-viewer.js','maquette.js']){
      await new Promise((resolve,reject)=>{const script=h('script',{src:ROOT+'packages/bim/'+path});script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('No se pudo cargar el visor. Revisa la conexión y vuelve a intentar.'));};document.head.append(script);});
    }})();try{await maquetteSDK;}catch(e){maquetteSDK=null;throw e;}
  }
  async function openMaquetteModel(){
    if(document.querySelector('.mq-dialog'))return;
    const previous=document.activeElement,dialog=h('dialog',{class:'mq-dialog','aria-label':'Maqueta virtual'}),message=h('p',{role:'status'},'Cargando maqueta…'),cancel=h('button',{type:'button',class:'sr-btn',onclick:()=>dialog.close()},'Cerrar maqueta');
    const loading=h('div',{class:'mq-loading'},h('h2',{},state.m.content.model3d.title||'Maqueta virtual'),message,cancel);put(dialog,loading);document.body.append(dialog);dialog.showModal();
    const request=new AbortController();let pane,closed=false;
    const cleanup=()=>{if(closed)return;closed=true;request.abort();pane?.dispose();dialog.remove();window.removeEventListener('pagehide',cleanup);if(previous?.isConnected)previous.focus();};dialog.addEventListener('close',cleanup,{once:true});window.addEventListener('pagehide',cleanup,{once:true});
    try{
      await loadMaquette();if(closed)return;
      const response=await fetch(state.m.content.model3d.url,{signal:request.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('No se pudo descargar la maqueta. Revisa la conexión y vuelve a intentar.');
      const blob=await response.blob();if(closed)return;loading.remove();
      pane=AgelMaquette.mount(dialog,{blob,title:state.m.content.model3d.title,onClose:()=>dialog.close()});await pane.ready;
    }catch(e){if(!closed&&!pane){message.textContent=e.message||'No se pudo abrir el modelo.';loading.append(h('button',{type:'button',class:'sr-btn',onclick:()=>{dialog.close();openMaquetteModel().catch(()=>{});}},'Reintentar'));}}
  }
  function bindModel() {
    const stage = $('.sr-model-stage');
    if (!stage) return;
    $('[data-model-open]', stage).addEventListener('click', async e => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Cargando modelo…';
      try {
        if(/\.glb(\?|$)/i.test(state.m.content.model3d.url)){await openMaquetteModel();btn.disabled=false;btn.textContent='Ver en 3D';return;}
        if (!customElements.get('model-viewer')) await new Promise((res, rej) => {
          const s = h('script', { type: 'module', src: MODEL_VIEWER }); s.onload = res; s.onerror = () => rej(new Error('descarga'));
          document.head.append(s);
        });
        await customElements.whenDefined('model-viewer');
        const d = state.m.content.model3d;
        const mv = h('model-viewer', { src: d.url, alt: d.title, 'camera-controls': true, 'touch-action': 'pan-y', ar: true,
                                       'ar-modes': 'webxr scene-viewer quick-look', 'shadow-intensity': '1', poster: d.poster || null });
        put(stage, mv);
        track('tour_open');
      } catch (_) { btn.disabled = false; btn.textContent = 'No se pudo cargar. Reintentar'; track('load_error'); }
    });
  }

  // ── contacto ─────────────────────────────────────────────────────────
  function source(withSel) {
    const s = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(k => { const v = params.get(k); if (v) s[k] = v.slice(0, 100); });
    try { if (document.referrer) { const r = new URL(document.referrer); if (r.origin !== location.origin) s.referrer = r.origin; } } catch (_) {}
    s.path = location.pathname.slice(0, 200);
    if (state.version != null) s.version = state.version;
    if (withSel && state.sel.length) s.selection = state.sel.slice(0, MAX_SEL);
    return s;
  }

  function bindForm() {
    const form = $('.sr-form');
    if (!form) return;
    const err = $('.sr-form-error', form), btn = $('button[type="submit"]', form);
    form.addEventListener('focusin', () => track('contact_start', 'contact_start'));
    if (state.preview) { btn.disabled = true; err.textContent = 'En la vista previa el formulario no envía solicitudes.'; }
    const mark = (name, bad) => { const f = form.elements[name]; if (f) f.setAttribute('aria-invalid', String(!!bad)); return bad; };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (state.preview) return;
      err.textContent = '';
      const v = n => String((form.elements[n] && form.elements[n].value) || '').trim();
      const problems = [
        mark('name', v('name').length < 2) && 'Escribe tu nombre.',
        mark('email', !/^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i.test(v('email'))) && 'Revisa tu correo.',
        !form.elements.consent.checked && 'Marca la casilla de autorización para que podamos contactarte.'
      ].filter(Boolean);
      if (problems.length) {
        err.textContent = problems.join(' ');
        const first = form.querySelector('[aria-invalid="true"]') || form.elements.consent; first.focus();
        return;
      }
      if (v('company')) { done(); return; }        // trampa para robots: no se envía
      const withSel = form.elements.with_selection && form.elements.with_selection.checked && !$('.sr-with-sel').hidden;
      btn.disabled = true; const lbl = btn.textContent; btn.textContent = 'Enviando…';
      try {
        await cloud.rpc('submit_lead', {
          p_slug: state.slug, p_space: v('space') || null, p_name: v('name'), p_email: v('email'),
          p_phone: v('phone'), p_message: v('message'), p_consent: true, p_source: source(withSel)
        }, { anon: true });
        track('lead_submitted');
        done(withSel);
      } catch (ex) {
        btn.disabled = false; btn.textContent = lbl;
        err.textContent = ex.isQuota ? 'Ya recibimos varias solicitudes desde este correo. Te contactaremos pronto; si es urgente usa el teléfono o WhatsApp.'
          : ex.status === 0 ? 'Sin conexión. Tus datos siguen aquí; inténtalo de nuevo.'
          : (ex.message || 'No se pudo enviar. Inténtalo de nuevo.');
      }
    });
    function done(withSel) {
      const unit = leaf(v2('space'));
      const about = unit ? `sobre ${unit.name}` : withSel ? `sobre tu selección (${state.sel.length})` : '';
      const box = h('div', { class: 'sr-done', role: 'status', tabindex: '-1' },
        h('h3', { text: 'Recibimos tu solicitud' }),
        h('p', { text: `Gracias${v2('name') ? ', ' + v2('name').split(' ')[0] : ''}. Te escribiremos ${about ? about + ' ' : ''}a ${v2('email')}.` }));
      form.replaceWith(box); box.focus();
    }
    function v2(n) { return String((form.elements[n] && form.elements[n].value) || '').trim(); }
  }

  boot();
})();
