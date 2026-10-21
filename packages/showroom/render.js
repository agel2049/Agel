/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · showroom — renderizador (rama Showroom Virtual, S1–S4)

   Convierte una publicación validada (sanitizeShowroom) en HTML. Es el
   mismo código para:
     • el navegador (apps/showroom), que luego añade la interacción, y
     • la pre-generación estática (scripts/prerender-showroom.mjs), para que
       buscadores y redes lean la oferta sin ejecutar JavaScript.
   Todo texto pasa por esc(); toda URL ya viene validada como https.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const esc = root.esc || (typeof require === 'function' ? require('../core/schema.js').esc : null);

  const LABELS = {
    desarrollo: { list: 'Unidades', one: 'unidad', tour: 'Recorrido' },
    edificio:   { list: 'Espacios', one: 'espacio', tour: 'Recorrido' },
    vivienda:   { list: 'Ambientes', one: 'ambiente', tour: 'Recorrido' },
    ambiente:   { list: 'Alternativas', one: 'alternativa', tour: 'Escenarios' },
    producto:   { list: 'Variantes', one: 'variante', tour: 'Vistas 360°' }
  };
  const AVAIL = { disponible: 'Disponible', apartada: 'Apartada', vendida: 'Vendida', no_aplica: '' };

  function money(v, cur) {
    if (v == null) return '';
    try { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur || 'MXN', maximumFractionDigits: 0 }).format(v); }
    catch (_) { return `$${Math.round(v).toLocaleString('es-MX')} ${cur || ''}`; }
  }
  // URL dentro de url('…') en un atributo style: el navegador decodifica las
  // entidades HTML antes de leer el CSS, así que comillas y paréntesis se
  // codifican como %xx (siguen siendo la misma dirección) y luego se aplica esc().
  const cssUrl = u => esc(String(u || '').replace(/['"()\\\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')));
  const num = (v, d = 0) => v == null ? '' : Number(v).toLocaleString('es-MX', { maximumFractionDigits: d });
  const paragraphs = t => String(t || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean)
    .map(x => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const monthYear = d => { const m = /^(\d{4})-(\d{2})/.exec(d || ''); return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : ''; };
  const dayMonthYear = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[3]} de ${MONTHS[+m[2] - 1]} de ${m[1]}` : ''; };

  // Hojas del catálogo (lo que se vende o elige) con su ruta de agrupación.
  function catalog(spaces) {
    const byId = new Map(spaces.map(s => [s.id, s]));
    const hasChildren = new Set(spaces.filter(s => s.parent_id).map(s => s.parent_id));
    const pathOf = s => { const p = []; let c = s.parent_id && byId.get(s.parent_id), guard = 0;
      while (c && guard++ < 10) { p.unshift(c); c = c.parent_id && byId.get(c.parent_id); } return p; };
    const leaves = spaces.filter(s => !hasChildren.has(s.id)).map(s => Object.assign({}, s, { path: pathOf(s) }));
    const groups = [...new Map(leaves.flatMap(l => l.path.slice(0, 2)).map(g => [g.id, g])).values()];
    return { leaves, groups, byId };
  }

  function model(m) {
    const labels = LABELS[m.project.kind] || LABELS.desarrollo;
    const cat = catalog(m.spaces);
    const tracks = cat.leaves.some(l => l.availability !== 'no_aplica');   // ¿este proyecto publica disponibilidad?
    const avail = cat.leaves.filter(l => l.availability === 'disponible').length;
    const areas = cat.leaves.map(l => l.area_m2).filter(v => v != null);
    return { labels, cat, tracks, avail, areas, areaLabel: (m.content && m.content.area_label) || 'Superficie' };
  }

  /** Estado comercial: lo desconocido se dice como tal, nunca se oculta ni se inventa. */
  function availOf(l, x) {
    if (AVAIL[l.availability]) return { key: l.availability, label: AVAIL[l.availability] };
    return x.tracks ? { key: 'por_confirmar', label: 'Por confirmar' } : null;
  }
  function priceOf(l, x) {
    if (l.price != null) return money(l.price, l.currency);
    return (x.tracks || x.cat.leaves.some(o => o.price != null)) ? 'Consultar' : '';
  }

  function facts(m, x) {
    const items = [];
    if (m.project.location) items.push(['Ubicación', esc(m.project.location)]);
    if (m.project.delivery) items.push(['Entrega', esc(m.project.delivery)]);
    if (x.tracks) items.push([`${x.labels.list} disponibles`, `${x.avail} de ${x.cat.leaves.length}`]);
    if (x.areas.length) {
      const lo = Math.min(...x.areas), hi = Math.max(...x.areas);
      items.push([x.areaLabel, lo === hi ? `${num(lo, 1)} m²` : `${num(lo, 1)} a ${num(hi, 1)} m²`]);
    }
    if (!items.length) return '';
    return `<dl class="sr-facts">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  }

  function hero(m, x) {
    const pano = m.scenes[0];
    const heroImg = (m.content.gallery[0] || {}).url;
    // Portada ligera: versión ≈2048 px si existe; en pantallas chicas, la miniatura.
    // La panorámica completa solo se descarga al entrar al recorrido.
    const big = pano && (pano.preview || pano.url), small = pano && (pano.preview || pano.thumb || pano.url);
    const horizon = pano
      ? `<div class="sr-horizon" style="--pano:url('${cssUrl(big)}');--pano-sm:url('${cssUrl(small)}')" data-heading="${pano.heading || 0}">
           <div class="sr-horizon-pan" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0"
                aria-label="${esc(`Mirar alrededor en ${pano.name}`)}" aria-describedby="sr-horizon-hint"></div>
           <p id="sr-horizon-hint" class="sr-horizon-hint">Arrastra o usa las flechas para mirar alrededor</p>
           <button type="button" class="sr-btn sr-horizon-cta" data-tour="0">Entrar al recorrido 360°</button>
         </div>`
      : (heroImg ? `<figure class="sr-horizon sr-horizon-still"><img src="${esc(heroImg)}" alt="${esc(m.content.gallery[0].caption || m.project.name)}" fetchpriority="high"></figure>` : '');
    return `<section class="sr-hero" aria-labelledby="sr-title">
      <h1 id="sr-title">${esc(m.project.name)}</h1>
      ${m.content.tagline || m.project.subtitle ? `<p class="sr-lede">${esc(m.content.tagline || m.project.subtitle)}</p>` : ''}
      ${facts(m, x)}
      ${horizon}
    </section>`;
  }

  // ── Explorar: render o plano con zonas seleccionables y puntos 360° ─────
  function explore(m, x) {
    const views = m.content.views || [];
    if (!views.length) return '';
    const byId = x.cat.byId;
    const leafIds = new Set(x.cat.leaves.map(l => l.id));
    const groupStats = id => {
      const ls = x.cat.leaves.filter(l => l.path.some(p => p.id === id));
      return { total: ls.length, avail: ls.filter(l => l.availability === 'disponible').length };
    };
    const zone = r => {
      const s = byId.get(r.space); if (!s) return '';
      const isLeaf = leafIds.has(s.id);
      const leaf = isLeaf ? x.cat.leaves.find(l => l.id === s.id) : null;
      const st = isLeaf ? availOf(leaf, x) : null;
      const g = isLeaf ? null : groupStats(s.id);
      const label = isLeaf ? `${s.name}${s.code ? ` (${s.code})` : ''}${st ? `, ${st.label.toLowerCase()}` : ''}`
                           : `${s.name}${x.tracks ? `, ${g.avail} de ${g.total} disponibles` : ''}`;
      return `<polygon class="sr-zone ${isLeaf ? `sr-zone-${st ? st.key : 'na'}` : 'sr-zone-group'}" points="${r.points.map(p => p.join(',')).join(' ')}"
        data-space="${esc(s.id)}" data-kind="${isLeaf ? 'unit' : 'group'}" tabindex="0" role="button" aria-label="${esc(label)}"><title>${esc(label)}</title></polygon>`;
    };
    const spot = sp => {
      const sc = m.scenes[sp.scene]; if (!sc) return '';
      return `<button type="button" class="sr-spot" style="left:${sp.x}%;top:${sp.y}%" data-tour="${sp.scene}" aria-label="${esc(`Recorrido 360°: ${sc.name}`)}"><span>${esc(sc.name)}</span></button>`;
    };
    const tabs = views.length > 1
      ? `<div class="sr-view-tabs" role="tablist" aria-label="Vistas">${views.map((v, i) =>
          `<button type="button" role="tab" id="sr-vt-${i}" aria-controls="sr-vp-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-view-tab="${i}">${esc(v.title)}</button>`).join('')}</div>` : '';
    const hasUnits = views.some(v => v.regions.some(r => leafIds.has(r.space)));
    const hasSpots = views.some(v => v.spots.length);
    return `<section id="explora" class="sr-section sr-explore" aria-labelledby="sr-exp-t">
      <h2 id="sr-exp-t">Explora</h2>
      <p class="sr-note">Toca ${hasUnits ? `una ${x.labels.one} o un edificio` : 'una zona'} para ver su información${hasSpots ? '; los puntos abren el recorrido 360° de ese lugar' : ''}. También puedes usar la lista de ${x.labels.list.toLowerCase()}.</p>
      ${tabs}
      ${views.map((v, i) => `<figure class="sr-view" id="sr-vp-${i}" ${views.length > 1 ? `role="tabpanel" aria-labelledby="sr-vt-${i}"` : ''} data-view="${i}" style="--ratio:${v.ratio}"${i ? ' hidden' : ''}>
        <div class="sr-view-stage">
          <img src="${esc(v.image)}" alt="${esc(v.title)}" ${i ? 'loading="lazy"' : ''} decoding="async">
          <svg class="sr-zones" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="${esc(`Zonas de ${v.title}`)}">${v.regions.map(zone).join('')}</svg>
          ${v.spots.map(spot).join('')}
        </div>
      </figure>`).join('')}
      <ul class="sr-legend" aria-label="Simbología">
        ${hasUnits && x.tracks ? '<li><i class="sr-key sr-key-disponible"></i>Disponible</li><li><i class="sr-key sr-key-apartada"></i>Apartada</li><li><i class="sr-key sr-key-vendida"></i>Vendida</li>' : ''}
        ${hasSpots ? '<li><i class="sr-key sr-key-spot"></i>Recorrido 360°</li>' : ''}
      </ul>
      <div class="sr-zone-tip" role="status" aria-live="polite" hidden></div>
    </section>`;
  }

  function about(m) {
    const c = m.content;
    if (!c.description && !c.highlights.length && !c.amenities.length) return '';
    return `<section id="proyecto" class="sr-section sr-about" aria-labelledby="sr-about-t">
      <h2 id="sr-about-t">El proyecto</h2>
      <div class="sr-prose">${paragraphs(c.description)}</div>
      ${c.highlights.length ? `<ul class="sr-highlights">${c.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      ${c.amenities.length ? `<h3>Amenidades</h3><ul class="sr-amenities">${c.amenities.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  // Opciones de filtro a partir de los datos publicados (nada inventado).
  function steps(values, n) {
    const v = [...new Set(values)].sort((a, b) => a - b);
    if (v.length < 3) return [];
    const out = [];
    for (let i = 1; i < n; i++) out.push(v[Math.min(v.length - 1, Math.round(i * (v.length - 1) / n))]);
    return [...new Set(out)];
  }
  function roundPrice(p) { const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(p)) - 1)); return Math.ceil(p / mag) * mag; }

  function units(m, x) {
    const L = x.cat.leaves;
    if (!L.length) return '';
    const has = k => L.some(l => l[k] != null && l[k] !== '' && l[k] !== 'no_aplica');
    const one = x.labels.one[0].toUpperCase() + x.labels.one.slice(1);
    const cols = [
      ['name', one, l => `<button type="button" class="sr-unit-open" data-unit="${esc(l.id)}">${esc(l.name)}${l.code ? ` <span class="sr-code">${esc(l.code)}</span>` : ''}</button>`],
      x.cat.groups.length ? ['path', 'Ubicación', l => esc(l.path.map(p => p.name).join(', '))] : null,
      has('area_m2') ? ['area_m2', `${x.areaLabel} (m²)`, l => num(l.area_m2, 1), true] : null,
      has('bedrooms') ? ['bedrooms', 'Recámaras', l => num(l.bedrooms)] : null,
      has('bathrooms') ? ['bathrooms', 'Baños', l => num(l.bathrooms, 1)] : null,
      has('parking') ? ['parking', 'Estac.', l => num(l.parking)] : null,
      (has('price') || x.tracks) ? ['price', 'Precio', l => priceOf(l, x), true] : null,
      x.tracks ? ['availability', 'Estado', l => { const s = availOf(l, x); return s ? `<span class="sr-av sr-av-${s.key}">${s.label}</span>` : ''; }] : null
    ].filter(Boolean);
    const groupChips = x.cat.groups.length > 1
      ? `<div class="sr-filters" role="group" aria-label="Filtrar por ubicación">
           <button type="button" class="sr-chip" aria-pressed="true" data-filter="">Todas</button>
           ${x.cat.groups.map(g => `<button type="button" class="sr-chip" aria-pressed="false" data-filter="${esc(g.id)}">${esc(g.name)}</button>`).join('')}
         </div>` : '';
    const sel = (id, label, opts) => opts.length ? `<div class="sr-filter"><label for="${id}">${label}</label><select id="${id}" data-f="${id.slice(2)}"><option value="">Cualquiera</option>${opts.join('')}</select></div>` : '';
    const beds = has('bedrooms') ? [...new Set(L.map(l => l.bedrooms).filter(v => v != null && v > 0))].sort((a, b) => a - b) : [];
    const prices = L.map(l => l.price).filter(v => v != null);
    const areas = L.map(l => l.area_m2).filter(v => v != null);
    const cur = (L.find(l => l.price != null) || {}).currency;
    const tools = `<div class="sr-units-tools">
        <div class="sr-filter sr-filter-q"><label for="f-q">Buscar</label><input id="f-q" type="search" data-f="q" placeholder="Nombre o clave" autocomplete="off"></div>
        ${beds.length > 1 ? sel('f-bed', 'Recámaras', beds.map(b => `<option value="${b}">${b} o más</option>`)) : ''}
        ${sel('f-price', 'Precio hasta', steps(prices, 4).map(roundPrice).filter((p, i, a) => a.indexOf(p) === i).map(p => `<option value="${p}">${money(p, cur)}</option>`))}
        ${sel('f-area', 'Superficie desde', steps(areas, 4).map(Math.floor).filter((a, i, arr) => arr.indexOf(a) === i).map(a => `<option value="${a}">${num(a)} m²</option>`))}
        ${x.tracks ? `<label class="sr-only-avail"><input type="checkbox" data-only-available> Solo disponibles</label>` : ''}
      </div>${groupChips}`;
    return `<section id="unidades" class="sr-section sr-units" aria-labelledby="sr-units-t">
      <h2 id="sr-units-t">${x.labels.list}</h2>
      ${tools}
      <div class="sr-results"><p class="sr-count" data-count aria-live="polite">${L.length} ${x.labels.list.toLowerCase()}</p>
        <button type="button" class="sr-link-btn" data-clear hidden>Limpiar filtros</button></div>
      <div class="sr-table-wrap" tabindex="0" role="region" aria-labelledby="sr-units-t">
      <table class="sr-table">
        <thead><tr>${cols.map(c => `<th scope="col" class="c-${c[0]}"${c[3] ? ' aria-sort="none"' : ''}>${c[3] ? `<button type="button" class="sr-sort" data-sort="${c[0]}">${esc(c[1])}</button>` : esc(c[1])}</th>`).join('')}<th scope="col" class="c-save"><span class="sr-vh">Guardar</span></th></tr></thead>
        <tbody>${L.map(l => `<tr data-unit-row="${esc(l.id)}" data-groups="${esc(l.path.map(p => p.id).join(' '))}" data-avail="${l.availability}"
              data-q="${esc(`${l.name} ${l.code}`.toLowerCase())}" data-bed="${l.bedrooms ?? ''}" data-price="${l.price ?? ''}" data-area="${l.area_m2 ?? ''}">
          ${cols.map((c, i) => i === 0 ? `<th scope="row" class="c-${c[0]}">${c[2](l)}</th>` : `<td class="c-${c[0]}" data-label="${esc(c[1])}">${c[2](l)}</td>`).join('')}
          <td class="c-save"><button type="button" class="sr-save" data-save="${esc(l.id)}" aria-pressed="false" aria-label="${esc(`Guardar ${l.name}`)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg></button></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="sr-empty" hidden>No hay ${x.labels.list.toLowerCase()} con esos filtros.</p>
    </section>`;
  }

  function tour(m, x) {
    if (!m.scenes.length) return '';
    return `<section id="recorrido" class="sr-section sr-tour" aria-labelledby="sr-tour-t">
      <h2 id="sr-tour-t">${x.labels.tour}</h2>
      <p class="sr-note">Elige un ambiente para verlo en 360°. Se carga solo al abrirlo.</p>
      <ol class="sr-scenes">${m.scenes.map((s, i) => `<li><button type="button" data-tour="${i}">
        <span class="sr-scene-thumb" style="--pano:url('${cssUrl(s.thumb || s.preview || s.url)}')" aria-hidden="true"></span>
        <span class="sr-scene-name">${esc(s.name)}</span>${s.meta ? `<span class="sr-scene-meta">${esc(s.meta)}</span>` : ''}
      </button></li>`).join('')}</ol>
    </section>`;
  }

  function model3d(m) {
    const d = m.content.model3d;
    if (!d) return '';
    return `<section id="modelo" class="sr-section sr-model" aria-labelledby="sr-model-t">
      <h2 id="sr-model-t">${esc(d.title)}</h2>
      <p class="sr-note">Gíralo y acércate. En teléfonos compatibles puedes verlo en tu espacio con realidad aumentada.</p>
      <div class="sr-model-stage" data-model="${esc(d.url)}"${d.poster ? ` style="--poster:url('${cssUrl(d.poster)}')"` : ''}>
        <button type="button" class="sr-btn" data-model-open>Ver en 3D</button>
      </div>
    </section>`;
  }

  function gallery(m) {
    const g = m.content.gallery;
    if (!g.length) return '';
    return `<section id="galeria" class="sr-section sr-gallery" aria-labelledby="sr-gal-t">
      <h2 id="sr-gal-t">Galería</h2>
      <ul class="sr-grid">${g.map((im, i) => `<li><button type="button" class="sr-shot" data-shot="${i}" aria-label="${esc(im.caption ? `Ampliar: ${im.caption}` : `Ampliar imagen ${i + 1}`)}">
        <img src="${esc(im.url)}" alt="${esc(im.caption)}" loading="lazy" decoding="async"></button>
        ${im.caption ? `<p class="sr-caption">${esc(im.caption)}</p>` : ''}</li>`).join('')}</ul>
    </section>`;
  }

  function progress(m) {
    const p = m.content.progress || [];
    if (!p.length) return '';
    return `<section id="avance" class="sr-section sr-progress" aria-labelledby="sr-prog-t">
      <h2 id="sr-prog-t">Avance de obra</h2>
      <ol class="sr-timeline">${p.map((e, ei) => `<li>
        ${e.date ? `<p class="sr-when"><time datetime="${esc(e.date)}">${esc(monthYear(e.date))}</time></p>` : '<p class="sr-when"></p>'}
        <div><h3>${esc(e.title || 'Avance')}</h3>${e.note ? `<p>${esc(e.note)}</p>` : ''}
        ${e.images.length ? `<ul class="sr-prog-shots">${e.images.map((im, ii) => `<li><button type="button" class="sr-shot" data-progress="${ei}:${ii}" aria-label="${esc(`Ampliar foto ${ii + 1} de ${e.title || 'avance'}`)}"><img src="${esc(im.url)}" alt="${esc(im.caption)}" loading="lazy" decoding="async"></button></li>`).join('')}</ul>` : ''}</div>
      </li>`).join('')}</ol>
    </section>`;
  }

  function plans(m) {
    const p = m.content.plans;
    if (!p.length) return '';
    return `<section id="planos" class="sr-section sr-plans" aria-labelledby="sr-plans-t">
      <h2 id="sr-plans-t">Planos</h2>
      <ul class="sr-plan-list">${p.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">
        ${x.pdf ? '<span class="sr-plan-pdf" aria-hidden="true">PDF</span>' : `<img src="${esc(x.url)}" alt="" loading="lazy">`}
        <span>${esc(x.title)}</span></a></li>`).join('')}</ul>
    </section>`;
  }

  function location(m) {
    const l = m.content.location;
    if (!l.address && !l.map_url && !l.notes) return '';
    return `<section id="ubicacion" class="sr-section sr-location" aria-labelledby="sr-loc-t">
      <h2 id="sr-loc-t">Ubicación</h2>
      ${l.address ? `<address>${esc(l.address)}</address>` : ''}
      ${l.notes ? `<div class="sr-prose">${paragraphs(l.notes)}</div>` : ''}
      ${l.map_url ? `<a class="sr-link" href="${esc(l.map_url)}" target="_blank" rel="noopener">Abrir en el mapa</a>` : ''}
    </section>`;
  }

  function contact(m, x) {
    const c = m.content.contact;
    const options = x.cat.leaves.filter(l => l.availability !== 'vendida');
    return `<section id="contacto" class="sr-section sr-contact" aria-labelledby="sr-contact-t">
      <h2 id="sr-contact-t">${esc(c.cta)}</h2>
      <p class="sr-note">Te respondemos por correo o teléfono${c.hours ? `, ${esc(c.hours)}` : ''}. Para recorrer y consultar no necesitas dejar tus datos.</p>
      <form class="sr-form" novalidate>
        <div class="sr-field"><label for="f-name">Nombre</label><input id="f-name" name="name" autocomplete="name" required maxlength="120"></div>
        <div class="sr-field"><label for="f-email">Correo</label><input id="f-email" name="email" type="email" autocomplete="email" required maxlength="200"></div>
        <div class="sr-field"><label for="f-phone">Teléfono <span class="sr-opt">(opcional)</span></label><input id="f-phone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div>
        ${options.length ? `<div class="sr-field"><label for="f-unit">${x.labels.one[0].toUpperCase() + x.labels.one.slice(1)} de interés <span class="sr-opt">(opcional)</span></label>
          <select id="f-unit" name="space"><option value="">Sin preferencia</option>${options.map(o => `<option value="${esc(o.id)}">${esc(o.name)}${o.code ? ` (${esc(o.code)})` : ''}</option>`).join('')}</select></div>` : ''}
        <label class="sr-consent sr-field-wide sr-with-sel" hidden><input type="checkbox" name="with_selection" checked> <span data-sel-summary>Incluir mi selección</span></label>
        <div class="sr-field sr-field-wide"><label for="f-msg">Mensaje <span class="sr-opt">(opcional)</span></label><textarea id="f-msg" name="message" rows="4" maxlength="2000"></textarea></div>
        <div class="sr-hp" aria-hidden="true"><label for="f-company">Empresa</label><input id="f-company" name="company" tabindex="-1" autocomplete="off"></div>
        <label class="sr-consent"><input type="checkbox" name="consent" required> Acepto que me contacten sobre este proyecto. No usamos mis datos para nada más.</label>
        <p class="sr-form-error" role="alert"></p>
        <button type="submit" class="sr-btn">Enviar solicitud</button>
      </form>
      ${c.whatsapp || c.email ? `<p class="sr-alt">También puedes escribir ${c.whatsapp ? `por <a href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${c.whatsapp && c.email ? ' o ' : ''}${c.email ? `a <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}.</p>` : ''}
      <noscript><p class="sr-note">Para enviar el formulario activa JavaScript${c.email ? ` o escribe a ${esc(c.email)}` : ''}.</p></noscript>
    </section>`;
  }

  function header(m, x) {
    const brand = m.brand.logo
      ? `<img src="${esc(m.brand.logo)}" alt="${esc(m.brand.name || 'Inicio')}" class="sr-logo">`
      : `<span class="sr-brand-name">${esc(m.brand.name || m.project.name)}</span>`;
    const nav = [
      (m.content.views || []).length ? ['explora', 'Explora'] : null,
      x.cat.leaves.length ? ['unidades', x.labels.list] : null,
      m.scenes.length ? ['recorrido', x.labels.tour] : null,
      m.content.gallery.length ? ['galeria', 'Galería'] : null,
      (m.content.progress || []).length ? ['avance', 'Avance'] : null,
      (m.content.location.address || m.content.location.map_url) ? ['ubicacion', 'Ubicación'] : null
    ].filter(Boolean);
    return `<header class="sr-top">
      <a class="sr-brand" href="#sr-title">${brand}</a>
      ${nav.length ? `<nav aria-label="Secciones"><ul>${nav.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ul></nav>` : ''}
      <a class="sr-btn sr-btn-small" href="#contacto" data-contact>${esc(m.content.contact.cta)}</a>
    </header>`;
  }

  function footer(m) {
    return `<footer class="sr-foot">
      <p>${esc(m.brand.name || m.project.name)}</p>
      ${m.content.disclaimer ? `<p class="sr-disclaimer">${esc(m.content.disclaimer)}</p>` : '<p class="sr-disclaimer">Imágenes ilustrativas. Precios y disponibilidad sujetos a cambio sin previo aviso.</p>'}
    </footer>`;
  }

  /** Cuerpo de la página (sin <html>/<head>). */
  function renderBody(m, opts = {}) {
    const x = model(m);
    return `<a class="sr-skip" href="#contenido">Saltar al contenido</a>
${opts.preview ? `<div class="sr-preview" role="status">Vista previa de la versión ${esc(String(opts.preview))}. Así se verá al publicarla.</div>` : ''}
${header(m, x)}
<main id="contenido">
${hero(m, x)}
${explore(m, x)}
${units(m, x)}
${about(m)}
${tour(m, x)}
${model3d(m)}
${gallery(m)}
${progress(m)}
${plans(m)}
${location(m)}
${contact(m, x, opts)}
</main>
${footer(m)}
<div class="sr-selbar" hidden></div>`;
  }

  function meta(m, opts = {}) {
    const title = m.content.seo.title || `${m.project.name}${m.project.location ? ` en ${m.project.location}` : ''}`;
    const desc = m.content.seo.description || m.content.tagline || m.project.subtitle || '';
    const s0 = m.scenes[0] || {};
    const image = (m.content.gallery[0] || {}).url || s0.preview || s0.thumb || s0.url || '';
    const type = m.project.kind === 'producto' ? 'Product' : m.project.kind === 'desarrollo' ? 'ApartmentComplex' : 'Place';
    const ld = { '@context': 'https://schema.org', '@type': type, name: m.project.name, description: desc || undefined,
                 image: image || undefined, url: opts.canonical || undefined };
    if (type !== 'Product' && (m.content.location.address || m.project.location)) ld.address = m.content.location.address || m.project.location;
    return { title, desc, image, jsonLd: JSON.stringify(ld).replace(/</g, '\\u003c') };
  }

  /** Documento completo para la pre-generación estática. */
  function renderDocument(m, opts = {}) {
    const md = meta(m, opts);
    const r = esc(opts.root || '');               // prefijo hacia la raíz del sitio, p. ej. '../../'
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(md.title)}</title>
${md.desc ? `<meta name="description" content="${esc(md.desc)}">` : ''}
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(md.title)}">
${md.desc ? `<meta property="og:description" content="${esc(md.desc)}">` : ''}
${md.image ? `<meta property="og:image" content="${esc(md.image)}">` : ''}
${opts.noindex ? '<meta name="robots" content="noindex">' : ''}
<meta name="theme-color" content="#101112">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap">
<link rel="stylesheet" href="${r}apps/showroom/showroom.css">
<link rel="stylesheet" href="${r}apps/showroom/experience.css">
<link rel="stylesheet" href="${r}packages/bim/maquette.css">
<style>:root{--sr-accent:${m.brand.accent};--sr-accent-ink:${m.brand.accentText}}</style>
<script type="application/ld+json">${md.jsonLd}</script>
</head>
<body class="sr">
<div id="sr-app" data-slug="${esc(opts.slug || '')}">${renderBody(m, opts)}</div>
<script type="application/json" id="sr-data">${JSON.stringify(opts.raw || null).replace(/</g, '\\u003c')}</script>
<script src="${r}config.js"></script>
<script src="${r}packages/showroom/geometry.js"></script>
<script src="${r}packages/showroom/relations.js"></script>
<script src="${r}packages/core/schema.js"></script>
<script src="${r}packages/showroom/render.js"></script>
<script src="${r}packages/core/cloud.js"></script>
<script src="${r}packages/showroom/navigation.js"></script>
<script src="${r}apps/showroom/experience.js"></script>
<script src="${r}apps/showroom/tour-bridge.js"></script>
<script src="${r}apps/showroom/hotspot-presentation.js"></script>
<script src="${r}apps/showroom/showroom.js"></script>
</body>
</html>`;
  }

  const api = { renderBody, renderDocument, meta, catalog, money, cssUrl, num, availOf, priceOf, model, dayMonthYear, monthYear, LABELS, AVAIL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgelShowroom = api;
})(typeof window !== 'undefined' ? window : globalThis);
