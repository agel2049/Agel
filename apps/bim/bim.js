/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · visor BIM (plan maestro fases 4 y 5)

   apps/bim/?v=<versión del modelo>[&vp=<vista guardada>][&i=<incidencia>]
   Pestañas: Filtros · Propiedades · Vistas y 360° · Incidencias · 4D · Datos
   El visor de Autodesk se usa solo a través de AgelAPS (packages/bim/aps-adapter.js).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const { h, modal, field, formatDate, notify, icon } = AgelDOM;
  // Vacía y llena un elemento; acepta listas anidadas y omite null/false.
  const put = (el, ...kids) => { el.replaceChildren(); return AgelDOM.append(el, kids); };
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const advanced = params.get('tools') === 'advanced';
  const ROOT = '../../';
  const COLORS = { construyendo: '#3FA36B', demoliendo: '#D9534F', temporal: '#E0A526' };
  const STATE_LABEL = { oculto: 'Aún no existe', normal: 'Terminado', construyendo: 'En construcción', demoliendo: 'En demolición', temporal: 'Temporal' };
  const ISSUE_STATUS = { abierta: 'Abierta', en_proceso: 'En proceso', resuelta: 'Resuelta', cerrada: 'Cerrada' };
  const PRIORITY = { baja: 'Baja', media: 'Media', alta: 'Alta' };
  const FACETS = [['discipline', 'Disciplina'], ['system', 'Sistema'], ['level', 'Nivel'], ['phase', 'Etapa']];

  let cloud;
  try { cloud = AgelCloud.client(); } catch (e) { app.append(h('p', { class: 'bm-msg' }, 'Falta config.js.')); return; }
  const S = { v: null, model: null, versions: [], view: null, token: null, tab: 'filtros', filters: {}, preset:'complete', filterToken:0, renderToken:0, extMap: null, scenes: [] };
  const canEdit = () => S.v && S.v.can_edit;
  const canComment = () => S.v && ['owner', 'editor', 'reviewer'].includes(S.v.role);
  const fail = e => { console.warn(e); notify(e && e.message || 'Algo salió mal', 'error'); };
  const msg = (title, text, ...extra) => put(app, h('main', { class: 'bm-msg' }, h('h1', null, title), text ? h('p', null, text) : null, ...extra));

  // ── arranque ─────────────────────────────────────────────────────────
  async function boot() {
    const local=params.get('local');
    if(local){
      if(!/^[0-9a-f-]{36}$/i.test(local))return msg('Proyecto local inválido','Abre el GLB desde el panel.');
      try{return await AgelLocalGLB.mount(app,{cloud,projectId:local,returnUrl:params.get('return')});}
      catch(e){return msg('No se pudo abrir el GLB local',e.message,h('a',{class:'ag-btn',href:`${ROOT}apps/panel/`},'Ir al panel'));}
    }
    const id = params.get('v');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return msg('Falta la versión del modelo', 'Abre el visor desde el panel, en Modelos y 4D.', h('a', { class: 'ag-btn primary', href: ROOT + 'apps/panel/' }, 'Ir al panel'));
    if (!cloud.session) return msg('Inicia sesión', 'El visor BIM es privado para el equipo del proyecto.', h('a', { class: 'ag-btn primary', href: ROOT + 'apps/panel/' }, 'Entrar desde el panel'));
    msg('Cargando modelo…', '');
    try { S.v = await cloud.rpc('model_version_access', { p_version: id }); }
    catch (e) { return msg('No se pudo abrir', e.message); }
    if (!S.v) return msg('Sin acceso', 'Esta versión no existe o tu cuenta no está en el proyecto.');
    [[S.model], S.versions, S.scenes] = await Promise.all([
      cloud.select('models', `id=eq.${S.v.model_id}&select=id,name,project_id`),
      cloud.select('model_versions', `model_id=eq.${S.v.model_id}&select=id,version,label,status&order=version.desc`),
      cloud.select('scenes', `project_id=eq.${S.v.project_id}&select=id,name,pano_url&order=position.asc`).catch(() => [])]);
    if (S.v.status !== 'ready') return notReady();
    S.privateSettings=await cloud.rpc('load_workspace_settings',{p_project:S.v.project_id});
    layout();
    try {
      S.view = await AgelAPS.open(document.getElementById('bm-viewer'), { urn: S.v.aps_urn, getToken });
    } catch (e) {
      put(document.getElementById('bm-viewer'), h('div', { class: 'bm-msg' }, h('h1', null, 'No se pudo mostrar el modelo'), h('p', null, e.message)));
      return;
    }
    S.view.onSelect(ids => { if(advanced){if (S.tab === 'propiedades') renderTab(); else if (ids.length === 1) setTab('propiedades');} });
    await checkIndex();
    renderTab();
    if (advanced&&params.get('vp')) openViewpoint(params.get('vp'));
    if (advanced&&params.get('i')) openIssue(params.get('i'));
  }

  async function getToken() {
    if (S.token && S.token.exp - Date.now() > 90_000) return { access_token: S.token.access_token, expires_in: Math.floor((S.token.exp - Date.now()) / 1000) };
    const t = await cloud.invoke('aps-token', { model_version_id: S.v.id });
    S.token = { access_token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
    return t;
  }

  function notReady() {
    const label = { pending: 'La versión aún no tiene archivo.', uploading: 'El archivo se está subiendo.', translating: 'Autodesk está convirtiendo el modelo. Suele tardar de 2 a 20 minutos.', failed: 'La conversión falló.' }[S.v.status];
    const btn = h('button', { class: 'ag-btn primary', type: 'button', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Consultando…';
      try { const r = await cloud.invoke('aps-status', { model_version_id: S.v.id }); if (r.status === 'ready') location.reload(); else { notify(`Estado: ${r.status}${r.progress ? ' ' + r.progress : ''}`); } }
      catch (e) { fail(e); }
      btn.disabled = false; btn.textContent = 'Consultar de nuevo';
    } }, 'Consultar estado');
    msg('El modelo aún no está listo', label, ['translating', 'uploading'].includes(S.v.status) ? btn : null,
        h('a', { class: 'ag-btn', href: `${ROOT}apps/panel/#/p/${S.v.project_id}/modelos` }, 'Volver al panel'));
  }

  // ── estructura ───────────────────────────────────────────────────────
  const TABS = advanced?[['filtros', 'Filtros', 'filter'], ['propiedades', 'Propiedades', 'list-details'], ['vistas', 'Vistas y 360°', 'camera'],
                ['incidencias', 'Incidencias', 'message-report'], ['4d', '4D', 'calendar-time'], ['datos', 'Datos', 'database']]:[['filtros','Filtros','filter']];
  function layout() {
    const verSel = h('select', { 'aria-label': 'Versión del modelo', onchange: e => { location.search = `?v=${e.target.value}`; } },
      S.versions.filter(x => x.status === 'ready').map(x => h('option', { value: x.id, selected: x.id === S.v.id }, `v${x.version}${x.label ? ' ' + x.label : ''}`)));
    put(app,
      h('header', { class: 'bm-top' },
        AgelBimPresets.safeReturn(params.get('return'),location.href)?h('a',{class:'ag-btn',href:AgelBimPresets.safeReturn(params.get('return'),location.href)},'Volver al showroom'):null,
        h('a', { class: 'ag-btn', href: `${ROOT}apps/panel/#/p/${S.v.project_id}/modelos`, 'aria-label': 'Volver al panel' }, icon('arrow-left')),
        h('h1', null, S.model ? S.model.name : 'Modelo'), verSel, h('span', { class: 'bm-grow' }),
        h('span', { class: 'ag-pill' }, { owner: 'Propietario', editor: 'Editor', reviewer: 'Revisor', viewer: 'Lector' }[S.v.role] || S.v.role)),
      h('div', { class: 'bm-body' },
        h('aside', { class: 'bm-side' },
          h('nav', { class: 'bm-tabs'+(!advanced?' bm-tabs-simple':''), role: 'tablist', 'aria-label': 'Herramientas' }, TABS.map(([id, label, ic]) =>
            h('button', { type: 'button', role: 'tab', id: `t-${id}`, 'aria-selected': String(id === S.tab), 'aria-controls': 'bm-panel', onclick: () => setTab(id) }, icon(ic), h('span', null, label)))),
          h('div', { id: 'bm-banner' }),
          h('section', { id: 'bm-panel', class: 'bm-panel', role: 'tabpanel', 'aria-labelledby': `t-${S.tab}` })),
        h('div', { id: 'bm-viewer', class: 'bm-viewer' })));
  }
  function setTab(id) {
    S.tab = id;
    document.querySelectorAll('.bm-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.id === `t-${id}`)));
    document.getElementById('bm-panel').setAttribute('aria-labelledby', `t-${id}`);
    if (id !== '4d') stopPlayer();
    renderTab();
  }
  function renderTab() {
    const p = document.getElementById('bm-panel');
    if (!p) return;
    const fn = { filtros: tabFilters, propiedades: tabProps, vistas: tabViews, incidencias: tabIssues, '4d': tab4D, datos: tabData }[S.tab];
    const result=fn(p),token=S.renderToken;Promise.resolve(result).catch(e=>{if(token===S.renderToken)put(p,h('p',{class:'ag-error'},e.message));});
  }

  // ── índice de elementos ──────────────────────────────────────────────
  async function checkIndex() {
    const f = await cloud.rpc('model_facets', { p_version: S.v.id });
    S.facets = f;
    const b = document.getElementById('bm-banner');
    if (f && f.total) { put(b); return; }
    put(b, h('div', { class: 'bm-banner' }, icon('alert-triangle'),
      h('span', null, 'Los elementos de esta versión aún no están indexados: los filtros, el 4D y las incidencias por elemento los necesitan.'),
      canEdit() ? h('button', { class: 'ag-btn primary', type: 'button', onclick: () => indexElements() }, 'Indexar ahora') : h('span', null, ' Pide a un editor que lo haga.')));
  }

  async function externalIds() {
    if (!S.extMap) S.extMap = await S.view.externalIdMap();
    return S.extMap;
  }
  async function dbidsForSources(sourceIds) {
    const map = await externalIds();
    return sourceIds.map(s => map[s]).filter(x => x != null);
  }

  async function indexElements() {
    const bar = h('progress', { max: 100, value: 0 });
    const status = h('p', null, 'Leyendo propiedades del modelo…');
    const m = modal({ title: 'Indexar elementos', body: [status, bar], dismissable: false, actions: [] });
    try {
      const rules = await cloud.select('classification_rules', `project_id=eq.${S.v.project_id}&enabled=eq.true&select=*&order=position.asc`);
      const ids = S.view.allDbIds();
      const rows = [];
      for (let i = 0; i < ids.length; i += 2000) {
        const chunk = await S.view.bulk(ids.slice(i, i + 2000));
        for (const el of chunk) if (el.externalId) rows.push(AgelClassify.classify(el, rules));
        bar.value = Math.round((i + 2000) / ids.length * 50);
      }
      status.textContent = `Guardando ${rows.length} elementos…`;
      for (let i = 0; i < rows.length; i += 5000) {
        await cloud.rpc('upsert_element_mappings', { p_version: S.v.id, p_rows: rows.slice(i, i + 5000) });
        bar.value = 50 + Math.round((i + 5000) / Math.max(rows.length, 1) * 50);
      }
      const s = AgelClassify.summary(rows);
      m.close();
      modal({ title: 'Indexación terminada', body: [
        h('p', null, `${s.total} elementos. ${s.sin_clasificar} sin clasificar y ${s.sin_nivel} sin nivel.`),
        h('ul', { class: 'ag-list' }, Object.entries(s.por_disciplina).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('li', null, h('span', { class: 'bm-grow' }, k), String(v)))),
        s.sin_clasificar ? h('p', null, advanced?'Para clasificar el resto agrega reglas en la pestaña Datos y vuelve a indexar.':'Algunos elementos no tienen una disciplina reconocida. Se conservan visibles en Completo; exporta sus categorías y propiedades para filtrarlos.') : null],
        actions: [{ label: 'Cerrar', primary: true, onClick: x => x.close() }] });
      await checkIndex(); renderTab();
    } catch (e) { m.close(); fail(e); }
  }

  // ── filtros ──────────────────────────────────────────────────────────
  async function tabFilters(p) {
    const renderToken=++S.renderToken;
    const f = S.facets || {};
    const presets=h('div',{class:'pn-actions'},...[['complete','Completo'],['mep','MEP'],['masonry','Albañilería'],['structure','Estructura'],['finishes','Con acabados'],['grey','Obra gris']].map(([id,label])=>h('button',{class:'ag-btn',type:'button','aria-pressed':String(S.preset===id),onclick:()=>applyPreset(id)},label)));
    if (!f.total) { put(p,presets, h('p', { class: 'bm-muted' }, 'Indexa los elementos para filtrar por disciplina, sistema, nivel y etapa.')); return; }
    const active = Object.entries(S.filters);
    if(renderToken!==S.renderToken)return;
    put(p,presets,
      h('p', { class: 'bm-muted' }, `${f.total} elementos indexados${f.sin_clasificar ? `, ${f.sin_clasificar} sin clasificar` : ''}.`),
      active.length ? h('div', { class: 'bm-chips' }, active.map(([k, v]) => h('button', { type: 'button', class: 'ag-pill warn', onclick: () => { delete S.filters[k]; applyFilters(); } },
        `${FACETS.find(x => x[0] === k)[1]}: ${v}`, icon('x'))), h('button', { type: 'button', class: 'ag-btn link', onclick: () => { S.filters = {};S.preset='complete'; applyFilters(); } }, 'Ver todo')) : null,
      FACETS.map(([k, label]) => {
        const values = Object.entries(f[k] || {}).sort((a, b) => b[1] - a[1]);
        if (!values.length || (values.length === 1 && /^sin /.test(values[0][0]))) return null;
        return h('details', { class: 'bm-facet', open: k === 'discipline' || k in S.filters },
          h('summary', null, label),
          h('ul', null, values.map(([val, n]) => h('li', null, h('button', { type: 'button', 'aria-pressed': String(S.filters[k] === val), onclick: () => {
            if (S.filters[k] === val) delete S.filters[k]; else S.filters[k] = val; applyFilters();
          } }, h('span', null, val), h('small', null, String(n)))))));
      }));
  }
  async function indexedElements(query='',token=S.filterToken){
    const rows=[];let offset=0;
    while(true){if(token!==S.filterToken)return null;const batch=await cloud.select('element_mappings',`model_version_id=eq.${S.v.id}&${query}select=dbid,discipline,category,level&order=dbid.asc&limit=1000&offset=${offset}`);if(token!==S.filterToken)return null;rows.push(...batch);if(batch.length<1000)return rows;offset+=batch.length;if(offset>=200000)throw Error('El modelo supera el límite de elementos de esta vista');}
  }
  async function applyPreset(id){
    const token=++S.filterToken;
    if(id==='complete'){S.filters={};S.preset=id;S.view.showAll();S.view.fit();renderTab();return;}
    const preset=S.privateSettings?.presets?.[id]||AgelBimPresets.defaults[id];
    try{
     const rows=await indexedElements('',token);if(rows===null)return;
     const ids=AgelBimPresets.selectIds(rows,preset);if(ids===null){notify('Configura los elementos de esta vista','error');return;}
     S.filters={};S.preset=id;S.view.isolate(ids);if(ids.length)S.view.fit(ids);notify(`${ids.length} elementos`);renderTab();
    }catch(e){if(token===S.filterToken)fail(e);}
  }
  async function applyFilters() {
    const token=++S.filterToken,selectedPreset=S.preset;
    const q = Object.entries(S.filters).map(([k, v]) => /^sin (clasificar|nivel|etapa)$/.test(v) ? `${k}=eq.` : `${k}=eq.${encodeURIComponent(v)}`);
    if (!q.length&&S.preset==='complete') { S.view.showAll(); S.view.fit(); renderTab(); return; }
    try {
      const rows = await indexedElements(q.length?q.join('&')+'&':'',token);if(rows===null)return;
      const preset=selectedPreset==='complete'?{all:true}:S.privateSettings?.presets?.[selectedPreset]||AgelBimPresets.defaults[selectedPreset];
      const ids = AgelBimPresets.selectIds(rows,preset);if(ids===null)throw Error('Configura los elementos de esta vista');
      S.view.isolate(ids); if(ids.length)S.view.fit(ids);
      notify(`${ids.length} elementos`);
    } catch (e) { if(token!==S.filterToken)return;fail(e); }
    renderTab();
  }

  // ── propiedades ──────────────────────────────────────────────────────
  async function tabProps(p) {
    const renderToken=++S.renderToken;
    const sel = S.view ? S.view.selection() : [];
    if (sel.length !== 1) { put(p, h('p', { class: 'bm-muted' }, sel.length ? `${sel.length} elementos seleccionados. Elige uno para ver sus propiedades.` : 'Selecciona un elemento en el modelo.')); return; }
    const r = await S.view.props(sel[0]);
    const [map] = r.externalId ? await cloud.select('element_mappings', `model_version_id=eq.${S.v.id}&source_id=eq.${encodeURIComponent(r.externalId)}&select=discipline,system,level,zone,category,phase,classification`) : [];
    const groups = {};
    (r.properties || []).forEach(x => { if (x.hidden) return; (groups[x.displayCategory || 'General'] = groups[x.displayCategory || 'General'] || []).push(x); });
    if(renderToken!==S.renderToken)return;
    put(p,
      h('h2', null, r.name || `Elemento ${sel[0]}`),
      map ? h('dl', { class: 'bm-dl bm-class' }, [['Disciplina', map.discipline], ['Sistema', map.system], ['Nivel', map.level], ['Zona', map.zone], ['Etapa', map.phase]]
        .filter(x => x[1]).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))),
        map.classification === 'sin_clasificar' ? h('div', null, h('dt', null, 'Clasificación'), h('dd', null, 'Sin clasificar')) : null) : null,
      canComment() ? h('button', { type: 'button', class: 'ag-btn', onclick: () => newIssue() }, icon('message-plus'), 'Crear incidencia con este elemento') : null,
      Object.entries(groups).map(([g, list]) => h('details', { class: 'bm-facet', open: g === 'Element' || g === 'Elemento' || g === 'Item' },
        h('summary', null, g), h('dl', { class: 'bm-dl' }, list.map(x => h('div', null, h('dt', null, x.displayName), h('dd', null, String(x.displayValue)))))))
    );
  }

  // ── vistas y 360° ────────────────────────────────────────────────────
  async function tabViews(p) {
    const renderToken=++S.renderToken;
    const vps = await cloud.select('viewpoints', `project_id=eq.${S.v.project_id}&model_id=eq.${S.v.model_id}&select=*&order=created_at.desc`);
    const sceneName = id => (S.scenes.find(s => s.id === id) || {}).name;
    const save = () => {
      const name = h('input', { type: 'text', maxlength: 160, placeholder: 'Ej. Cuarto de máquinas N-2' });
      const scene = h('select', null, h('option', { value: '' }, 'Sin escena'), S.scenes.map(s => h('option', { value: s.id }, s.name)));
      const m = modal({ title: 'Guardar vista', body: [field('Nombre', name), field('Escena 360° del mismo lugar', scene, 'Permite saltar entre el modelo y la panorámica.')],
        actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Guardar', primary: true, onClick: async () => {
          if (!name.value.trim()) return;
          try { await createViewpoint(name.value.trim(), scene.value || null); m.close(); renderTab(); notify('Vista guardada'); } catch (e) { fail(e); }
        } }] });
    };
    if(renderToken!==S.renderToken)return;
    put(p,
      canComment() ? h('button', { type: 'button', class: 'ag-btn primary', onclick: save }, icon('camera-plus'), 'Guardar vista actual') : null,
      vps.length ? h('ul', { class: 'bm-list' }, vps.map(vp => h('li', null,
        h('button', { type: 'button', class: 'bm-item', onclick: () => openViewpoint(vp.id, vp) }, h('strong', null, vp.name),
          h('small', null, formatDate(vp.created_at), vp.element_source_ids.length ? `, ${vp.element_source_ids.length} elementos` : '')),
        vp.scene_id && sceneName(vp.scene_id) ? h('button', { type: 'button', class: 'ag-btn', onclick: () => openPano(vp.scene_id) }, icon('360-view'), sceneName(vp.scene_id)) : null))) : h('p', { class: 'bm-muted' }, 'Aún no hay vistas guardadas.'),
      S.scenes.length ? h('details', { class: 'bm-facet' }, h('summary', null, `Escenas 360° del proyecto (${S.scenes.length})`),
        h('ul', { class: 'bm-list' }, S.scenes.filter(s => s.pano_url).map(s => h('li', null, h('button', { type: 'button', class: 'bm-item', onclick: () => openPano(s.id) }, s.name))))) : null);
  }
  async function createViewpoint(name, sceneId) {
    const sel = S.view.selection();
    const sources = sel.length ? (await Promise.all(sel.slice(0, 500).map(id => S.view.props(id)))).map(r => r.externalId).filter(Boolean) : [];
    const [vp] = await cloud.insert('viewpoints', { project_id: S.v.project_id, model_id: S.v.model_id, model_version_id: S.v.id, name,
      state: S.view.getState(), filters: S.filters, element_source_ids: sources, scene_id: sceneId });
    return vp;
  }
  async function openViewpoint(id, vp) {
    try {
      if (!vp) [vp] = await cloud.select('viewpoints', `id=eq.${id}&select=*`);
      if (!vp) return notify('La vista ya no existe', 'error');
      S.filters = vp.filters || {};
      if (Object.keys(S.filters).length) await applyFilters(); else S.view.showAll();
      S.view.restoreState(vp.state);
      if (vp.element_source_ids.length) {
        const ids = await dbidsForSources(vp.element_source_ids);
        if (ids.length < vp.element_source_ids.length) notify(`${vp.element_source_ids.length - ids.length} elementos de esta vista no existen en la versión actual`, 'error');
        S.view.select(ids);
      }
    } catch (e) { fail(e); }
  }
  function openPano(sceneId) {
    const sc = S.scenes.find(s => s.id === sceneId);
    if (!sc || !sc.pano_url) return notify('La escena no tiene panorámica', 'error');
    // Página aparte (iframe): el visor de Autodesk trae su propia versión de three.js.
    const frame = h('iframe', { src: `pano.html?u=${encodeURIComponent(sc.pano_url)}`, title: `Panorámica 360° de ${sc.name}`, class: 'bm-pano' });
    const m = modal({ title: sc.name, wide: true, body: frame, actions: [{ label: 'Cerrar', onClick: () => m.close() }] });
    m.el.classList.add('bm-pano-box');
  }

  // ── incidencias ──────────────────────────────────────────────────────
  async function tabIssues(p, filter) {
    const renderToken=++S.renderToken;
    filter = filter || 'abiertas';
    const q = filter === 'abiertas' ? '&status=in.(abierta,en_proceso)' : '';
    const issues = await cloud.select('issues', `project_id=eq.${S.v.project_id}&model_id=eq.${S.v.model_id}${q}&select=*&order=created_at.desc&limit=300`);
    if(renderToken!==S.renderToken)return;
    put(p,
      h('div', { class: 'bm-row' },
        canComment() ? h('button', { type: 'button', class: 'ag-btn primary', onclick: () => newIssue() }, icon('plus'), 'Nueva') : null,
        h('select', { 'aria-label': 'Mostrar', onchange: e => tabIssues(p, e.target.value) },
          h('option', { value: 'abiertas', selected: filter === 'abiertas' }, 'Abiertas y en proceso'), h('option', { value: 'todas', selected: filter === 'todas' }, 'Todas'))),
      issues.length ? h('ul', { class: 'bm-list' }, issues.map(i => h('li', null, h('button', { type: 'button', class: 'bm-item', onclick: () => openIssue(i.id, i) },
        h('strong', null, i.title), h('small', null, `${ISSUE_STATUS[i.status]}, prioridad ${PRIORITY[i.priority].toLowerCase()}, ${formatDate(i.created_at)}`))))) : h('p', { class: 'bm-muted' }, 'No hay incidencias.'));
  }
  async function newIssue() {
    const title = h('input', { type: 'text', maxlength: 200 }), body = h('textarea', { rows: 4, maxlength: 4000 });
    const prio = h('select', null, Object.entries(PRIORITY).map(([k, v]) => h('option', { value: k, selected: k === 'media' }, v)));
    const due = h('input', { type: 'date' });
    const n = S.view.selection().length;
    const m = modal({ title: 'Nueva incidencia', body: [field('Título', title), field('Descripción', body), h('div', { class: 'bm-grid2' }, field('Prioridad', prio), field('Fecha límite', due)),
      h('p', null, n ? `Se vincula a ${n} elemento(s) seleccionados y a la vista actual.` : 'Se guarda la vista actual. Selecciona elementos antes para vincularlos.')],
      actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Crear', primary: true, onClick: async () => {
        if (!title.value.trim()) return;
        m.setBusy(true, 'Guardando…');
        try {
          const vp = await createViewpoint(`Incidencia: ${title.value.trim()}`.slice(0, 160), null);
          await cloud.insert('issues', { project_id: S.v.project_id, model_id: S.v.model_id, model_version_id: S.v.id, viewpoint_id: vp.id,
            title: title.value.trim(), body: body.value.trim(), priority: prio.value, due_date: due.value || null,
            element_source_ids: vp.element_source_ids, created_by: cloud.user.id });
          m.close(); setTab('incidencias'); notify('Incidencia creada');
        } catch (e) { fail(e); m.setBusy(false); m.setActions([{ label: 'Cerrar', onClick: () => m.close() }]); }
      } }] });
  }
  async function openIssue(id, issue) {
    try {
      if (!issue) [issue] = await cloud.select('issues', `id=eq.${id}&select=*`);
      if (!issue) return notify('La incidencia ya no existe', 'error');
      if (issue.viewpoint_id) await openViewpoint(issue.viewpoint_id);
      const comments = await cloud.select('issue_comments', `issue_id=eq.${issue.id}&select=*&order=created_at.asc`);
      const mine = issue.created_by === (cloud.user && cloud.user.id);
      const st = h('select', { disabled: !(canEdit() || (mine && canComment())), 'aria-label': 'Estado' },
        Object.entries(ISSUE_STATUS).map(([k, v]) => h('option', { value: k, selected: issue.status === k }, v)));
      st.addEventListener('change', async () => { try { await cloud.update('issues', `id=eq.${issue.id}`, { status: st.value }); notify('Estado actualizado'); renderTab(); } catch (e) { fail(e); } });
      const text = h('textarea', { rows: 3, maxlength: 4000, placeholder: 'Escribe un comentario' });
      const list = h('ul', { class: 'bm-comments' }, comments.map(c => h('li', null, h('small', null, formatDate(c.created_at, true)), h('p', null, c.body))));
      const m = modal({ title: issue.title, wide: true, body: [
        issue.body ? h('p', null, issue.body) : null,
        h('div', { class: 'bm-grid2' }, field('Estado', st), h('p', null, `Prioridad ${PRIORITY[issue.priority].toLowerCase()}`, issue.due_date ? `, vence ${issue.due_date}` : '', `. ${issue.element_source_ids.length} elementos.`)),
        list, canComment() ? field('Comentario', text) : null],
        actions: [{ label: 'Cerrar', onClick: () => m.close() }, canComment() ? { label: 'Comentar', primary: true, onClick: async () => {
          if (!text.value.trim()) return;
          try { await cloud.insert('issue_comments', { issue_id: issue.id, project_id: issue.project_id, body: text.value.trim(), created_by: cloud.user.id });
                list.append(h('li', null, h('small', null, 'ahora'), h('p', null, text.value.trim()))); text.value = ''; } catch (e) { fail(e); }
        } } : null].filter(Boolean) });
    } catch (e) { fail(e); }
  }

  // ── 4D ───────────────────────────────────────────────────────────────
  let player = null;
  function stopPlayer() { if (player) { clearInterval(player); player = null; } }
  async function tab4D(p) {
    const renderToken=++S.renderToken;
    const sch = await cloud.rpc('schedule_for_version', { p_version: S.v.id });
    if(renderToken!==S.renderToken)return;
    const tasks = sch.tasks || [];
    if (!tasks.length) {
      put(p, h('p', { class: 'bm-muted' }, 'Este modelo no tiene calendario. Impórtalo desde el panel (Modelos y 4D → Importar calendario) con el CSV de TimeLiner o un XML de Microsoft Project.'));
      return;
    }
    const r = AgelFourD.range(tasks, 'both');
    const total = AgelFourD.dayDiff(r.start, r.end);
    let mode = 'planned';
    const today = new Date().toISOString().slice(0, 10);
    let day = Math.max(0, Math.min(total, AgelFourD.dayDiff(r.start, today)));
    const slider = h('input', { type: 'range', min: 0, max: total, value: day, 'aria-label': 'Fecha' });
    const dateOut = h('output', { class: 'bm-date' });
    const counts = h('ul', { class: 'bm-legend' });
    const activeList = h('ul', { class: 'bm-list bm-small' });
    const play = h('button', { type: 'button', class: 'ag-btn primary', onclick: () => {
      if (player) { stopPlayer(); play.textContent = 'Reproducir'; return; }
      play.textContent = 'Pausa';
      player = setInterval(() => { day = day >= total ? 0 : day + Math.max(1, Math.round(total / 120)); slider.value = day; apply(); }, 250);
    } }, 'Reproducir');
    const modeSel = h('select', { 'aria-label': 'Fechas', onchange: e => { mode = e.target.value; apply(); } },
      h('option', { value: 'planned' }, 'Planeado'), h('option', { value: 'actual' }, 'Real'));
    slider.addEventListener('input', () => { day = +slider.value; apply(); });
    function apply() {
      const date = AgelFourD.addDays(r.start, day);
      dateOut.textContent = new Date(date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
      const st = AgelFourD.stateAt(tasks, date, mode);
      const by = { oculto: [], normal: [], construyendo: [], demoliendo: [], temporal: [] };
      st.forEach((s, id) => by[s].push(id));
      if (S.view) {
        S.view.showAll(); S.view.clearColors();
        S.view.hide(by.oculto);
        for (const k of ['construyendo', 'demoliendo', 'temporal']) if (by[k].length) S.view.color(by[k], COLORS[k]);
      }
      put(counts, ...Object.entries(by).map(([k, ids]) => h('li', null, h('i', { class: 'bm-swatch', style: { background: COLORS[k] || (k === 'oculto' ? 'transparent' : '#888') } }), `${STATE_LABEL[k]}: ${ids.length}`)));
      const act = tasks.filter(t => ['construyendo', 'demoliendo', 'temporal'].includes(AgelFourD.taskState(t, date, mode)));
      put(activeList, ...act.slice(0, 30).map(t => h('li', null, t.name)));
    }
    const late = AgelFourD.variance(tasks, today);
    const rep = sch.report || {};
    if(renderToken!==S.renderToken)return;
    put(p,
      h('div', { class: 'bm-row' }, play, modeSel), slider, dateOut, counts,
      h('h3', null, 'Activas en esta fecha'), activeList,
      late.length ? h('details', { class: 'bm-facet' }, h('summary', null, `Atrasos al día de hoy (${late.length})`),
        h('ul', { class: 'bm-list bm-small' }, late.slice(0, 50).map(x => h('li', null, `${x.name}: ${x.status}, ${x.days} días`)))) : null,
      (rep.tareas_sin_elementos || []).length || rep.vinculos_ausentes_en_version ? h('details', { class: 'bm-facet' }, h('summary', null, 'Calidad del calendario'),
        h('p', null, `${(rep.tareas_sin_elementos || []).length} tareas sin elementos vinculados. ${rep.vinculos_ausentes_en_version || 0} vínculos apuntan a elementos que no existen en esta versión.`)) : null);
    apply();
  }

  // ── datos: reglas, reindexar, comparar versiones ─────────────────────
  async function tabData(p) {
    const renderToken=++S.renderToken;
    const rules = await cloud.select('classification_rules', `project_id=eq.${S.v.project_id}&select=*&order=position.asc`);
    const FIELDS = { discipline: 'Disciplina', system: 'Sistema', level: 'Nivel', zone: 'Zona', category: 'Categoría', phase: 'Etapa' };
    const OPS = { equals: 'es igual a', contains: 'contiene', starts_with: 'empieza con', regex: 'cumple la expresión', exists: 'existe' };
    const addRule = () => {
      const prop = h('input', { type: 'text', placeholder: 'Ej. Layer o Item/Layer', maxlength: 200 });
      const op = h('select', null, Object.entries(OPS).map(([k, v]) => h('option', { value: k }, v)));
      const val = h('input', { type: 'text', maxlength: 200 });
      const fieldSel = h('select', null, Object.entries(FIELDS).map(([k, v]) => h('option', { value: k }, v)));
      const set = h('input', { type: 'text', maxlength: 120, placeholder: 'Ej. Eléctrica' });
      const m = modal({ title: 'Nueva regla de clasificación', body: [h('p', null, 'Si la propiedad cumple la condición, el elemento recibe el valor indicado. Las reglas se aplican en orden y ganan sobre las propiedades del modelo.'),
        h('div', { class: 'bm-grid2' }, field('Propiedad', prop), field('Condición', op)), field('Valor', val), h('div', { class: 'bm-grid2' }, field('Asignar a', fieldSel), field('Valor asignado', set))],
        actions: [{ label: 'Cancelar', onClick: () => m.close() }, { label: 'Agregar', primary: true, onClick: async () => {
          if (!prop.value.trim() || !set.value.trim()) return;
          try { await cloud.insert('classification_rules', { project_id: S.v.project_id, position: rules.length, property: prop.value.trim(), operator: op.value, value: val.value, field: fieldSel.value, set_value: set.value.trim() });
                m.close(); renderTab(); } catch (e) { fail(e); }
        } }] });
    };
    const older = S.versions.filter(x => x.id !== S.v.id && x.status === 'ready');
    const cmpSel = h('select', { 'aria-label': 'Versión a comparar' }, older.map(x => h('option', { value: x.id }, `v${x.version}${x.label ? ' ' + x.label : ''}`)));
    const cmpOut = h('div');
    if(renderToken!==S.renderToken)return;
    put(p,
      h('h3', null, 'Índice de elementos'),
      h('p', { class: 'bm-muted' }, S.facets && S.facets.total ? `${S.facets.total} elementos indexados.` : 'Sin indexar.'),
      canEdit() ? h('button', { type: 'button', class: 'ag-btn', onclick: () => indexElements() }, icon('refresh'), S.facets && S.facets.total ? 'Reindexar' : 'Indexar') : null,
      h('h3', null, 'Reglas de clasificación'),
      rules.length ? h('ol', { class: 'bm-list bm-small' }, rules.map(r => h('li', null,
        h('span', { class: 'bm-grow' }, `Si «${r.property}» ${OPS[r.operator]}${r.operator !== 'exists' ? ` «${r.value}»` : ''}: ${FIELDS[r.field]} = ${r.set_value}`),
        canEdit() ? h('button', { type: 'button', class: 'ag-btn danger', 'aria-label': 'Quitar regla', onclick: async () => { try { await cloud.remove('classification_rules', `id=eq.${r.id}`); renderTab(); } catch (e) { fail(e); } } }, icon('trash')) : null))) : h('p', { class: 'bm-muted' }, 'Sin reglas.'),
      canEdit() ? h('button', { type: 'button', class: 'ag-btn', onclick: addRule }, icon('plus'), 'Agregar regla') : null,
      older.length ? [h('h3', null, 'Comparar con otra versión'), h('div', { class: 'bm-row' }, cmpSel, h('button', { type: 'button', class: 'ag-btn', onclick: async () => {
        try {
          const c = await cloud.rpc('compare_model_versions', { p_old: cmpSel.value, p_new: S.v.id });
          put(cmpOut, h('ul', { class: 'ag-list' },
            h('li', null, `${c.agregados} elementos nuevos, ${c.eliminados} eliminados`),
            h('li', null, `${c.vistas_afectadas.length} vistas y ${c.incidencias_afectadas.length} incidencias apuntan a elementos eliminados`),
            h('li', null, `${c.vinculos_4d_rotos} vínculos del calendario 4D quedaron sin elemento`)));
        } catch (e) { fail(e); }
      } }, 'Comparar')), cmpOut] : null);
  }

  boot();
})();
