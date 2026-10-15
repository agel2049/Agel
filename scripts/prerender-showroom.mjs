#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · pre-generación de showrooms (plan maestro S04: SEO)

   Crea una página HTML estática por cada showroom publicado y público:
       p/<slug>/index.html   (contenido visible sin JavaScript, metadatos,
                              Open Graph y datos estructurados)
       sitemap.xml
   La página usa el mismo renderizador que el navegador y, al abrirse,
   comprueba si hay una versión más nueva y se actualiza sola.

   Uso (desde la raíz del repositorio, con Node 18 o más nuevo):
       node scripts/prerender-showroom.mjs --site https://usuario.github.io/Agel/
   Opciones:
       --site <url>   dirección pública del sitio (para canonical y sitemap)
       --out  <dir>   carpeta de salida (por defecto, la raíz del repositorio)
   Lee supabaseUrl y supabaseAnonKey de config.js (solo la clave pública).
   Variables opcionales (pruebas): AGEL_API_URL y AGEL_ANON_KEY sustituyen a config.js.
   ═══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = require(path.join(ROOT, 'packages/core/schema.js'));
globalThis.esc = schema.esc;
const Showroom = require(path.join(ROOT, 'packages/showroom/render.js'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('--out', ROOT));
let site = arg('--site', '');
if (site && !site.endsWith('/')) site += '/';
if (site && !/^https:\/\//.test(site)) { console.error('--site debe empezar con https://'); process.exit(2); }

function readConfig() {
  if (process.env.AGEL_API_URL && process.env.AGEL_ANON_KEY)
    return { supabaseUrl: process.env.AGEL_API_URL, supabaseAnonKey: process.env.AGEL_ANON_KEY };
  const file = path.join(ROOT, 'config.js');
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'config.js', timeout: 1000 });
  const c = ctx.window.AGEL_CONFIG || {};
  if (!c.supabaseUrl || !c.supabaseAnonKey) throw new Error('config.js no tiene supabaseUrl / supabaseAnonKey');
  return c;
}

const cfg = readConfig();
const api = (process.env.AGEL_API_URL || cfg.supabaseUrl).replace(/\/+$/, '');
async function rpc(fn, body) {
  const res = await fetch(`${api}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseAnonKey, authorization: `Bearer ${cfg.supabaseAnonKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const slugOk = s => /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/.test(s);     // misma regla que la base
const xmlEsc = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const list = await rpc('list_public_publications');
const done = [];
for (const item of list || []) {
  if (item.kind !== 'showroom' || !slugOk(item.slug)) continue;
  const pub = await rpc('get_publication', { p_slug: item.slug });
  if (!pub || !pub.snapshot) continue;
  let m;
  try { m = schema.sanitizeShowroom(pub.snapshot); } catch (e) { console.warn(`omitido ${item.slug}: ${e.message}`); continue; }
  const canonical = site ? `${site}p/${item.slug}/` : '';
  const html = Showroom.renderDocument(m, { root: '../../', slug: item.slug, canonical,
                                             raw: { version: pub.version, snapshot: pub.snapshot } });
  const dir = path.join(out, 'p', item.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  done.push({ slug: item.slug, lastmod: (pub.published_at || '').slice(0, 10) });
  console.log(`p/${item.slug}/  (versión ${pub.version})`);
}

if (site) {
  const urls = done.map(d => `  <url><loc>${xmlEsc(`${site}p/${d.slug}/`)}</loc>${d.lastmod ? `<lastmod>${d.lastmod}</lastmod>` : ''}</url>`);
  fs.writeFileSync(path.join(out, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  console.log('sitemap.xml');
}
console.log(`${done.length} showroom(s) generados en ${path.relative(process.cwd(), out) || '.'}`);
