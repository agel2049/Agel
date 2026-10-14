/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · panel de gestión (plan maestro: fases 1, 3, 4, 5 y 6)

   Dirección: apps/panel/#/p/<proyecto>/<pestaña>  o  #/org/<organización>
   Pestañas del proyecto (según el rol):
     showroom · catálogo · publicaciones · prospectos · equipo · modelos y 4D ·
     actividad · exportar
   Organización: marca, uso y cuota, actividad.
   Todo se construye con AgelDOM.h (sin innerHTML). Los permisos reales
   los aplica la base de datos; aquí solo se ocultan acciones que fallarían.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const { h, modal, field, formatBytes, formatDate, notify, icon } = AgelDOM;
  // Vacía y llena un elemento; acepta listas anidadas y omite null/false.
  const put = (el, ...kids) => { el.replaceChildren(); return AgelDOM.append(el, kids); };
  const app = document.getElementById('app');
  const ROOT = '../../';
  let cloud;
  try { cloud = AgelCloud.client(); }
  catch (e) { app.append(h('p', { class: 'pn-empty' }, 'Falta config.js con los datos de Supabase.')); return; }

  const S = { access: null, orgId: null, projectId: null, tab: 'showroom', project: null };
  const ROLE = { owner: 'Propietario', editor: 'Editor', reviewer: 'Revisor', viewer: 'Lector' };
  const KIND = { desarrollo: 'Desarrollo (varias unidades)', edificio: 'Edificio', vivienda: 'Vivienda', ambiente: 'Ambiente o interiorismo', producto: 'Producto' };
  const SPACE_KIND = { conjunto: 'Conjunto', edificio: 'Edificio o torre', nivel: 'Nivel', unidad: 'Unidad', area: 'Área común',
                       espacio: 'Espacio', ambiente: 'Ambiente', producto: 'Producto', variante: 'Variante' };
  const AVAIL = { disponible: 'Disponible', apartada: 'Apartada', vendida: 'Vendida', no_aplica: 'No aplica' };
  const PUB_STATUS = { draft: ['Borrador', ''], review: ['En revisión', 'warn'], published: ['Publicada', 'ok'], archived: ['Archivada', 'bad'] };
  const LEAD_STATUS = { nuevo: 'Nuevo', contactado: 'Contactado', cerrado: 'Cerrado', descartado: 'Descartado' };
  const MV_STATUS = { pending: ['Pendiente', ''], uploading: ['Subiendo', 'warn'], translating: ['Convirtiendo', 'warn'], ready: ['Listo', 'ok'], failed: ['Falló', 'bad'] };

  const role = () => (S.project && S.project.role) || null;
  const canEdit = () => ['owner', 'editor'].includes(role());
  const isOwner = () => role() === 'owner';
  const orgRole = () => { const o = S.access && S.access.orgs.find(x => x.id === S.orgId); return o ? o.role : null; };
  const isOrgAdmin = () => ['owner', 'admin'].includes(orgRole());
  const fail = e => { console.warn(e); notify(e && e.message || 'Algo salió mal', 'error'); };
  const input = (attrs) => h('input', Object.assign({ type: 'text' }, attrs));
  const lines = t => String(t || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const siteBase = () => {
    const c = window.AGEL_CONFIG || {};
    return c.siteUrl ? c.siteUrl.replace(/\/?$/, '/') : new URL(ROOT, location.href).href;
  };
  const publicLink = pub => pub.kind === 'showroom' ? `${siteBase()}apps/showroom/?p=${pub.slug}` : `${siteBase()}index.html?pub=${pub.slug}`;
  function download(name, data, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); notify('Copiado'); } catch (_) { notify(text); }
  }
  function busy(btn, on, text) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; if (text) btn.textContent = text; }
    else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  }

  // ═════════════════════════════ acceso ═════════════════════════════
  function loginView(msg) {
    const email = input({ type: 'email', autocomplete: 'email', required: true });
    const pass = input({ type: 'password', autocomplete: 'current-password' });
    const err = h('p', { class: 'ag-error', role: 'alert' }, msg || '');
    const send = h('button', { type: 'submit', class: 'ag-btn primary' }, 'Entrar');
    const form = h('form', { class: 'pn-login', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      busy(send, true, 'Entrando…');
      try { await cloud.signInWithPassword(email.value.trim(), pass.value); start(); }
      catch (ex) { err.textContent = ex.message; busy(send, false); }
    } },
      h('h1', null, 'Panel de AgelArq'),
      h('p', { class: 'pn-muted' }, 'Entra con la misma cuenta que usas en el editor.'),
      field('Correo', email), field('Contraseña', pass), err, send,
      h('button', { type: 'button', class: 'ag-btn link', onclick: async () => {
        if (!email.value.trim()) { err.textContent = 'Escribe tu correo primero'; return; }
        try { await cloud.sendMagicLink(email.value.trim(), location.href.split('#')[0]); err.textContent = ''; notify('Te enviamos un enlace de acceso'); }
        catch (ex) { err.textContent = ex.message; }
      } }, 'Enviarme un enlace de acceso'),
      h('a', { class: 'ag-btn link', href: ROOT + 'index.html' }, 'Volver al editor'));
    put(app, h('main', { class: 'pn-center' }, form));
  }

  async function start() {
    try { if (cloud.consumeRedirect) await cloud.consumeRedirect(); } catch (_) {}
    if (!cloud.session) return loginView();
    put(app, h('p', { class: 'pn-empty' }, 'Cargando…'));
    try { S.access = await cloud.rpc('my_access'); }
    catch (e) { if (e.isAuth) return loginView('Tu sesión venció; vuelve a entrar.'); return put(app, h('p', { class: 'pn-empty' }, e.message)); }
    if (!S.access.orgs.length) {
      put(app, h('main', { class: 'pn-center' }, h('div', { class: 'pn-login' },
        h('h1', null, 'Aún no tienes organización'),
        h('p', { class: 'pn-muted' }, 'Créala desde el editor la primera vez que entras; después vuelve a este panel.'),
        h('a', { class: 'ag-btn primary', href: ROOT + 'index.html' }, 'Ir al editor'))));
      return;
    }
    window.addEventListener('hashchange', route);
    route();
  }

  function parseHash() {
    const p = location.hash.replace(/^#\/?/, '').split('/');
    if (p[0] === 'p' && p[1]) return { projectId: p[1], tab: p[2] || 'showroom' };
    if (p[0] === 'org' && p[1]) return { orgId: p[1], tab: p[2] || 'marca' };
    return {};
  }

  async function route() {
    const r = parseHash();
    const A = S.access;
    if (r.projectId) {
      const pr = A.projects.find(x => x.id === r.projectId);
      if (!pr) { location.hash = ''; return; }
      S.orgId = pr.org_id; S.projectId = pr.id; S.tab = r.tab;
    } else if (r.orgId && A.orgs.some(o => o.id === r.orgId)) {
      S.orgId = r.orgId; S.projectId = null; S.tab = r.tab;
    } else {
      S.orgId = S.orgId || A.orgs[0].id;
      const first = A.projects.find(x => x.org_id === S.orgId);
      location.hash = first ? `#/p/${first.id}/showroom` : `#/org/${S.orgId}`;
      return;
    }
    S.project = S.projectId ? A.projects.find(x => x.id === S.projectId) : null;
    layout();
  }

  // ═════════════════════════════ estructura ═════════════════════════════
  const PTABS = [
    ['showroom', 'Showroom', 'layout-board', () => canEdit()],
    ['catalogo', 'Catálogo', 'building', () => true],
    ['publicaciones', 'Publicaciones', 'world-share', () => true],
    ['prospectos', 'Prospectos', 'address-book', () => canEdit()],
    ['equipo', 'Equipo', 'users', () => true],
    ['modelos', 'Modelos y 4D', 'box', () => true],
    ['actividad', 'Actividad', 'history', () => isOwner()],
    ['exportar', 'Exportar', 'download', () => true]
  ];
  const OTABS = [['marca', 'Marca', 'palette'], ['uso', 'Uso y cuota', 'gauge'], ['actividad', 'Actividad', 'history']];

  function layout() {
    const A = S.access;
    const orgSel = h('select', { 'aria-label': 'Organización', onchange: e => {
      S.orgId = e.target.value;
      const first = A.projects.find(x => x.org_id === S.orgId);
      location.hash = first ? `#/p/${first.id}/showroom` : `#/org/${S.orgId}`;
    } }, A.orgs.map(o => h('option', { value: o.id, selected: o.id === S.orgId }, o.name)));
    const projects = A.projects.filter(p => p.org_id === S.orgId);
    const side = h('nav', { class: 'pn-side', 'aria-label': 'Proyectos' },
      h('div', { class: 'pn-side-org' }, orgSel),
      h('a', { href: `#/org/${S.orgId}`, class: 'pn-side-link' + (!S.projectId ? ' is-on' : ''), 'aria-current': !S.projectId ? 'page' : null },
        icon('settings'), 'Organización'),
      h('p', { class: 'pn-side-h' }, 'Proyectos'),
      projects.length ? h('ul', null, projects.map(p => h('li', null, h('a', {
        href: `#/p/${p.id}/${S.tab && PTABS.some(t => t[0] === S.tab) ? S.tab : 'showroom'}`,
        class: 'pn-side-link' + (p.id === S.projectId ? ' is-on' : ''), 'aria-current': p.id === S.projectId ? 'page' : null
      }, h('span', null, p.name), h('small', null, ROLE[p.role] || ''))))) : h('p', { class: 'pn-muted pn-pad' }, 'Sin proyectos. Créalos en el editor.'));
    const top = h('header', { class: 'pn-top' },
      h('a', { href: ROOT + 'index.html', class: 'pn-logo' }, 'AgelArq'),
      h('span', { class: 'pn-top-title' }, 'Panel'),
      h('span', { class: 'pn-grow' }),
      h('a', { class: 'ag-btn', href: ROOT + 'index.html' }, icon('edit'), 'Editor'),
      h('span', { class: 'pn-user' }, (cloud.user && cloud.user.email) || ''),
      h('button', { class: 'ag-btn', type: 'button', onclick: async () => { await cloud.signOut(); location.hash = ''; loginView(); } }, 'Salir'));
    const main = h('main', { class: 'pn-main', id: 'pn-main' });
    put(app, top, h('div', { class: 'pn-body' }, side, main));
    if (S.projectId) projectView(main); else orgView(main);
  }

  function tabsBar(list, current, href) {
    return h('nav', { class: 'pn-tabs', 'aria-label': 'Secciones' }, list.map(([id, label, ic]) =>
      h('a', { href: href(id), class: 'pn-tab' + (id === current ? ' is-on' : ''), 'aria-current': id === current ? 'page' : null }, icon(ic), label)));
  }

  function projectView(main) {
    const tabs = PTABS.filter(t => t[3]());
    if (!tabs.some(t => t[0] === S.tab)) { location.hash = `#/p/${S.projectId}/${tabs[0][0]}`; return; }
    const body = h('section', { class: 'pn-content' });
    main.append(h('div', { class: 'pn-head' },
      h('h1', null, S.project.name),
      h('span', { class: 'ag-pill' }, ROLE[role()] || role())),
      tabsBar(tabs, S.tab, id => `#/p/${S.projectId}/${id}`), body);
    const fn = { showroom: tabShowroom, catalogo: tabCatalog, publicaciones: tabPublications, prospectos: tabLeads,
                 equipo: tabTeam, modelos: tabModels, actividad: tabActivity, exportar: tabExport }[S.tab];
    body.append(h('p', { class: 'pn-muted' }, 'Cargando…'));
    Promise.resolve(fn(body)).catch(e => { put(body, h('p', { class: 'ag-error' }, e.message)); });
  }

  function orgView(main) {
    if (!OTABS.some(t => t[0] === S.tab)) S.tab = 'marca';
    const org = S.access.orgs.find(o => o.id === S.orgId);
    const body = h('section', { class: 'pn-content' });
    main.append(h('div', { class: 'pn-head' }, h('h1', null, org.name), h('span', { class: 'ag-pill' }, orgRole())),
      tabsBar(OTABS, S.tab, id => `#/org/${S.orgId}/${id}`), body);
    const fn = { marca: orgBrand, uso: orgUsage, actividad: orgActivity }[S.tab];
    Promise.resolve(fn(body, org)).catch(e => put(body, h('p', { class: 'ag-error' }, e.message)));
  }

  // ═════════════════════════════ showroom ═════════════════════════════
  async function tabShowroom(body) {
    const [[p], spaces, scenes] = await Promise.all([
      cloud.select('projects', `id=eq.${S.projectId}&select=id,name,subtitle,location,delivery,kind,showroom`),
      cloud.select('spaces', `project_id=eq.${S.projectId}&select=id,parent_id,kind,name,code&order=position.asc,name.asc`),
      cloud.select('scenes', `project_id=eq.${S.projectId}&select=id,name,pano_url&order=position.asc`)]);
    const sr = Object.assign({}, p.showroom || {});
    const views = JSON.parse(JSON.stringify(Array.isArray(sr.views) ? sr.views : []));
    const progress = JSON.parse(JSON.stringify(Array.isArray(sr.progress) ? sr.progress : []));
    const loc = sr.location || {}, ct = sr.contact || {}, seo = sr.seo || {};
    const gallery = (sr.gallery || []).map(g => typeof g === 'string' ? { url: g, caption: '' } : Object.assign({}, g));
    const plans = (sr.plans || []).map(x => Object.assign({}, x));
    const f = {
      kind: h('select', null, Object.entries(KIND).map(([k, v]) => h('option', { value: k, selected: p.kind === k }, v))),
      subtitle: input({ value: p.subtitle, maxlength: 240 }), location: input({ value: p.location, maxlength: 240 }),
      delivery: input({ value: p.delivery, maxlength: 80, placeholder: 'Diciembre 2027' }),
      tagline: input({ value: sr.tagline || '', maxlength: 200 }),
      description: h('textarea', { rows: 6, maxlength: 4000 }, sr.description || ''),
      highlights: h('textarea', { rows: 4 }, (sr.highlights || []).join('\n')),
      amenities: h('textarea', { rows: 4 }, (sr.amenities || []).join('\n')),
      address: input({ value: loc.address || '', maxlength: 300 }), map_url: input({ type: 'url', value: loc.map_url || '', placeholder: 'https://maps.app.goo.gl/…' }),
      loc_notes: h('textarea', { rows: 2, maxlength: 500 }, loc.notes || ''),
      cta: input({ value: ct.cta || '', maxlength: 60, placeholder: 'Solicitar información' }),
      whatsapp: input({ type: 'tel', value: ct.whatsapp || '', placeholder: '524431234567' }),
      email: input({ type: 'email', value: ct.email || '' }), hours: input({ value: ct.hours || '', placeholder: 'de lunes a sábado, 9 a 19 h' }),
      seo_title: input({ value: seo.title || '', maxlength: 70 }), seo_desc: h('textarea', { rows: 2, maxlength: 170 }, seo.description || ''),
      disclaimer: h('textarea', { rows: 2, maxlength: 600 }, sr.disclaimer || ''),
      notify_email: input({ type: 'email', value: sr.notify_email || '' }),
      webhook: input({ type: 'url', value: sr.webhook || '', placeholder: 'https://…' }),
      model_url: input({ type: 'url', value: (sr.model3d || {}).url || '', placeholder: 'https://… .glb' }),
      model_title: input({ value: (sr.model3d || {}).title || '', maxlength: 120, placeholder: 'Modelo 3D' }),
      area_label: h('select', null, [['', 'Superficie (sin especificar)'], ['interior', 'Superficie interior'], ['total', 'Superficie total'],
        ['construida', 'Superficie construida'], ['util', 'Superficie útil'], ['terreno', 'Terreno']].map(([k, v]) => h('option', { value: k, selected: (sr.area_label || '') === k }, v)))
    };
    const counter = (el, max) => { const c = h('span', { class: 'pn-count' }); const u = () => c.textContent = `${el.value.length}/${max}`; el.addEventListener('input', u); u(); return c; };

    const galList = h('ul', { class: 'pn-media' });
    const planList = h('ul', { class: 'pn-media' });
    function mediaRow(list, arr, i, render) {
      const it = arr[i];
      return h('li', null,
        /\.pdf(\?|$)/i.test(it.url) ? h('span', { class: 'pn-pdf' }, 'PDF') : h('img', { src: it.url, alt: '', loading: 'lazy' }),
        render(it),
        h('span', { class: 'pn-media-act' },
          h('button', { type: 'button', class: 'ag-btn', 'aria-label': 'Subir', disabled: i === 0, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; draw(); } }, icon('arrow-up')),
          h('button', { type: 'button', class: 'ag-btn danger', 'aria-label': 'Quitar', onclick: () => { arr.splice(i, 1); draw(); } }, icon('trash'))));
    }
    function draw() {
      put(galList, ...gallery.map((g, i) => mediaRow(galList, gallery, i, it =>
        input({ value: it.caption || '', placeholder: 'Pie de foto', 'aria-label': 'Pie de foto', maxlength: 160, oninput: e => { it.caption = e.target.value; } }))));
      put(planList, ...plans.map((g, i) => mediaRow(planList, plans, i, it =>
        input({ value: it.title || '', placeholder: 'Título del plano', 'aria-label': 'Título del plano', maxlength: 120, oninput: e => { it.title = e.target.value; } }))));
    }
    // Vistas para explorar (render o plano con zonas y puntos 360°).
    const viewList = h('ul', { class: 'pn-media pn-views' });
    const spaceIds = new Set(spaces.map(x => x.id)), sceneIds = new Set(scenes.map(x => x.id));
    function drawViews() {
      put(viewList, views.map((v, i) => {
        const broken = (v.regions || []).filter(r => !spaceIds.has(r.space)).length + (v.spots || []).filter(sp => !sceneIds.has(sp.scene)).length;
        return h('li', null, h('img', { src: v.image, alt: '', loading: 'lazy' }),
          h('div', { class: 'pn-view-meta' },
            input({ value: v.title || '', 'aria-label': 'Título de la vista', maxlength: 80, oninput: e => { v.title = e.target.value; } }),
            h('small', { class: 'pn-muted' }, `${(v.regions || []).length} zonas, ${(v.spots || []).length} puntos 360°`,
              broken ? h('span', { class: 'ag-error' }, ` · ${broken} apuntan a algo que ya no existe`) : null)),
          h('span', { class: 'pn-media-act' },
            h('button', { type: 'button', class: 'ag-btn primary', onclick: () => editView(v, spaces, scenes, () => { drawViews(); form.requestSubmit(); }) }, 'Dibujar zonas'),
            h('button', { type: 'button', class: 'ag-btn', 'aria-label': 'Subir', disabled: i === 0, onclick: () => { [views[i - 1], views[i]] = [views[i], views[i - 1]]; drawViews(); } }, icon('arrow-up')),
            h('button', { type: 'button', class: 'ag-btn danger', 'aria-label': 'Quitar vista', onclick: () => { if (confirm('¿Quitar esta vista y sus zonas?')) { views.splice(i, 1); drawViews(); } } }, icon('trash'))));
      }));
    }
    drawViews();
    // Avance de obra: hitos con fecha, nota y fotos.
    const progList = h('ul', { class: 'pn-prog' });
    function drawProgress() {
      put(progList, progress.map((e, i) => h('li', null,
        h('div', { class: 'pn-grid' },
          field('Mes', input({ type: 'month', value: (e.date || '').slice(0, 7), oninput: ev => { e.date = ev.target.value; } })),
          field('Hito', input({ value: e.title || '', maxlength: 120, placeholder: 'Ej. Losa del nivel 4', oninput: ev => { e.title = ev.target.value; } }))),
        field('Nota', h('textarea', { rows: 2, maxlength: 600, oninput: ev => { e.note = ev.target.value; } }, e.note || '')),
        h('div', { class: 'pn-thumbs' }, (e.images || []).map((u, k) => h('span', null, h('img', { src: typeof u === 'string' ? u : u.url, alt: '' }),
          h('button', { type: 'button', class: 'ag-btn danger', 'aria-label': 'Quitar foto', onclick: () => { e.images.splice(k, 1); drawProgress(); } }, icon('x'))))),
        h('div', { class: 'pn-actions' },
          uploader('Agregar fotos', 'image/jpeg,image/png,image/webp', 'image', url => { (e.images = e.images || []).push(url); drawProgress(); }),
          h('button', { type: 'button', class: 'ag-btn danger', onclick: () => { progress.splice(i, 1); drawProgress(); } }, 'Quitar hito')))));
    }
    drawProgress();
    draw();
    function uploader(label, accept, kind, onDone) {
      const fi = h('input', { type: 'file', accept, multiple: true, hidden: true });
      const btn = h('button', { type: 'button', class: 'ag-btn', onclick: () => fi.click() }, icon('upload'), label);
      fi.addEventListener('change', async () => {
        for (const file of fi.files) {
          busy(btn, true, `Subiendo ${file.name}…`);
          try { const r = await cloud.upload(S.projectId, file, { kind, contentType: /\.glb$/i.test(file.name) ? 'model/gltf-binary' : undefined }); onDone(r.url, file); }
          catch (e) { fail(e); }
        }
        busy(btn, false); fi.value = ''; draw();
      });
      return h('span', null, btn, fi);
    }
    const err = h('p', { class: 'ag-error', role: 'alert' });
    const save = h('button', { type: 'submit', class: 'ag-btn primary' }, 'Guardar');
    const httpsOrEmpty = v => !v || /^https:\/\//i.test(v);
    const form = h('form', { class: 'pn-form', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      for (const [k, label] of [['map_url', 'El enlace del mapa'], ['webhook', 'El webhook'], ['model_url', 'El modelo 3D']])
        if (!httpsOrEmpty(f[k].value.trim())) { err.textContent = `${label} debe empezar con https://`; f[k].focus(); return; }
      const next = Object.assign({}, sr, {
        tagline: f.tagline.value.trim(), description: f.description.value.trim(),
        highlights: lines(f.highlights.value).slice(0, 12), amenities: lines(f.amenities.value).slice(0, 30),
        gallery: gallery.map(g => ({ url: g.url, caption: (g.caption || '').trim() })),
        plans: plans.map(x => ({ url: x.url, title: (x.title || '').trim() })),
        location: { address: f.address.value.trim(), map_url: f.map_url.value.trim(), notes: f.loc_notes.value.trim() },
        contact: { cta: f.cta.value.trim(), whatsapp: f.whatsapp.value.replace(/[^\d]/g, ''), email: f.email.value.trim(), hours: f.hours.value.trim() },
        seo: { title: f.seo_title.value.trim(), description: f.seo_desc.value.trim() },
        disclaimer: f.disclaimer.value.trim(), notify_email: f.notify_email.value.trim(), webhook: f.webhook.value.trim(),
        model3d: f.model_url.value.trim() ? { url: f.model_url.value.trim(), title: f.model_title.value.trim() } : null,
        area_label: f.area_label.value,
        views: views.map(v => ({ id: v.id, title: (v.title || '').trim(), kind: v.kind || 'render', image: v.image, w: v.w, h: v.h,
                                 regions: (v.regions || []).filter(r => spaceIds.has(r.space)), spots: (v.spots || []).filter(sp => sceneIds.has(sp.scene)) })),
        progress: progress.filter(e => (e.title || '').trim() || (e.images || []).length)
          .map(e => ({ date: e.date || '', title: (e.title || '').trim(), note: (e.note || '').trim(), images: (e.images || []).map(u => typeof u === 'string' ? u : u.url) }))
      });
      busy(save, true, 'Guardando…');
      try {
        await cloud.update('projects', `id=eq.${S.projectId}`, { kind: f.kind.value, subtitle: f.subtitle.value.trim(),
          location: f.location.value.trim(), delivery: f.delivery.value.trim(), showroom: next });
        Object.assign(sr, next);
        notify('Guardado. Crea una versión en Publicaciones para que el público lo vea.');
      } catch (ex) { err.textContent = ex.message; }
      busy(save, false);
    } },
      h('div', { class: 'pn-note' }, icon('info-circle'), 'Lo que guardes aquí aparece en el showroom cuando creas y publicas una versión nueva. Las escenas 360° se editan en el editor.'),
      h('fieldset', null, h('legend', null, 'Proyecto'),
        h('div', { class: 'pn-grid' }, field('Tipo', f.kind, 'Cambia cómo se nombran las unidades en el showroom.'), field('Ubicación', f.location),
          field('Subtítulo', f.subtitle), field('Entrega', f.delivery),
          field('Qué superficie publicas', f.area_label, 'Se muestra tal cual en la tabla, la ficha y la comparación.'))),
      h('fieldset', null, h('legend', null, 'Presentación'),
        field('Frase principal', f.tagline), field('Descripción', f.description, 'Separa párrafos con una línea en blanco.'),
        h('div', { class: 'pn-grid' }, field('Puntos destacados', f.highlights, 'Uno por línea (máx. 12).'), field('Amenidades', f.amenities, 'Una por línea.'))),
      h('fieldset', null, h('legend', null, 'Galería'), galList,
        uploader('Agregar imágenes', 'image/jpeg,image/png,image/webp', 'image', url => gallery.push({ url, caption: '' }))),
      h('fieldset', null, h('legend', null, 'Planos'), planList,
        uploader('Agregar planos (imagen o PDF)', 'image/jpeg,image/png,image/webp,application/pdf', 'plan', (url, file) => plans.push({ url, title: file.name.replace(/\.[^.]+$/, '') }))),
      h('fieldset', null, h('legend', null, 'Explorar: render o plano con zonas'),
        h('p', { class: 'pn-muted' }, 'Sube un render del conjunto o una planta. Luego dibuja sobre ella las zonas de cada edificio o unidad (el color muestra si está disponible) y coloca los puntos de las escenas 360°. El mismo plano sirve de «Estás aquí» dentro del recorrido.'),
        viewList,
        uploader('Agregar vista (render o planta)', 'image/jpeg,image/png,image/webp', 'image', async (url, file) => {
          const dims = await new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({}); im.src = URL.createObjectURL(file); });
          views.push({ id: 'v' + Math.random().toString(36).slice(2, 8), title: file.name.replace(/\.[^.]+$/, ''), kind: 'render', image: url, w: dims.w, h: dims.h, regions: [], spots: [] });
          drawViews();
        })),
      h('fieldset', null, h('legend', null, 'Avance de obra'),
        h('p', { class: 'pn-muted' }, 'Fotos e hitos aprobados para el público. Es distinto del calendario 4D técnico.'),
        progList,
        h('button', { type: 'button', class: 'ag-btn', onclick: () => { progress.unshift({ date: new Date().toISOString().slice(0, 7), title: '', note: '', images: [] }); drawProgress(); } }, icon('plus'), 'Agregar hito')),
      h('fieldset', null, h('legend', null, 'Modelo 3D (opcional)'),
        h('p', { class: 'pn-muted' }, 'Archivo GLB para girarlo en la página y verlo con realidad aumentada en teléfonos. Ideal para productos y mobiliario. Máximo 50 MB; mejor menos de 15 MB.'),
        h('div', { class: 'pn-grid' }, field('Archivo GLB (URL https)', f.model_url), field('Título', f.model_title)),
        uploader('Subir GLB', '.glb,model/gltf-binary', 'glb', url => { f.model_url.value = url; })),
      h('fieldset', null, h('legend', null, 'Ubicación'),
        field('Dirección', f.address), field('Enlace del mapa', f.map_url), field('Notas (accesos, distancias)', f.loc_notes)),
      h('fieldset', null, h('legend', null, 'Contacto'),
        h('div', { class: 'pn-grid' }, field('Texto del botón', f.cta), field('WhatsApp', f.whatsapp, 'Con lada del país, solo números.'),
          field('Correo público', f.email), field('Horario', f.hours))),
      h('fieldset', null, h('legend', null, 'Buscadores y redes'),
        h('div', { class: 'ag-field' }, h('label', { for: 'seo-t' }, 'Título ', counter(f.seo_title, 70)), Object.assign(f.seo_title, { id: 'seo-t' })),
        h('div', { class: 'ag-field' }, h('label', { for: 'seo-d' }, 'Descripción ', counter(f.seo_desc, 170)), Object.assign(f.seo_desc, { id: 'seo-d' })),
        field('Aviso legal', f.disclaimer, 'Se muestra al pie. Si lo dejas vacío se usa un aviso genérico.')),
      h('fieldset', null, h('legend', null, 'Avisos internos (no se publican)'),
        h('div', { class: 'pn-grid' }, field('Correo para avisos de prospectos', f.notify_email),
          field('Webhook de CRM', f.webhook, 'Se envía un POST con cada prospecto nuevo (ver docs).'))),
      err, h('div', { class: 'pn-actions' }, save));
    put(body, form);
  }

  // Editor de zonas: dibuja polígonos sobre el render o plano y coloca los
  // puntos de las escenas 360°. Coordenadas en % de la imagen (0–100).
  function editView(v, spaces, scenes, onDone) {
    const work = { regions: JSON.parse(JSON.stringify(v.regions || [])), spots: JSON.parse(JSON.stringify(v.spots || [])) };
    const byId = new Map(spaces.map(x => [x.id, x]));
    const hasKids = new Set(spaces.filter(x => x.parent_id).map(x => x.parent_id));
    const path = x => { const out = []; let c = x, g = 0; while (c && g++ < 10) { out.unshift(c.name + (c.code ? ' ' + c.code : '')); c = c.parent_id && byId.get(c.parent_id); } return out.join(' › '); };
    const leaves = spaces.filter(x => !hasKids.has(x.id)), groups = spaces.filter(x => hasKids.has(x.id));
    let mode = 'zone', draft = [];
    const target = h('select', { 'aria-label': 'Zona de' },
      groups.length ? h('optgroup', { label: 'Edificios, niveles y grupos' }, groups.map(x => h('option', { value: x.id }, path(x)))) : null,
      h('optgroup', { label: 'Unidades y espacios' }, leaves.map(x => h('option', { value: x.id }, path(x)))));
    const firstFree = () => { const z = new Set(work.regions.map(r => r.space)); const f = leaves.find(x => !z.has(x.id)) || groups.find(x => !z.has(x.id)); if (f) target.value = f.id; };
    firstFree();
    const sceneSel = h('select', { 'aria-label': 'Escena' }, scenes.filter(x => x.pano_url).map(x => h('option', { value: x.id }, x.name)));
    const kindSel = h('select', { 'aria-label': 'Tipo de vista' }, [['render', 'Render o vista del conjunto'], ['plano', 'Plano o planta']].map(([k, t]) => h('option', { value: k, selected: (v.kind || 'render') === k }, t)));
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'pn-vsvg');
    const dots = h('div', { class: 'pn-vdots' });
    const stage = h('div', { class: 'pn-vstage', style: { aspectRatio: v.w && v.h ? `${v.w} / ${v.h}` : '16 / 9' } }, h('img', { src: v.image, alt: '' }), svg, dots);
    const zoneList = h('ul', { class: 'ag-list pn-zlist' }), spotList = h('ul', { class: 'ag-list pn-zlist' });
    const coverage = h('p', { class: 'pn-muted' });
    const closeBtn = h('button', { type: 'button', class: 'ag-btn primary', onclick: () => closeDraft() }, 'Cerrar zona');
    const undoBtn = h('button', { type: 'button', class: 'ag-btn', onclick: () => { draft.pop(); paint(); } }, 'Deshacer punto');
    const cancelBtn = h('button', { type: 'button', class: 'ag-btn', onclick: () => { draft = []; paint(); } }, 'Empezar de nuevo');
    const zoneTools = h('div', { class: 'pn-inline' }, field('Zona de', target), closeBtn, undoBtn, cancelBtn);
    const spotTools = h('div', { class: 'pn-inline', hidden: true }, field('Escena 360°', sceneSel), h('span', { class: 'pn-muted' }, 'Toca el plano donde está esa escena.'));
    const modeBtns = [['zone', 'Dibujar zonas'], ['spot', 'Colocar escenas 360°']].map(([k, t]) => h('button', { type: 'button', class: 'ag-btn', 'aria-pressed': String(k === mode), onclick: () => {
      mode = k; draft = []; modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === mode))); zoneTools.hidden = mode !== 'zone'; spotTools.hidden = mode !== 'spot'; paint();
    }, 'data-m': k }, t));
    const pct = e => { const r = stage.getBoundingClientRect(); return [Math.round(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)) * 100) / 100,
                                                                     Math.round(Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100)) * 100) / 100]; };
    stage.addEventListener('click', e => {
      if (e.target.closest('.pn-vspot')) return;
      const p = pct(e);
      if (mode === 'zone') {
        if (draft.length >= 3 && Math.abs(p[0] - draft[0][0]) < 1.5 && Math.abs(p[1] - draft[0][1]) < 2.5) return closeDraft();
        draft.push(p);
      } else {
        if (!sceneSel.value) return;
        work.spots = work.spots.filter(sp => sp.scene !== sceneSel.value);
        work.spots.push({ scene: sceneSel.value, x: p[0], y: p[1] });
        const opts = [...sceneSel.options]; const next = opts.find(o => !work.spots.some(sp => sp.scene === o.value)); if (next) sceneSel.value = next.value;
      }
      paint();
    });
    stage.addEventListener('dblclick', e => { e.preventDefault(); if (mode === 'zone' && draft.length >= 3) closeDraft(); });
    function closeDraft() {
      if (draft.length < 3) return;
      work.regions = work.regions.filter(r => r.space !== target.value);
      work.regions.push({ space: target.value, points: draft });
      draft = []; firstFree(); paint();
    }
    function paint() {
      const els = [];
      for (const r of work.regions) {
        const pg = document.createElementNS(svgNS, 'polygon');
        pg.setAttribute('points', r.points.map(p => p.join(',')).join(' '));
        pg.setAttribute('class', 'pn-zone' + (r.space === target.value ? ' is-current' : ''));
        const t = document.createElementNS(svgNS, 'title'); t.textContent = byId.has(r.space) ? path(byId.get(r.space)) : 'Espacio eliminado'; pg.append(t);
        els.push(pg);
      }
      if (draft.length) {
        const pl = document.createElementNS(svgNS, 'polyline');
        pl.setAttribute('points', draft.map(p => p.join(',')).join(' ')); pl.setAttribute('class', 'pn-draft'); els.push(pl);
      }
      svg.replaceChildren(...els);
      put(dots, draft.map((p, i) => h('span', { class: 'pn-vpt' + (i === 0 ? ' is-first' : ''), style: { left: p[0] + '%', top: p[1] + '%' } })),
        work.spots.map(sp => { const sc = scenes.find(x => x.id === sp.scene); return h('span', { class: 'pn-vspot', title: sc ? sc.name : 'Escena eliminada', style: { left: sp.x + '%', top: sp.y + '%' } }); }));
      closeBtn.disabled = draft.length < 3; undoBtn.disabled = !draft.length; cancelBtn.disabled = !draft.length;
      put(zoneList, work.regions.map((r, i) => h('li', null, h('span', { class: 'pn-grow' }, byId.has(r.space) ? path(byId.get(r.space)) : h('span', { class: 'ag-error' }, 'Espacio eliminado')),
        h('button', { type: 'button', class: 'ag-btn', onclick: () => { target.value = r.space; draft = r.points.slice(); work.regions.splice(i, 1); mode === 'zone' || modeBtns[0].click(); paint(); } }, 'Redibujar'),
        h('button', { type: 'button', class: 'ag-btn danger', 'aria-label': 'Quitar zona', onclick: () => { work.regions.splice(i, 1); paint(); } }, icon('trash')))));
      put(spotList, work.spots.map((sp, i) => { const sc = scenes.find(x => x.id === sp.scene); return h('li', null, h('span', { class: 'pn-grow' }, sc ? sc.name : h('span', { class: 'ag-error' }, 'Escena eliminada')),
        h('button', { type: 'button', class: 'ag-btn danger', 'aria-label': 'Quitar punto', onclick: () => { work.spots.splice(i, 1); paint(); } }, icon('trash'))); }));
      const zoned = new Set(work.regions.map(r => r.space));
      coverage.textContent = `${leaves.filter(x => zoned.has(x.id)).length} de ${leaves.length} unidades o espacios tienen zona en esta vista. ${work.spots.length} escenas ubicadas.`;
    }
    target.addEventListener('change', paint);
    paint();
    const m = modal({ title: `Zonas: ${v.title || 'vista'}`, wide: true, dismissable: false,
      body: [h('div', { class: 'pn-inline' }, modeBtns, field('Tipo', kindSel)),
             h('p', { class: 'pn-muted' }, 'Toca el contorno punto por punto; cierra tocando el primer punto, con doble clic o con «Cerrar zona». Cada unidad tiene una zona por vista.'),
             zoneTools, spotTools, stage, coverage,
             h('div', { class: 'pn-grid' }, h('div', null, h('h3', { class: 'pn-h3' }, 'Zonas'), zoneList), h('div', null, h('h3', { class: 'pn-h3' }, 'Escenas 360°'), spotList))],
      actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Listo y guardar', primary: true, onClick: () => {
        if (draft.length >= 3 && confirm('Hay una zona sin cerrar. ¿Cerrarla?')) closeDraft();
        v.regions = work.regions; v.spots = work.spots; v.kind = kindSel.value;
        m.close(); onDone();
      } }] });
    m.el.classList.add('pn-vmodal');
  }

  // ═════════════════════════════ catálogo ═════════════════════════════
  async function tabCatalog(body) {
    const [spaces, scenes] = await Promise.all([
      cloud.select('spaces', `project_id=eq.${S.projectId}&select=*&order=position.asc,name.asc`),
      cloud.select('scenes', `project_id=eq.${S.projectId}&select=id,name,position&order=position.asc`)]);
    const byParent = new Map();
    spaces.forEach(s => { const k = s.parent_id || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(s); });
    const rows = [];
    (function walk(pid, depth) { for (const s of byParent.get(pid) || []) { rows.push([s, depth]); if (depth < 8) walk(s.id, depth + 1); } })('', 0);
    const money = (v, c) => v == null ? '' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: c || 'MXN', maximumFractionDigits: 0 }).format(v);
    const table = h('table', { class: 'pn-table' },
      h('thead', null, h('tr', null, ['Nombre', 'Tipo', 'm²', 'Precio', 'Estado', ''].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.map(([s, d]) => h('tr', null,
        h('th', { scope: 'row', style: { paddingLeft: `${8 + d * 18}px` } }, s.name, s.code ? h('span', { class: 'pn-muted' }, ` ${s.code}`) : null),
        h('td', null, SPACE_KIND[s.kind]),
        h('td', { class: 'num' }, s.area_m2 != null ? Number(s.area_m2).toLocaleString('es-MX') : ''),
        h('td', { class: 'num' }, money(s.price, s.currency), s.price != null && !s.show_price ? h('span', { class: 'ag-pill', title: 'No se muestra al público' }, 'oculto') : null),
        h('td', null, s.availability !== 'no_aplica' ? h('span', { class: 'ag-pill ' + ({ disponible: 'ok', apartada: 'warn', vendida: 'bad' }[s.availability] || '') }, AVAIL[s.availability]) : ''),
        h('td', { class: 'pn-row-act' }, canEdit() ? [
          h('button', { type: 'button', class: 'ag-btn', onclick: () => editSpace(s) }, 'Editar'),
          h('button', { type: 'button', class: 'ag-btn', 'aria-label': `Agregar dentro de ${s.name}`, title: 'Agregar dentro', onclick: () => editSpace({ parent_id: s.id, kind: childKind(s.kind) }) }, icon('plus'))] : null)))));
    function childKind(k) { return { conjunto: 'edificio', edificio: 'nivel', nivel: 'unidad', producto: 'variante' }[k] || 'espacio'; }

    function editSpace(s) {
      const isNew = !s.id;
      const v = Object.assign({ kind: 'unidad', name: '', code: '', summary: '', currency: 'MXN', availability: 'no_aplica', show_price: false, scene_ids: [], position: spaces.length }, s);
      const F = {
        kind: h('select', null, Object.entries(SPACE_KIND).map(([k, t]) => h('option', { value: k, selected: v.kind === k }, t))),
        parent: h('select', null, h('option', { value: '' }, 'Ninguno (nivel superior)'),
          spaces.filter(x => x.id !== v.id).map(x => h('option', { value: x.id, selected: x.id === v.parent_id }, `${x.name}${x.code ? ' ' + x.code : ''}`))),
        name: input({ value: v.name, maxlength: 120, required: true }), code: input({ value: v.code, maxlength: 40 }),
        area: input({ type: 'number', step: '0.01', min: 0, value: v.area_m2 ?? '' }),
        bed: input({ type: 'number', min: 0, max: 50, value: v.bedrooms ?? '' }), bath: input({ type: 'number', step: '0.5', min: 0, max: 50, value: v.bathrooms ?? '' }),
        park: input({ type: 'number', min: 0, max: 50, value: v.parking ?? '' }),
        price: input({ type: 'number', min: 0, step: '1', value: v.price ?? '' }), currency: input({ value: v.currency, maxlength: 3 }),
        show: h('input', { type: 'checkbox', checked: v.show_price }),
        avail: h('select', null, Object.entries(AVAIL).map(([k, t]) => h('option', { value: k, selected: v.availability === k }, t))),
        summary: h('textarea', { rows: 3, maxlength: 2000 }, v.summary),
        plan: input({ type: 'url', value: v.plan_url || '', placeholder: 'https://…' }),
        scenes: h('fieldset', { class: 'pn-checks' }, h('legend', null, 'Escenas 360° de este espacio'),
          scenes.length ? scenes.map(sc => h('label', { class: 'ag-check' }, h('input', { type: 'checkbox', value: sc.id, checked: (v.scene_ids || []).includes(sc.id) }), sc.name))
            : h('p', { class: 'pn-muted' }, 'El proyecto no tiene escenas todavía.'))
      };
      const num = el => el.value === '' ? null : Number(el.value);
      const err = h('p', { class: 'ag-error', role: 'alert' });
      const m = modal({ title: isNew ? 'Nuevo espacio' : `Editar ${v.name}`, wide: true,
        body: [h('div', { class: 'pn-grid' }, field('Tipo', F.kind), field('Dentro de', F.parent), field('Nombre', F.name), field('Clave', F.code, 'Ej. A-101')),
          h('div', { class: 'pn-grid pn-grid-4' }, field('m²', F.area), field('Recámaras', F.bed), field('Baños', F.bath), field('Estac.', F.park)),
          h('div', { class: 'pn-grid pn-grid-4' }, field('Precio', F.price), field('Moneda', F.currency), field('Estado', F.avail),
            h('label', { class: 'ag-check pn-check-mid' }, F.show, 'Mostrar precio al público')),
          field('Descripción', F.summary), field('Plano (URL https)', F.plan), F.scenes, err],
        actions: [
          !isNew && isOwner() ? { label: 'Eliminar', danger: true, onClick: async () => {
            if (!confirm(`¿Eliminar ${v.name} y todo lo que contiene?`)) return;
            try { await cloud.remove('spaces', `id=eq.${v.id}`); m.close(); notify('Eliminado'); tabCatalog(body); } catch (e) { err.textContent = e.message; }
          } } : null,
          { label: 'Cancelar', onClick: () => m.close() },
          { label: 'Guardar', primary: true, onClick: async () => {
            err.textContent = '';
            if (!F.name.value.trim()) { err.textContent = 'Escribe un nombre'; return; }
            if (F.plan.value && !/^https:\/\//.test(F.plan.value)) { err.textContent = 'El plano debe ser una URL https'; return; }
            const row = { project_id: S.projectId, parent_id: F.parent.value || null, kind: F.kind.value, name: F.name.value.trim(), code: F.code.value.trim(),
              area_m2: num(F.area), bedrooms: num(F.bed), bathrooms: num(F.bath), parking: num(F.park), price: num(F.price),
              currency: (F.currency.value || 'MXN').toUpperCase(), show_price: F.show.checked, availability: F.avail.value,
              summary: F.summary.value.trim(), plan_url: F.plan.value.trim() || null,
              scene_ids: [...F.scenes.querySelectorAll('input:checked')].map(x => x.value) };
            m.setBusy(true, 'Guardando…');
            try {
              if (isNew) await cloud.insert('spaces', Object.assign(row, { position: spaces.length }));
              else await cloud.update('spaces', `id=eq.${v.id}`, row);
              m.close(); notify('Guardado'); tabCatalog(body);
            } catch (e) { err.textContent = e.message; m.setBusy(false); m.setActions([{ label: 'Cerrar', onClick: () => m.close() }]); }
          } }].filter(Boolean) });
    }

    function importCSV() {
      const fi = h('input', { type: 'file', accept: '.csv,text/csv' });
      const err = h('p', { class: 'ag-error', role: 'alert' });
      const m = modal({ title: 'Importar unidades desde CSV', wide: true,
        body: [h('p', null, 'Columnas reconocidas: grupo (torre o edificio), nombre, clave, m2, recamaras, banos, estacionamientos, precio, mostrar_precio (si/no), estado (disponible, apartada, vendida).'),
               h('p', null, 'Los grupos que no existan se crean. Las unidades con la misma clave se actualizan.'), fi, err],
        actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Importar', primary: true, onClick: async () => {
          const file = fi.files[0]; if (!file) { err.textContent = 'Elige un archivo'; return; }
          const rows = AgelFourD.parseCSV(await file.text());
          if (rows.length < 2) { err.textContent = 'El archivo no tiene filas'; return; }
          const n = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
          const head = rows[0].map(n);
          const col = (...names) => head.findIndex(x => names.includes(x));
          const c = { grupo: col('grupo', 'torre', 'edificio'), nombre: col('nombre', 'unidad', 'name'), clave: col('clave', 'codigo', 'code'),
                      m2: col('m2', 'area', 'superficie'), rec: col('recamaras', 'habitaciones'), ban: col('banos'), est: col('estacionamientos', 'cajones'),
                      precio: col('precio', 'price'), mostrar: col('mostrar_precio', 'mostrar precio'), estado: col('estado', 'disponibilidad') };
          if (c.nombre < 0 && c.clave < 0) { err.textContent = 'Falta la columna nombre o clave'; return; }
          m.setBusy(true, 'Importando…');
          const groups = new Map(spaces.filter(s => !s.parent_id).map(s => [n(s.name), s.id]));
          const byCode = new Map(spaces.filter(s => s.code).map(s => [n(s.code), s]));
          const val = (r, i) => i >= 0 ? String(r[i] || '').trim() : '';
          const numv = (r, i) => { const x = val(r, i).replace(/[$,\s]/g, ''); return x === '' || isNaN(+x) ? null : +x; };
          let created = 0, updated = 0; const problems = [];
          for (const [i, r] of rows.slice(1).entries()) {
            try {
              let parent = null; const g = val(r, c.grupo);
              if (g) {
                parent = groups.get(n(g));
                if (!parent) { const [x] = await cloud.insert('spaces', { project_id: S.projectId, kind: 'edificio', name: g.slice(0, 120), position: groups.size }); parent = x.id; groups.set(n(g), parent); }
              }
              const st = n(val(r, c.estado));
              const row = { project_id: S.projectId, parent_id: parent, kind: 'unidad', name: (val(r, c.nombre) || val(r, c.clave)).slice(0, 120), code: val(r, c.clave).slice(0, 40),
                area_m2: numv(r, c.m2), bedrooms: numv(r, c.rec), bathrooms: numv(r, c.ban), parking: numv(r, c.est), price: numv(r, c.precio),
                show_price: /^(si|sí|yes|1|true|x)$/i.test(val(r, c.mostrar)),
                availability: ['disponible', 'apartada', 'vendida'].includes(st) ? st : (st ? 'no_aplica' : 'disponible') };
              const ex = row.code && byCode.get(n(row.code));
              if (ex) { await cloud.update('spaces', `id=eq.${ex.id}`, row); updated++; }
              else { await cloud.insert('spaces', Object.assign(row, { position: spaces.length + i })); created++; }
            } catch (e) { problems.push(`Fila ${i + 2}: ${e.message}`); }
          }
          m.close();
          modal({ title: 'Importación terminada', body: [h('p', null, `${created} creadas, ${updated} actualizadas.`),
            problems.length ? h('ul', { class: 'ag-list' }, problems.slice(0, 20).map(p => h('li', null, p))) : null],
            actions: [{ label: 'Cerrar', primary: true, onClick: x => x.close() }] });
          tabCatalog(body);
        } }] });
    }
    put(body,
      h('div', { class: 'pn-toolbar' },
        h('p', { class: 'pn-muted' }, `${spaces.length} espacios. El precio solo se publica si marcas «Mostrar precio».`),
        canEdit() ? h('span', null,
          h('button', { type: 'button', class: 'ag-btn', onclick: importCSV }, icon('file-import'), 'Importar CSV'),
          h('button', { type: 'button', class: 'ag-btn primary', onclick: () => editSpace({}) }, icon('plus'), 'Nuevo espacio')) : null),
      rows.length ? h('div', { class: 'pn-table-wrap' }, table) : h('p', { class: 'pn-empty' }, 'Aún no hay espacios. Agrega torres, niveles y unidades, o importa un CSV.'));
  }

  // ═════════════════════════════ publicaciones ═════════════════════════════
  async function tabPublications(body) {
    const pubs = await cloud.select('publications', `project_id=eq.${S.projectId}&select=*&order=created_at.asc`);
    const versions = pubs.length ? await cloud.select('publication_versions',
      `publication_id=in.(${pubs.map(p => p.id).join(',')})&select=id,publication_id,version,note,created_at,approved_at&order=version.desc`) : [];
    const legacy = pubs.length ? await cloud.select('legacy_links', `publication_id=in.(${pubs.map(p => p.id).join(',')})&select=*`).catch(() => []) : [];
    const stats = {};
    await Promise.all(pubs.filter(p => p.status === 'published').map(async p => { try { stats[p.id] = await cloud.rpc('publication_stats', { p_publication: p.id, p_days: 30 }); } catch (_) {} }));
    const reload = () => tabPublications(body);
    const act = (label, fn, opts = {}) => h('button', { type: 'button', class: 'ag-btn' + (opts.primary ? ' primary' : '') + (opts.danger ? ' danger' : ''),
      onclick: async e => { if (opts.confirm && !confirm(opts.confirm)) return; busy(e.currentTarget, true); try { await fn(); notify(opts.done || 'Listo'); reload(); } catch (ex) { fail(ex); busy(e.currentTarget, false); } } }, label);

    const cards = pubs.map(p => {
      const vs = versions.filter(v => v.publication_id === p.id);
      const [stLabel, stCls] = PUB_STATUS[p.status];
      const st = stats[p.id] || {};
      const link = p.kind !== 'bim' ? publicLink(p) : null;
      const current = vs.find(v => v.id === p.current_version_id);
      return h('article', { class: 'pn-card' },
        h('header', null,
          h('h2', null, p.title || p.slug),
          h('span', { class: 'ag-pill' }, p.kind === 'showroom' ? 'Showroom' : p.kind === 'visor' ? 'Recorrido' : 'BIM'),
          h('span', { class: 'ag-pill ' + stCls }, stLabel),
          p.audience === 'link' ? h('span', { class: 'ag-pill', title: 'No aparece en buscadores ni en el sitemap' }, 'Solo con enlace') : null),
        link ? h('div', { class: 'pn-link' }, h('code', { class: 'ag-code' }, link),
          h('button', { type: 'button', class: 'ag-btn', onclick: () => copy(link) }, icon('copy'), 'Copiar'),
          p.status === 'published' ? h('a', { class: 'ag-btn', href: link, target: '_blank', rel: 'noopener' }, icon('external-link'), 'Abrir') : null) : null,
        p.status === 'published' ? h('dl', { class: 'pn-stats' },
          [['Visitas', st.page_view], ['Recorridos', st.tour_open], ['Fichas vistas', st.unit_view], ['Contactos', st.lead_submitted], ['Errores de carga', st.load_error]]
            .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, String(v || 0)))), h('div', { class: 'pn-muted' }, 'últimos 30 días')) : null,
        h('div', { class: 'pn-actions' },
          canEdit() && p.status !== 'archived' ? h('button', { type: 'button', class: 'ag-btn primary', onclick: e => preflight(p, e.currentTarget, reload) }, 'Crear versión con el contenido actual') : null,
          canEdit() && !isOwner() && p.status === 'draft' && vs.length ? act('Pedir revisión al propietario', () => cloud.rpc('request_review', { p_publication: p.id }), { done: 'Se pidió revisión' }) : null,
          canEdit() ? act(p.audience === 'link' ? 'Mostrar en buscadores' : 'Solo con enlace', () => cloud.update('publications', `id=eq.${p.id}`, { audience: p.audience === 'link' ? 'public' : 'link' })) : null,
          isOwner() && p.status !== 'archived' ? act('Archivar', () => cloud.rpc('archive_publication', { p_publication: p.id }), { danger: true, confirm: 'El enlace dejará de funcionar. ¿Archivar?' }) : null),
        vs.length ? h('table', { class: 'pn-table pn-versions' },
          h('thead', null, h('tr', null, ['Versión', 'Creada', 'Estado', ''].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, vs.map(v => h('tr', null,
            h('th', { scope: 'row' }, `v${v.version}`, v.note ? h('span', { class: 'pn-muted' }, ` ${v.note}`) : null),
            h('td', null, formatDate(v.created_at, true)),
            h('td', null, current && current.id === v.id ? h('span', { class: 'ag-pill ok' }, 'En línea') : v.approved_at ? 'Publicada antes' : 'Sin publicar'),
            h('td', { class: 'pn-row-act' },
              p.kind === 'showroom' ? [h('a', { class: 'ag-btn', href: `${ROOT}apps/showroom/?preview=${v.id}`, target: '_blank', rel: 'noopener' }, 'Vista previa'),
                h('button', { type: 'button', class: 'ag-btn', onclick: () => phonePreview(`${ROOT}apps/showroom/?preview=${v.id}`, `v${v.version}`) }, icon('device-mobile'), 'En celular')] : null,
              isOwner() && !(current && current.id === v.id) && p.status !== 'archived'
                ? (v.approved_at ? act('Volver a esta', () => cloud.rpc('rollback_publication', { p_publication: p.id, p_version: v.version }), { confirm: `¿Poner otra vez en línea la versión ${v.version}?` })
                                 : act('Publicar', () => cloud.rpc('publish_version', { p_version: v.id }), { primary: true, done: 'Publicada' })) : null))))) : h('p', { class: 'pn-muted' }, 'Sin versiones todavía.'),
        isOwner() && p.kind !== 'bim' ? legacyBox(p, legacy.filter(l => l.publication_id === p.id), reload) : null);
    });

    function newPub() {
      const kind = h('select', null, h('option', { value: 'showroom' }, 'Showroom (página comercial)'), h('option', { value: 'visor' }, 'Recorrido 360° (visor)'));
      const title = input({ value: S.project.name, maxlength: 160 });
      const slug = input({ value: AgelCloud.slugify(S.project.name), maxlength: 80 });
      const err = h('p', { class: 'ag-error', role: 'alert' });
      const m = modal({ title: 'Nueva publicación', body: [field('Qué publicar', kind), field('Título', title),
        field('Dirección', slug, 'Solo minúsculas, números y guiones. Será parte del enlace.'), err],
        actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Crear', primary: true, onClick: async () => {
          const s = AgelCloud.slugify(slug.value);
          if (s.length < 3) { err.textContent = 'La dirección necesita al menos 3 caracteres'; return; }
          m.setBusy(true, 'Creando…');
          try { await cloud.rpc('create_publication', { p_project: S.projectId, p_kind: kind.value, p_slug: s, p_title: title.value.trim() }); m.close(); reload(); }
          catch (e) { err.textContent = e.message; m.setBusy(false); m.setActions([{ label: 'Cerrar', onClick: () => m.close() }]); }
        } }] });
    }
    put(body,
      h('div', { class: 'pn-toolbar' },
        h('p', { class: 'pn-muted' }, 'Cada versión es una copia fija del contenido. El público ve solo la versión «En línea». Solo el propietario publica.'),
        canEdit() ? h('button', { type: 'button', class: 'ag-btn primary', onclick: newPub }, icon('plus'), 'Nueva publicación') : null),
      cards.length ? cards : h('p', { class: 'pn-empty' }, 'Este proyecto aún no tiene publicaciones.'));
  }

  // Vista previa en tamaño de teléfono (390 × 844), dentro del panel.
  function phonePreview(url, label) {
    const m = modal({ title: `Vista previa en celular (${label})`, wide: true,
      body: [h('div', { class: 'pn-phone' }, h('iframe', { src: url, title: 'Vista previa en celular', width: 390, height: 780 })),
             h('p', { class: 'pn-muted' }, 'Ancho de 390 px, como un iPhone 15. El formulario no envía en la vista previa.')],
      actions: [{ label: 'Cerrar', onClick: x => x.close() }] });
    m.el.classList.add('pn-phone-box');
  }

  // Revisión antes de publicar: lo que el público no vería o vería roto.
  async function preflight(pub, btn, reload) {
    busy(btn, true, 'Revisando…');
    const issues = [], notes = [];
    try {
      const [tree, spaces] = await Promise.all([
        cloud.rpc('load_project_tree', { p_project: S.projectId }),
        cloud.select('spaces', `project_id=eq.${S.projectId}&select=id,parent_id,name,code,price,show_price,availability,scene_ids,area_m2`)]);
      const sr = (tree.project && tree.project.showroom) || {};
      const withPano = new Set(tree.scenes.filter(s => s.pano_url).map(s => s.id));
      const nameOf = new Map(tree.scenes.map(s => [s.id, s.name]));
      const noPano = tree.scenes.filter(s => !s.pano_url);
      if (!withPano.size && pub.kind === 'visor') issues.push('No hay escenas con panorámica: el recorrido no se puede publicar.');
      if (noPano.length) notes.push(`${noPano.length} escena(s) sin panorámica no se publicarán: ${noPano.map(s => s.name).slice(0, 5).join(', ')}.`);
      const broken = [];
      tree.scenes.forEach(s => (s.hs || []).forEach(hs => {
        if (hs.type === 'scene' && (!hs.target_scene_id || !withPano.has(hs.target_scene_id))) broken.push(`${s.name} › ${hs.title || 'sin título'}`);
      }));
      if (broken.length) issues.push(`${broken.length} punto(s) de navegación sin destino válido; se quitarán del recorrido: ${broken.slice(0, 6).join('; ')}. Corrígelos en el editor.`);
      if (!tree.scenes.some(s => s.preview_url) && withPano.size) notes.push('La portada usará la panorámica completa: abre el proyecto en el editor con tu cuenta una vez para generar las versiones ligeras.');
      if (pub.kind === 'showroom') {
        const kids = new Set(spaces.filter(x => x.parent_id).map(x => x.parent_id));
        const leaves = spaces.filter(x => !kids.has(x.id));
        const tracks = leaves.some(l => l.availability !== 'no_aplica');
        const unknown = tracks ? leaves.filter(l => l.availability === 'no_aplica') : [];
        if (unknown.length) issues.push(`${unknown.length} unidad(es) sin estado se mostrarán como «Por confirmar»: ${unknown.slice(0, 5).map(l => l.name).join(', ')}.`);
        const hiddenPrice = leaves.filter(l => l.price != null && !l.show_price).length;
        if (hiddenPrice) notes.push(`${hiddenPrice} precio(s) capturados no se publican (no tienen «Mostrar precio»).`);
        const badScenes = leaves.filter(l => (l.scene_ids || []).some(id => !withPano.has(id)));
        if (badScenes.length) notes.push(`${badScenes.length} unidad(es) apuntan a escenas sin panorámica.`);
        const spaceIds = new Set(spaces.map(x => x.id));
        (sr.views || []).forEach(v => {
          const lostZ = (v.regions || []).filter(r => !spaceIds.has(r.space)).length, lostS = (v.spots || []).filter(sp => !withPano.has(sp.scene)).length;
          if (lostZ || lostS) issues.push(`Vista «${v.title}»: ${lostZ} zona(s) y ${lostS} punto(s) 360° apuntan a algo que ya no existe; no se mostrarán.`);
        });
        if (leaves.length > 1 && !(sr.views || []).length) notes.push('Sin vista para explorar: el público solo verá la lista. Agrega un render o planta con zonas en Showroom.');
        const c = sr.contact || {};
        if (!sr.notify_email && !sr.webhook) notes.push('Nadie recibirá avisos automáticos de prospectos (revisa Prospectos en el panel o configura un correo o webhook).');
        if (!c.whatsapp && !c.email) notes.push('No hay WhatsApp ni correo público de contacto; solo el formulario.');
        if (!(sr.seo || {}).title || !(sr.seo || {}).description) notes.push('Falta título o descripción para buscadores y redes.');
        void nameOf;
      }
    } catch (e) { busy(btn, false); return fail(e); }
    busy(btn, false);
    const create = async () => {
      busy(btn, true, 'Creando…');
      try { await cloud.rpc('create_publication_version', { p_publication: pub.id, p_note: '' }); notify('Versión creada. Revísala en Vista previa antes de publicarla.'); reload(); }
      catch (e) { fail(e); busy(btn, false); }
    };
    if (!issues.length && !notes.length) return create();
    const m = modal({ title: 'Revisión antes de crear la versión', wide: true,
      body: [issues.length ? [h('h3', { class: 'pn-h3' }, 'Conviene corregir'), h('ul', { class: 'ag-list pn-check-bad' }, issues.map(t => h('li', null, icon('alert-triangle'), t)))] : null,
             notes.length ? [h('h3', { class: 'pn-h3' }, 'Para tu información'), h('ul', { class: 'ag-list' }, notes.map(t => h('li', null, icon('info-circle'), t)))] : null,
             h('p', { class: 'pn-muted' }, 'La versión es una copia fija: lo que corrijas después requiere una versión nueva.')],
      actions: [{ label: 'Volver a corregir', onClick: x => x.close() }, { label: 'Crear versión de todos modos', primary: true, onClick: x => { x.close(); create(); } }] });
    void m;
  }

  function legacyBox(p, links, reload) {
    const id = input({ placeholder: 'id del enlace antiguo (lo que va después de id=)', 'aria-label': 'Id del enlace antiguo', maxlength: 120 });
    return h('details', { class: 'pn-legacy' },
      h('summary', null, `Enlaces antiguos que abren esta publicación (${links.length})`),
      h('p', { class: 'pn-muted' }, 'Los enlaces que ya compartiste con ?visor=1&id=… pueden abrir esta publicación en lugar del archivo viejo.'),
      links.length ? h('ul', { class: 'ag-list' }, links.map(l => h('li', null, h('code', null, l.legacy_id), h('span', { class: 'pn-grow' }),
        h('button', { type: 'button', class: 'ag-btn danger', onclick: async () => { try { await cloud.remove('legacy_links', `legacy_id=eq.${encodeURIComponent(l.legacy_id)}`); reload(); } catch (e) { fail(e); } } }, 'Quitar')))) : null,
      h('div', { class: 'pn-inline' }, id, h('button', { type: 'button', class: 'ag-btn', onclick: async () => {
        const v = id.value.trim().replace(/^.*[?&]id=/, '').replace(/[&#].*$/, '');
        if (!v) return;
        try { await cloud.rpc('map_legacy_link', { p_legacy_id: v, p_kind: 'visor', p_publication: p.id }); notify('Enlace antiguo conectado'); reload(); } catch (e) { fail(e); }
      } }, 'Conectar')));
  }

  // ═════════════════════════════ prospectos ═════════════════════════════
  async function tabLeads(body, filter) {
    filter = filter || '';
    const leads = await cloud.select('leads', `project_id=eq.${S.projectId}&select=*&order=created_at.desc&limit=1000${filter ? `&status=eq.${filter}` : ''}`);
    const statusSel = l => h('select', { 'aria-label': `Estado de ${l.name}`, onchange: async e => {
      try { await cloud.update('leads', `id=eq.${l.id}`, { status: e.target.value }); l.status = e.target.value; notify('Actualizado'); } catch (ex) { fail(ex); }
    } }, Object.entries(LEAD_STATUS).map(([k, v]) => h('option', { value: k, selected: l.status === k }, v)));
    const notes = l => h('button', { type: 'button', class: 'ag-btn', onclick: () => {
      const ta = h('textarea', { rows: 6, maxlength: 4000 }, l.notes || '');
      const m = modal({ title: `Notas sobre ${l.name}`, body: [h('p', null, l.message || 'Sin mensaje.'), field('Notas internas', ta)],
        actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Guardar', primary: true, onClick: async () => {
          try { await cloud.update('leads', `id=eq.${l.id}`, { notes: ta.value }); l.notes = ta.value; m.close(); notify('Guardado'); } catch (e) { fail(e); }
        } }] });
    } }, l.notes ? 'Notas' : 'Anotar');
    const src = l => [l.source && l.source.utm_source, l.source && l.source.utm_campaign].filter(Boolean).join(' / ') || (l.source && l.source.referrer) || 'directo';
    // CSV seguro: comillas y celdas que empiezan con = + - @ se neutralizan (no se ejecutan en Excel).
    const cell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const exportCSV = () => {
      const head = ['fecha', 'nombre', 'correo', 'telefono', 'unidad', 'seleccion', 'mensaje', 'estado', 'origen', 'campaña', 'notas'];
      const rows = leads.map(l => [l.created_at, l.name, l.email, l.phone, l.space_label, ((l.source || {}).seleccion || []).join(' | '), l.message, LEAD_STATUS[l.status], (l.source || {}).utm_source || (l.source || {}).referrer || '', (l.source || {}).utm_campaign || '', l.notes]);
      download(`prospectos-${AgelCloud.slugify(S.project.name)}.csv`, '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    };
    const filt = h('select', { 'aria-label': 'Filtrar por estado', onchange: e => tabLeads(body, e.target.value) },
      h('option', { value: '' }, 'Todos'), Object.entries(LEAD_STATUS).map(([k, v]) => h('option', { value: k, selected: filter === k }, v)));
    put(body,
      h('div', { class: 'pn-toolbar' }, h('p', { class: 'pn-muted' }, `${leads.length} prospectos. Solo propietario y editores los ven.`),
        h('span', null, filt, leads.length ? h('button', { type: 'button', class: 'ag-btn', onclick: exportCSV }, icon('file-spreadsheet'), 'Descargar CSV') : null)),
      leads.length ? h('div', { class: 'pn-table-wrap' }, h('table', { class: 'pn-table' },
        h('thead', null, h('tr', null, ['Fecha', 'Nombre', 'Contacto', 'Interés', 'Origen', 'Estado', ''].map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', null, leads.map(l => h('tr', null,
          h('td', null, formatDate(l.created_at, true)),
          h('th', { scope: 'row' }, l.name),
          h('td', null, h('a', { href: `mailto:${l.email}` }, l.email), l.phone ? h('div', { class: 'pn-muted' }, l.phone) : null),
          h('td', null, l.space_label || (((l.source || {}).seleccion || []).length ? '' : '—'),
            ((l.source || {}).seleccion || []).length ? h('div', { class: 'pn-muted' }, `Selección: ${l.source.seleccion.join(', ')}`) : null),
          h('td', null, src(l)),
          h('td', null, statusSel(l)),
          h('td', { class: 'pn-row-act' }, notes(l))))))) : h('p', { class: 'pn-empty' }, 'Todavía no llegan solicitudes desde el showroom.'));
  }

  // ═════════════════════════════ equipo ═════════════════════════════
  async function tabTeam(body) {
    const members = await cloud.rpc('list_project_members', { p_project: S.projectId });
    const me = cloud.user && cloud.user.id;
    const roleSel = m => h('select', { 'aria-label': `Rol de ${m.email}`, disabled: !isOwner() || m.user_id === me, onchange: async e => {
      try { await cloud.update('project_members', `project_id=eq.${S.projectId}&user_id=eq.${m.user_id}`, { role: e.target.value }); notify('Rol actualizado'); }
      catch (ex) { fail(ex); tabTeam(body); }
    } }, Object.entries(ROLE).map(([k, v]) => h('option', { value: k, selected: m.role === k }, v)));
    const email = input({ type: 'email', placeholder: 'correo@ejemplo.mx', 'aria-label': 'Correo de la persona' });
    const newRole = h('select', { 'aria-label': 'Rol' }, ['editor', 'reviewer', 'viewer', 'owner'].map(k => h('option', { value: k }, ROLE[k])));
    put(body,
      h('dl', { class: 'pn-roles' },
        [['Propietario', 'Todo, incluido publicar, invitar y borrar.'], ['Editor', 'Edita escenas, showroom y catálogo; ve prospectos; no publica.'],
         ['Revisor', 'Ve todo y comenta incidencias en el modelo.'], ['Lector', 'Solo ve.']].map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
      h('ul', { class: 'ag-list pn-members' }, members.map(m => h('li', null,
        h('span', { class: 'pn-grow' }, m.email, m.user_id === me ? h('span', { class: 'pn-muted' }, ' (tú)') : null),
        roleSel(m),
        isOwner() && m.user_id !== me ? h('button', { type: 'button', class: 'ag-btn danger', onclick: async () => {
          if (!confirm(`¿Quitar a ${m.email} del proyecto?`)) return;
          try { await cloud.remove('project_members', `project_id=eq.${S.projectId}&user_id=eq.${m.user_id}`); tabTeam(body); } catch (e) { fail(e); }
        } }, 'Quitar') : null))),
      isOwner() ? h('form', { class: 'pn-inline', onsubmit: async e => {
        e.preventDefault();
        try { await cloud.rpc('add_project_member', { p_project: S.projectId, p_email: email.value.trim(), p_role: newRole.value }); notify('Agregado'); tabTeam(body); }
        catch (ex) { fail(ex); }
      } }, email, newRole, h('button', { type: 'submit', class: 'ag-btn primary' }, 'Agregar')) : null,
      isOwner() ? h('p', { class: 'pn-muted' }, 'La persona necesita una cuenta: créala en Supabase (Authentication → Users → Invite) y luego agrégala aquí.') : null);
  }

  // ═════════════════════════════ modelos y 4D ═════════════════════════════
  async function tabModels(body) {
    const models = await cloud.select('models', `project_id=eq.${S.projectId}&select=*&order=created_at.asc`);
    const vers = models.length ? await cloud.select('model_versions', `project_id=eq.${S.projectId}&select=*&order=version.desc`) : [];
    const tasks = await cloud.select('tasks', `project_id=eq.${S.projectId}&select=id,model_id&limit=20000`).catch(() => []);
    const reload = () => tabModels(body);
    const cards = models.map(m => {
      const vs = vers.filter(v => v.model_id === m.id);
      const nTasks = tasks.filter(t => t.model_id === m.id).length;
      return h('article', { class: 'pn-card' },
        h('header', null, h('h2', null, m.name), h('span', { class: 'ag-pill' }, m.kind === 'aps' ? 'Autodesk (NWD, RVT, IFC…)' : m.kind)),
        m.description ? h('p', { class: 'pn-muted' }, m.description) : null,
        vs.length ? h('table', { class: 'pn-table pn-versions' },
          h('thead', null, h('tr', null, ['Versión', 'Archivo', 'Estado', ''].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, vs.map(v => h('tr', null,
            h('th', { scope: 'row' }, `v${v.version}`, v.label ? h('span', { class: 'pn-muted' }, ` ${v.label}`) : null),
            h('td', null, v.source_name || '—', v.source_bytes ? h('span', { class: 'pn-muted' }, ` ${formatBytes(v.source_bytes)}`) : null),
            h('td', null, h('span', { class: 'ag-pill ' + MV_STATUS[v.status][1] }, MV_STATUS[v.status][0] + (v.status === 'translating' && v.progress ? ` ${v.progress}` : '')),
              v.status === 'failed' && v.messages && v.messages.length ? h('div', { class: 'ag-error' }, String(v.messages[0].message || v.messages[0]).slice(0, 200)) : null),
            h('td', { class: 'pn-row-act' },
              v.status === 'ready' ? h('a', { class: 'ag-btn primary', href: `${ROOT}apps/bim/?v=${v.id}` }, 'Abrir visor') : null,
              ['translating', 'uploading'].includes(v.status) ? h('button', { type: 'button', class: 'ag-btn', onclick: async e => {
                busy(e.currentTarget, true, 'Consultando…');
                try { await cloud.invoke('aps-status', { model_version_id: v.id }); reload(); } catch (ex) { fail(ex); busy(e.currentTarget, false); }
              } }, 'Actualizar estado') : null))))) : h('p', { class: 'pn-muted' }, 'Sin versiones. Sube el archivo exportado de Navisworks (NWD) u otro formato compatible.'),
        h('div', { class: 'pn-actions' },
          canEdit() ? h('button', { type: 'button', class: 'ag-btn primary', onclick: () => uploadVersion(m, reload) }, icon('upload'), 'Subir versión') : null,
          canEdit() ? h('button', { type: 'button', class: 'ag-btn', onclick: () => importSchedule(m, reload) }, icon('calendar'), nTasks ? `Calendario 4D (${nTasks} tareas)` : 'Importar calendario 4D') : null));
    });
    const newModel = () => {
      const name = input({ maxlength: 160, value: 'Modelo coordinado' }), desc = h('textarea', { rows: 2, maxlength: 2000 });
      const m = modal({ title: 'Nuevo modelo', body: [field('Nombre', name), field('Descripción', desc)],
        actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Crear', primary: true, onClick: async () => {
          try { await cloud.insert('models', { project_id: S.projectId, name: name.value.trim() || 'Modelo', description: desc.value.trim(), kind: 'aps' }); m.close(); reload(); }
          catch (e) { fail(e); }
        } }] });
    };
    put(body,
      h('div', { class: 'pn-toolbar' },
        h('p', { class: 'pn-muted' }, 'Los modelos se convierten con Autodesk Platform Services y se ven en el visor BIM. Requiere configurar las funciones de servidor (ver docs/PUBLICAR.md).'),
        canEdit() ? h('button', { type: 'button', class: 'ag-btn primary', onclick: newModel }, icon('plus'), 'Nuevo modelo') : null),
      cards.length ? cards : h('p', { class: 'pn-empty' }, 'Este proyecto aún no tiene modelos BIM.'));
  }

  // Subida directa a Autodesk (URLs firmadas) y conversión a SVF2.
  function uploadVersion(model, reload) {
    const fi = h('input', { type: 'file', accept: '.nwd,.nwc,.rvt,.ifc,.dwg,.fbx,.obj,.skp,.3dm,.zip' });
    const label = input({ maxlength: 160, placeholder: 'Ej. Coordinación semana 12' });
    const bar = h('progress', { max: 100, value: 0, hidden: true });
    const err = h('p', { class: 'ag-error', role: 'alert' });
    const m = modal({ title: `Subir versión de ${model.name}`, body: [field('Archivo', fi, 'Navisworks NWD recomendado. Máximo según tu plan de Autodesk.'), field('Etiqueta', label), bar, err],
      actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Subir y convertir', primary: true, onClick: async () => {
        const file = fi.files[0]; if (!file) { err.textContent = 'Elige un archivo'; return; }
        m.setBusy(true, 'Preparando…'); bar.hidden = false; err.textContent = '';
        try {
          const v = await cloud.rpc('create_model_version', { p_model: model.id, p_label: label.value.trim(), p_source_name: file.name, p_bytes: file.size });
          const up = await AgelBIMUpload.upload(cloud, v.id, file, pct => { bar.value = pct; });
          await cloud.invoke('aps-translate', { model_version_id: v.id, upload_key: up.upload_key });
          m.close(); notify('Archivo subido. La conversión tarda unos minutos.'); reload();
        } catch (e) { err.textContent = e.message; m.setBusy(false); m.setActions([{ label: 'Cerrar', onClick: () => { m.close(); reload(); } }]); }
      } }] });
  }

  function importSchedule(model, reload) {
    const fi = h('input', { type: 'file', accept: '.csv,.txt,.xml' });
    const preview = h('div');
    const err = h('p', { class: 'ag-error', role: 'alert' });
    let parsed = null;
    fi.addEventListener('change', async () => {
      err.textContent = ''; put(preview);
      const file = fi.files[0]; if (!file) return;
      parsed = AgelFourD.parseSchedule(await file.text(), file.name);
      const r = AgelFourD.range(parsed.tasks, 'planned');
      preview.append(h('p', null, `${parsed.tasks.length} tareas`, r.start ? `, del ${r.start} al ${r.end}` : '', parsed.order ? ` (fechas día/mes: ${parsed.order === 'dmy' ? 'sí' : 'no, mes/día'})` : ''),
        parsed.warnings.length ? h('ul', { class: 'ag-list' }, parsed.warnings.slice(0, 12).map(w => h('li', null, w))) : null,
        h('div', { class: 'pn-table-wrap' }, h('table', { class: 'pn-table' }, h('tbody', null, parsed.tasks.slice(0, 8).map(t =>
          h('tr', null, h('td', null, t.name), h('td', null, t.task_type), h('td', null, t.planned_start || '—'), h('td', null, t.planned_end || '—'), h('td', null, t.attached || '')))))));
    });
    const m = modal({ title: 'Calendario 4D', wide: true,
      body: [h('p', null, 'Importa el CSV que exporta Navisworks TimeLiner (Exportar → CSV) o un XML de Microsoft Project. Las tareas se vinculan a los elementos por nivel, zona o sistema cuando el nombre del conjunto asociado coincide.'),
             fi, preview, err],
      actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Importar', primary: true, onClick: async () => {
        if (!parsed || !parsed.tasks.length) { err.textContent = 'Elige un archivo con tareas'; return; }
        m.setBusy(true, 'Importando…');
        try {
          const res = await cloud.rpc('import_schedule', { p_project: S.projectId, p_model: model.id, p_tasks: parsed.tasks, p_replace: true });
          let linkInfo = '';
          const [last] = await cloud.select('model_versions', `model_id=eq.${model.id}&status=eq.ready&select=id&order=version.desc&limit=1`);
          if (last && parsed.tasks.some(t => t.attached)) {
            const els = await cloud.select('element_mappings', `model_version_id=eq.${last.id}&select=source_id,level,zone,system,phase&limit=200000`);
            const al = AgelFourD.autoLinks(parsed.tasks, els);
            if (al.links.length) { const r2 = await cloud.rpc('set_task_links', { p_project: S.projectId, p_model: model.id, p_links: al.links, p_replace: true }); linkInfo = ` ${r2.vinculos} vínculos con elementos.`; }
            if (al.missing.length) linkInfo += ` ${al.missing.length} tareas sin elementos coincidentes.`;
          }
          m.close();
          modal({ title: 'Calendario importado', body: [h('p', null, `${res.importadas} tareas importadas.${linkInfo}`),
            res.avisos && res.avisos.length ? h('ul', { class: 'ag-list' }, res.avisos.slice(0, 15).map(a => h('li', null, `${a.external_id || ''}: ${a.aviso}`))) : null],
            actions: [{ label: 'Cerrar', primary: true, onClick: x => x.close() }] });
          reload();
        } catch (e) { err.textContent = e.message; m.setBusy(false); m.setActions([{ label: 'Cerrar', onClick: () => m.close() }]); }
      } }] });
  }

  // ═════════════════════════════ actividad / exportar ═════════════════════════════
  const ACTION = { insert: 'creó', update: 'cambió', delete: 'eliminó' };
  const ENTITY = { projects: 'el proyecto', project_members: 'un miembro', spaces: 'un espacio', publications: 'una publicación',
                   publication_versions: 'una versión publicada', leads: 'un prospecto', models: 'un modelo', model_versions: 'una versión del modelo',
                   organizations: 'la organización', memberships: 'una membresía' };
  function auditList(rows, who) {
    if (!rows.length) return h('p', { class: 'pn-empty' }, 'Sin actividad registrada.');
    const me = cloud.user && cloud.user.id;
    const actor = id => id === me ? 'Tú' : (who && who[id]) || (id ? 'Otra persona' : 'El sistema');
    const what = r => {
      const d = r.detail || {};
      if (r.action === 'update') return ` (${Object.keys(d).slice(0, 4).join(', ')})`;
      return d.name ? `: ${d.name}` : d.slug ? `: ${d.slug}` : d.version ? ` v${d.version}` : d.space_label ? `: ${d.space_label}` : '';
    };
    return h('ul', { class: 'ag-list pn-audit' }, rows.map(r => h('li', null,
      h('span', { class: 'pn-muted' }, formatDate(r.at, true)),
      h('span', null, `${actor(r.actor)} ${ACTION[r.action] || r.action} ${ENTITY[r.entity] || r.entity}${what(r)}`))));
  }
  async function tabActivity(body) {
    const [rows, members] = await Promise.all([
      cloud.select('audit_log', `project_id=eq.${S.projectId}&select=*&order=at.desc&limit=200`),
      cloud.rpc('list_project_members', { p_project: S.projectId }).catch(() => [])]);
    const who = Object.fromEntries(members.map(m => [m.user_id, m.email]));
    put(body, h('p', { class: 'pn-muted' }, 'Últimos 200 cambios. Los datos personales de los prospectos no se guardan en la bitácora.'), auditList(rows, who));
  }
  async function tabExport(body) {
    const btn = h('button', { type: 'button', class: 'ag-btn primary', onclick: async () => {
      busy(btn, true, 'Preparando…');
      try { const data = await cloud.rpc('export_project', { p_project: S.projectId });
            download(`agelarq-${AgelCloud.slugify(S.project.name)}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json'); }
      catch (e) { fail(e); }
      busy(btn, false);
    } }, icon('download'), 'Descargar exportación');
    put(body, h('p', null, 'Descarga todo el proyecto en un archivo JSON: escenas, hotspots, catálogo, publicaciones con sus versiones, modelos, vistas e incidencias.',
      isOwner() || canEdit() ? ' Incluye prospectos.' : ' No incluye prospectos (requiere ser editor).'),
      h('p', { class: 'pn-muted' }, 'Las imágenes y modelos se referencian por su dirección; no se incluyen dentro del archivo.'), btn);
  }

  // ═════════════════════════════ organización ═════════════════════════════
  async function orgBrand(body, org) {
    const [o] = await cloud.select('organizations', `id=eq.${org.id}&select=id,name,branding`);
    const b = o.branding || {};
    const F = { name: input({ value: o.name, maxlength: 120 }), brand: input({ value: b.name || '', maxlength: 120 }),
      logo: input({ type: 'url', value: b.logo_url || '', placeholder: 'https://…' }),
      accent: h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : '#B89D74' }),
      website: input({ type: 'url', value: b.website || '', placeholder: 'https://…' }),
      whatsapp: input({ type: 'tel', value: b.whatsapp || '' }), email: input({ type: 'email', value: b.email || '' }) };
    const sample = h('div', { class: 'pn-swatch' });
    const contrast = () => { const ink = readableOn(F.accent.value); sample.style.background = F.accent.value; sample.style.color = ink; sample.textContent = `Botón de ejemplo (texto ${ink === '#FFFFFF' ? 'blanco' : 'oscuro'})`; };
    F.accent.addEventListener('input', contrast); contrast();
    const err = h('p', { class: 'ag-error', role: 'alert' });
    const save = h('button', { type: 'submit', class: 'ag-btn primary', disabled: !isOrgAdmin() }, 'Guardar');
    const firstProject = S.access.projects.find(p => p.org_id === org.id && ['owner', 'editor'].includes(p.role));
    const logoUp = firstProject ? (() => {
      const fi = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', hidden: true });
      const btn = h('button', { type: 'button', class: 'ag-btn', onclick: () => fi.click() }, icon('upload'), 'Subir logo');
      fi.addEventListener('change', async () => {
        const file = fi.files[0]; if (!file) return;
        if (file.type === 'image/svg+xml') { err.textContent = 'Por seguridad usa PNG, JPG o WebP para el logo.'; return; }
        busy(btn, true, 'Subiendo…');
        try { const r = await cloud.upload(firstProject.id, file, { kind: 'image' }); F.logo.value = r.url; } catch (e) { fail(e); }
        busy(btn, false);
      });
      return h('span', null, btn, fi, h('span', { class: 'pn-muted' }, ` Se guarda en el espacio de «${firstProject.name}».`));
    })() : null;
    put(body, h('form', { class: 'pn-form', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      for (const [k, l] of [['logo', 'El logo'], ['website', 'El sitio']]) if (F[k].value && !/^https:\/\//.test(F[k].value)) { err.textContent = `${l} debe empezar con https://`; return; }
      const branding = { name: F.brand.value.trim(), accent: F.accent.value.toUpperCase(), whatsapp: F.whatsapp.value.replace(/[^\d]/g, ''), email: F.email.value.trim() };
      if (F.logo.value.trim()) branding.logo_url = F.logo.value.trim();
      if (F.website.value.trim()) branding.website = F.website.value.trim();
      busy(save, true, 'Guardando…');
      try { await cloud.update('organizations', `id=eq.${org.id}`, { name: F.name.value.trim() || o.name, branding }); notify('Guardado. Se aplica en las próximas versiones publicadas.'); }
      catch (ex) { err.textContent = ex.message; }
      busy(save, false);
    } },
      !isOrgAdmin() ? h('div', { class: 'pn-note' }, icon('lock'), 'Solo propietarios y administradores de la organización cambian la marca.') : null,
      h('fieldset', null, h('legend', null, 'Marca en showroom y recorridos'),
        h('div', { class: 'pn-grid' }, field('Nombre de la organización', F.name), field('Nombre comercial (se muestra)', F.brand)),
        field('Logo (URL https)', F.logo), logoUp,
        h('div', { class: 'pn-grid' }, field('Color de acento', F.accent, 'El color del texto encima se elige solo para que se lea.'), sample),
        h('div', { class: 'pn-grid' }, field('Sitio web', F.website), field('WhatsApp', F.whatsapp), field('Correo', F.email))),
      err, h('div', { class: 'pn-actions' }, save)));
  }

  async function orgUsage(body, org) {
    const u = await cloud.rpc('org_usage', { p_org: org.id });
    const pct = u.cuota_bytes ? Math.min(100, Math.round(u.bytes_usados / u.cuota_bytes * 100)) : 0;
    put(body,
      h('div', { class: 'pn-usage' },
        h('p', null, h('strong', null, formatBytes(u.bytes_usados)), ` de ${formatBytes(u.cuota_bytes)} usados (${pct}%)`),
        h('progress', { max: 100, value: pct, 'aria-label': 'Espacio usado' }),
        pct >= 80 ? h('p', { class: 'ag-error' }, 'Te acercas al límite. Borra archivos que no uses o pide ampliar la cuota.') : null),
      h('dl', { class: 'pn-stats' }, [['Proyectos', u.proyectos], ['Publicaciones en línea', u.publicaciones], ['Prospectos (30 días)', u.prospectos_30d], ['Modelos BIM', u.modelos]]
        .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, String(v))))),
      h('div', { class: 'pn-note' }, icon('alert-triangle'),
        'La cuota de AgelArq es interna. Supabase tiene además sus propios límites por plan (almacenamiento, transferencia y base de datos). ',
        'Si el panel de Supabase muestra «Grace period is over», el proyecto puede quedar en solo lectura hasta que bajes el uso o cambies de plan.'));
  }

  async function orgActivity(body, org) {
    if (!isOrgAdmin()) { put(body, h('p', { class: 'pn-empty' }, 'Solo propietarios y administradores ven la actividad de la organización.')); return; }
    const rows = await cloud.select('audit_log', `org_id=eq.${org.id}&select=*&order=at.desc&limit=200`);
    put(body, auditList(rows));
  }

  start();
})();
