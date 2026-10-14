/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · validación y salida segura (compartido)
   Lo usan el editor, el visor por enlace, el showroom y el panel, para que
   todas las entradas pasen por las mismas reglas (plan maestro B04).
   Script clásico: sus funciones quedan globales. En Node se exportan.
   ═══════════════════════════════════════════════════════════════════════ */
// ══ SEGURIDAD — ESCAPE DE SALIDA ═════════════════════════════════
// Todo dato que venga del usuario (o de un config cargado por ?id=)
// DEBE pasar por esc() antes de entrar a un innerHTML.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
// Valida que una URL de imagen sea segura para meter en src="".
// Bloquea javascript:, data:text/html, vbscript:, etc.
function safeImgUrl(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(s)) return s;
  if (/^blob:/i.test(s)) return s;
  return null;
}
// ══ VALIDACIÓN DE CONFIGURACIONES COMPARTIDAS (B04) ═════════════
// Los enlaces ?visor=1&id=… y ?modelo=1&id=… cargan un JSON público. Antes
// se usaba tal cual: tipos inesperados rompían el visor en silencio y los
// campos llegaban sin límite al DOM. Ahora todo pasa por un esquema:
// tipos, longitudes, cantidades y URLs. Lo inválido se descarta o se
// rechaza con un mensaje; nunca se ejecuta.
const CFG_LIMITS = {
  bytes: 1_000_000, scenes: 200, hotspots: 100, details: 30,
  name: 120, meta: 200, title: 140, detail: 500, models: 50
};
class ConfigError extends Error {}

function _str(v, max, fallback = '') {
  if (typeof v !== 'string') return fallback;
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return t.length > max ? t.slice(0, max) : t;
}
function _num(v, min, max) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}
// URL de medio cargable: https siempre; http solo si la propia app corre en
// http (desarrollo local). Nunca javascript:, data:text/html, file:, etc.
function safeMediaUrl(u) {
  if (typeof u !== 'string' || u.length > 2048) return null;
  const here = (typeof location !== 'undefined') ? location : { href: 'https://localhost/', protocol: 'https:' };
  let url;
  try { url = new URL(u.trim(), here.href); } catch (e) { return null; }
  if (url.protocol === 'https:') return url.href;
  if (url.protocol === 'http:' && here.protocol === 'http:') return url.href;
  return null;
}

async function fetchConfigJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new ConfigError('not_found');
  const text = await res.text();
  if (text.length > CFG_LIMITS.bytes) throw new ConfigError('too_large');
  try { return JSON.parse(text); } catch (e) { throw new ConfigError('bad_json'); }
}

function sanitizeVisorConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('bad_shape');
  if (!Array.isArray(raw.scenes)) throw new ConfigError('bad_shape');
  const scenes = [];
  for (const sc of raw.scenes.slice(0, CFG_LIMITS.scenes)) {
    if (!sc || typeof sc !== 'object') continue;
    const url = safeMediaUrl(sc.url);
    if (!url) continue;
    scenes.push({ _src: sc, name: _str(sc.name, CFG_LIMITS.name) || `Escena ${scenes.length + 1}`,
                  meta: _str(sc.meta, CFG_LIMITS.meta), url, hs: [] });
  }
  if (!scenes.length) throw new ConfigError('no_scenes');
  // Los destinos de hotspot se validan contra la lista FINAL de escenas.
  scenes.forEach(sc => {
    const list = Array.isArray(sc._src.hs) ? sc._src.hs.slice(0, CFG_LIMITS.hotspots) : [];
    sc.hs = list.map(h => {
      if (!h || typeof h !== 'object') return null;
      const x = _num(h.x, 0, 100), y = _num(h.y, 0, 100);
      if (x === null || y === null) return null;
      if (h.type === 'scene') {
        const t = _num(h.targetScene, 0, scenes.length - 1);
        if (t === null || !Number.isInteger(t)) return null;
        return { type: 'scene', x, y, targetScene: t,
                 title: _str(h.title, CFG_LIMITS.title) || scenes[t].name,
                 targetSceneName: scenes[t].name };
      }
      const details = Array.isArray(h.details)
        ? h.details.slice(0, CFG_LIMITS.details).map(d => _str(d, CFG_LIMITS.detail)).filter(Boolean) : [];
      return { type: 'info', x, y, title: _str(h.title, CFG_LIMITS.title) || 'Info',
               details, img: safeImgUrl(h.img) && !/^blob:/i.test(h.img) ? safeImgUrl(h.img) : null };
    }).filter(Boolean);
    const th = safeMediaUrl(sc._src.thumb);
    if (th && /^https:/i.test(th)) sc.thumb = th;            // miniatura publicada (opcional)
    const pv = safeMediaUrl(sc._src.preview);
    if (pv && /^https:/i.test(pv)) sc.preview = pv;          // versión ligera ≈2048 px (opcional)
    if (typeof sc._src.id === 'string' && /^[0-9a-f-]{36}$/i.test(sc._src.id)) sc.id = sc._src.id.toLowerCase();
    const hd = _num(sc._src.heading, -360, 360);
    if (hd !== null) sc.heading = hd;
    delete sc._src;
  });
  let opening = null;
  if (raw.opening && typeof raw.opening === 'object') {
    const o = raw.opening;
    opening = {
      title: _str(o.title, CFG_LIMITS.name), sub: _str(o.sub, CFG_LIMITS.meta),
      btnText: _str(o.btnText, 60) || 'Comenzar recorrido',
      endBtnText: _str(o.endBtnText, 60) || 'Regresar al recorrido',
      videoUrl: safeMediaUrl(o.videoUrl), endingVideoUrl: safeMediaUrl(o.endingVideoUrl)
    };
  }
  return { v: _num(raw.v, 0, 99) ?? 1, p: _str(raw.p, CFG_LIMITS.name) || 'Proyecto',
           sub: _str(raw.sub, CFG_LIMITS.meta), scenes, opening };
}

function sanitizeD5Config(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.models)) throw new ConfigError('bad_shape');
  const models = raw.models.slice(0, CFG_LIMITS.models).map(m => {
    if (!m || typeof m !== 'object') return null;
    const url = safeMediaUrl(m.url);
    if (!url) return null;
    return { name: _str(m.name, CFG_LIMITS.name) || 'Modelo', meta: _str(m.meta, CFG_LIMITS.meta),
             url, thumb: safeImgUrl(m.thumb) && !/^blob:/i.test(m.thumb) ? safeImgUrl(m.thumb) : null, isLocal: false };
  }).filter(Boolean);
  if (!models.length) throw new ConfigError('no_models');
  return { p: _str(raw.p, CFG_LIMITS.name) || 'Proyecto', sub: _str(raw.sub, CFG_LIMITS.meta),
           videoUrl: safeMediaUrl(raw.videoUrl), btnText: _str(raw.btnText, 60) || 'Explorar modelo', models };
}

// ── Showroom (fase 3) ─────────────────────────────────────────────────
// Valida la versión publicada de un showroom. Todo campo de texto llega
// recortado, toda URL es https y toda lista tiene tope. Lo que no cumple se
// descarta; el resto de la página se sigue mostrando.
const SPACE_KINDS = ['conjunto', 'edificio', 'nivel', 'unidad', 'area', 'espacio', 'ambiente', 'producto', 'variante'];
const AVAILABILITY = ['disponible', 'apartada', 'vendida', 'no_aplica'];
const _list = (v, max) => Array.isArray(v) ? v.slice(0, max) : [];
const _https = u => { const x = safeMediaUrl(u); return x && /^https:/i.test(x) ? x : null; };
const _uuid = v => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) ? v.toLowerCase() : null;
const _hex = v => (typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)) ? v.toUpperCase() : null;

// Color de texto legible sobre un fondo (WCAG): negro o blanco.
function readableOn(hex) {
  const c = _hex(hex); if (!c) return '#16130E';
  const lin = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(c.slice(i, i + 2), 16)));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#16130E' : '#FFFFFF';
}

function sanitizeShowroom(raw) {
  const visor = sanitizeVisorConfig(Object.assign({}, raw, { scenes: Array.isArray(raw && raw.scenes) && raw.scenes.length ? raw.scenes : [{ name: '_', url: 'https://x.invalid/_' }] }));
  const scenes = Array.isArray(raw && raw.scenes) && raw.scenes.length ? visor.scenes : [];
  const pr = (raw && raw.project) || {};
  const br = (raw && raw.branding) || {};
  const sr = (raw && raw.showroom && typeof raw.showroom === 'object') ? raw.showroom : {};
  const loc = sr.location || {}, ct = sr.contact || {}, seo = sr.seo || {};
  const accent = _hex(br.accent) || '#B89D74';
  const img = g => (typeof g === 'string' ? { url: _https(g), caption: '' } : { url: _https(g && g.url), caption: _str(g && g.caption, 160) });
  const content = {
    tagline: _str(sr.tagline, 200),
    description: _str(sr.description, 4000),
    highlights: _list(sr.highlights, 12).map(x => _str(x, 200)).filter(Boolean),
    amenities: _list(sr.amenities, 30).map(x => _str(x, 120)).filter(Boolean),
    gallery: _list(sr.gallery, 60).map(img).filter(g => g.url),
    plans: _list(sr.plans, 30).map(x => ({ url: _https(x && x.url), title: _str(x && x.title, 120) || 'Plano',
                                          pdf: /\.pdf(\?|$)/i.test(String(x && x.url)) })).filter(x => x.url),
    location: { address: _str(loc.address, 300), map_url: _https(loc.map_url), notes: _str(loc.notes, 500) },
    contact: { cta: _str(ct.cta, 60) || 'Solicitar información', whatsapp: String(ct.whatsapp || '').replace(/[^\d]/g, '').slice(0, 15),
               email: /^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i.test(ct.email || '') ? _str(ct.email, 200) : '', hours: _str(ct.hours, 120) },
    seo: { title: _str(seo.title, 70), description: _str(seo.description, 170) },
    disclaimer: _str(sr.disclaimer, 600),
    // Modelo 3D (fase 7, productos y ambientes): GLB/glTF https, con póster opcional.
    model3d: (() => { const m = sr.model3d || {}; const u = _https(m.url);
      return u && /\.(glb|gltf)(\?|$)/i.test(u) ? { url: u, poster: _https(m.poster), title: _str(m.title, 120) || 'Modelo 3D' } : null; })()
  };
  const sceneCount = scenes.length;
  const spaces = _list(raw && raw.spaces, 2000).map(x => {
    if (!x || typeof x !== 'object') return null;
    const id = _uuid(x.id); if (!id) return null;
    const kind = SPACE_KINDS.includes(x.kind) ? x.kind : null; if (!kind) return null;
    const attrs = {};
    if (x.attributes && typeof x.attributes === 'object' && !Array.isArray(x.attributes)) {
      Object.entries(x.attributes).slice(0, 20).forEach(([k, v]) => { const kk = _str(k, 40); const vv = _str(String(v), 120); if (kk && vv) attrs[kk] = vv; });
    }
    return {
      id, parent_id: _uuid(x.parent_id), kind, name: _str(x.name, 120) || 'Espacio', code: _str(x.code, 40),
      summary: _str(x.summary, 2000), area_m2: _num(x.area_m2, 0, 1e6), bedrooms: _num(x.bedrooms, 0, 50),
      bathrooms: _num(x.bathrooms, 0, 50), parking: _num(x.parking, 0, 50), price: _num(x.price, 0, 1e13),
      currency: /^[A-Z]{3}$/.test(x.currency || '') ? x.currency : 'MXN',
      availability: AVAILABILITY.includes(x.availability) ? x.availability : 'no_aplica',
      attributes: attrs,
      scenes: _list(x.scenes, 60).filter(i => Number.isInteger(i) && i >= 0 && i < sceneCount),
      plan_url: _https(x.plan_url), gallery: _list(x.gallery, 30).map(img).filter(g => g.url),
      price_updated_at: typeof x.price_updated_at === 'string' && !isNaN(Date.parse(x.price_updated_at)) ? x.price_updated_at.slice(0, 10) : null
    };
  }).filter(Boolean);
  const ids = new Set(spaces.map(s => s.id));
  spaces.forEach(s => { if (s.parent_id && !ids.has(s.parent_id)) s.parent_id = null; });

  // Vistas interactivas: render o plano con zonas (unidades, edificios) y
  // puntos de escena 360°. Coordenadas en % de la imagen (0–100).
  const sceneIdx = new Map(scenes.map((sc, i) => [sc.id, i]).filter(([k]) => k));
  const pct = v => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 100) / 100)) : null; };
  const views = _list(sr.views, 8).map((v, vi) => {
    if (!v || typeof v !== 'object') return null;
    const image = _https(v.image); if (!image) return null;
    const regions = _list(v.regions, 300).map(r => {
      const space = _uuid(r && r.space); if (!space || !ids.has(space)) return null;
      const pts = _list(r.points, 80).map(p => Array.isArray(p) ? [pct(p[0]), pct(p[1])] : null).filter(p => p && p[0] !== null && p[1] !== null);
      return pts.length >= 3 ? { space, points: pts } : null;
    }).filter(Boolean);
    const spots = _list(v.spots, 100).map(sp => {
      const i = sceneIdx.get(_uuid(sp && sp.scene)); const x = pct(sp && sp.x), y = pct(sp && sp.y);
      return i != null && x !== null && y !== null ? { scene: i, x, y } : null;
    }).filter(Boolean);
    const w = _num(v.w, 1, 20000), hh = _num(v.h, 1, 20000);
    return { id: _str(v.id, 40).replace(/[^\w-]/g, '') || `v${vi + 1}`, title: _str(v.title, 80) || `Vista ${vi + 1}`,
             kind: v.kind === 'plano' ? 'plano' : 'render', image, ratio: w && hh ? Math.round(w / hh * 1000) / 1000 : 16 / 9, regions, spots };
  }).filter(v => v && (v.regions.length || v.spots.length));
  content.views = views;

  // Avance de obra comercial (fotos e hitos aprobados), distinto del 4D técnico.
  content.progress = _list(sr.progress, 40).map(e => e && typeof e === 'object' ? {
    date: /^\d{4}-\d{2}(-\d{2})?$/.test(e.date || '') ? e.date : '', title: _str(e.title, 120), note: _str(e.note, 600),
    images: _list(e.images, 12).map(img).filter(g => g.url)
  } : null).filter(e => e && (e.title || e.images.length)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  content.area_label = { interior: 'Superficie interior', total: 'Superficie total', construida: 'Superficie construida',
                         terreno: 'Terreno', util: 'Superficie útil' }[sr.area_label] || 'Superficie';
  return {
    title: visor.p, subtitle: visor.sub,
    project: { name: _str(pr.name, 160) || visor.p, subtitle: _str(pr.subtitle, 240), location: _str(pr.location, 240),
               delivery: _str(pr.delivery, 80), kind: ['desarrollo', 'edificio', 'vivienda', 'ambiente', 'producto'].includes(pr.kind) ? pr.kind : 'desarrollo' },
    brand: { name: _str(br.name, 120), logo: _https(br.logo_url), accent, accentText: readableOn(accent) },
    content, scenes, spaces, opening: visor.opening
  };
}

// Mensaje de enlace no utilizable, construido sin innerHTML con datos.
function showLinkError(container, err, variant) {
  const isInvalid = err instanceof ConfigError && err.message !== 'not_found';
  const box = document.createElement('div');
  box.className = 'link-error';
  box.setAttribute('role', 'alert');
  box.style.cssText = variant === 'd5'
    ? 'position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#080810;gap:14px;text-align:center;padding:24px;'
    : 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:var(--muted);font-size:13px;line-height:2;padding:24px;max-width:90vw;';
  const icon = document.createElement('i');
  icon.className = 'ti ti-alert-triangle';
  icon.style.cssText = 'font-size:34px;color:#E24B4A;display:block;margin-bottom:6px;';
  const title = document.createElement('div');
  title.style.cssText = 'color:rgba(255,255,255,.75);font-size:15px;';
  title.textContent = isInvalid ? 'Este enlace no es válido' : 'Link expirado o no disponible';
  const hint = document.createElement('small');
  hint.style.cssText = 'color:var(--muted);';
  hint.textContent = 'Solicita un nuevo link al arquitecto.';
  box.append(icon, title, hint);
  container.appendChild(box);
  console.warn('[AgelArq] Enlace no utilizable:', err && err.message);
}

// Parsea el textarea de detalles: una línea = un bullet.
// Retrocompatible: si el usuario pegó una sola línea con comas, la separa.
function parseDetails(raw) {
  const txt = String(raw ?? '');
  let parts = txt.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0].includes(',') && parts[0].length > 60) {
    parts = parts[0].split(',').map(t => t.trim()).filter(Boolean);
  }
  return parts;
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, safeImgUrl, safeMediaUrl, sanitizeVisorConfig, sanitizeD5Config, sanitizeShowroom, readableOn, parseDetails, ConfigError, CFG_LIMITS };
}
