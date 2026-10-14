// Verifica una página HTML de la app:
//   • todos sus scripts (en línea y módulos locales con src relativo) parsean,
//   • todo onclick/oninput/... apunta a una función que existe,
//   • ninguna función se declara dos veces en el mismo ámbito global.
// Uso: node tests/syntax.js index.html [apps/panel/index.html ...]
const fs = require('fs');
const path = require('path');

let failures = 0;
for (const file of process.argv.slice(2)) {
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const sources = [];
  for (const m of html.matchAll(/<script(?![^>]*type="module")([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = /src="([^"]+)"/.exec(m[1]);
    if (src) {
      if (/^https?:/.test(src[1])) continue;
      const f = path.join(dir, src[1].split('?')[0]);
      if (!fs.existsSync(f)) { failures++; console.log(`${file}: no existe ${src[1]}`); continue; }
      sources.push({ name: src[1], code: fs.readFileSync(f, 'utf8') });
    } else if (m[2].trim()) {
      sources.push({ name: 'en línea', code: m[2] });
    }
  }
  let bad = 0;
  sources.forEach(s => { try { new Function(s.code); } catch (e) { bad++; console.log(`${file} · ${s.name}: ${e.message}`); } });
  const js = sources.map(s => s.code).join('\n');
  const declared = new Set([...js.matchAll(/\bfunction\s+([\w$]+)/g)].map(m => m[1]));
  const calls = new Set();
  for (const m of html.matchAll(/\son(?:click|input|change|dragover|dragleave|drop|keydown|submit)="([^"]+)"/g))
    for (const c of m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(c[1]);
  const builtin = new Set(['confirm', 'alert', 'parseInt', 'String', 'Number', 'event']);
  const missing = [...calls].filter(c => !declared.has(c) && !builtin.has(c));
  if (missing.length) { bad++; console.log(`${file}: botones sin función: ${missing.join(', ')}`); }
  // duplicados solo dentro de un mismo archivo (cada módulo tiene su propio ámbito)
  for (const s of sources) {
    const names = [...s.code.matchAll(/^function\s+([\w$]+)/gm)].map(m => m[1]);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length) { bad++; console.log(`${file} · ${s.name}: funciones declaradas dos veces: ${[...new Set(dup)].join(', ')}`); }
  }
  failures += bad;
  console.log(`${bad ? 'FALLO' : 'OK   '} ${file} — ${sources.length} script(s), ${declared.size} funciones`);
}
process.exit(failures ? 1 : 0);
