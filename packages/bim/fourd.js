/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · 4D (plan maestro, fase 5)

   1. Lee calendarios exportados de Navisworks TimeLiner (CSV) o de
      Microsoft Project (XML) y los convierte al formato de import_schedule().
   2. Calcula el estado de cada elemento en una fecha (construir, demoler,
      temporal) con fechas planeadas o reales, como TimeLiner.
   3. Reporta atrasos (planeado contra real).
   Sin dependencias; funciona en el navegador y en Node (pruebas).
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // ── CSV ──────────────────────────────────────────────────────────────
  function detectDelimiter(text) {
    const line = String(text).split(/\r?\n/).find(l => l.trim()) || '';
    const count = c => line.split(c).length - 1;
    return [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  }
  function parseCSV(text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    delim = delim || detectDelimiter(text);
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(x => x.trim() !== '')) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some(x => x.trim() !== '')) rows.push(row);
    return rows;
  }

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // Encabezados reconocidos (inglés y español, como los exporta TimeLiner).
  const COLS = {
    name: ['name', 'nombre', 'task name', 'nombre de tarea', 'tarea'],
    external_id: ['display id', 'id de visualizacion', 'id', 'task id', 'id de tarea', 'unique id', 'uid'],
    wbs: ['wbs', 'edt', 'outline number', 'numero de esquema'],
    planned_start: ['planned start', 'inicio planificado', 'inicio previsto', 'inicio planeado', 'start', 'inicio', 'comienzo'],
    planned_end: ['planned end', 'fin planificado', 'fin previsto', 'fin planeado', 'finish', 'end', 'fin'],
    actual_start: ['actual start', 'inicio real', 'comienzo real'],
    actual_end: ['actual end', 'fin real', 'actual finish'],
    task_type: ['task type', 'tipo de tarea', 'tipo'],
    attached: ['attached', 'asociado', 'adjunto', 'conjunto', 'selection set', 'conjunto de seleccion'],
    responsible: ['responsible', 'responsable', 'resource names', 'recursos'],
    parent: ['parent', 'padre', 'parent id', 'id padre']
  };
  function mapHeaders(header) {
    const h = header.map(norm), map = {};
    for (const [key, names] of Object.entries(COLS)) {
      const i = h.findIndex(x => names.includes(x));
      if (i >= 0) map[key] = i;
    }
    return map;
  }

  // ── fechas ───────────────────────────────────────────────────────────
  // Devuelve [y, m, d] o null. order: 'dmy' | 'mdy' | 'ymd'
  function splitDate(s, order) {
    s = String(s || '').trim();
    if (!s || /^(n\/?a|ninguno|none|-)$/i.test(s)) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return [+m[1], +m[2], +m[3]];
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (!m) return null;
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    return order === 'mdy' ? [y, a, b] : [y, b, a];
  }
  function guessOrder(values) {
    let dmy = 0, mdy = 0;
    for (const v of values) {
      const m = String(v || '').match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/);
      if (!m) continue;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    }
    return mdy > dmy ? 'mdy' : 'dmy';        // en México el formato habitual es día/mes
  }
  function toISO(parts) {
    if (!parts) return null;
    const [y, m, d] = parts;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return dt.toISOString().slice(0, 10);
  }

  function taskType(s) {
    const n = norm(s);
    if (!n) return 'construir';
    if (/demol|demolish|demolition|remove/.test(n)) return 'demoler';
    if (/tempor/.test(n)) return 'temporal';
    if (/constru|construct|build/.test(n)) return 'construir';
    return n;                                   // desconocido: el servidor avisa y usa construir
  }

  // Padre a partir de un esquema "1.2.3" → "1.2".
  const parentOf = code => { const s = String(code || ''); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(0, i) : null; };

  function fromCSV(text) {
    const rows = parseCSV(text);
    const warnings = [];
    if (rows.length < 2) return { tasks: [], warnings: ['El archivo no tiene filas de tareas'] };
    const map = mapHeaders(rows[0]);
    if (map.name == null) return { tasks: [], warnings: ['No se encontró la columna de nombre (Name / Nombre)'] };
    if (map.planned_start == null || map.planned_end == null) warnings.push('No se encontraron columnas de inicio y fin planeados');
    const body = rows.slice(1);
    const dateCols = ['planned_start', 'planned_end', 'actual_start', 'actual_end'].filter(k => map[k] != null);
    const order = guessOrder(body.flatMap(r => dateCols.map(k => r[map[k]])));
    const get = (r, k) => map[k] != null ? String(r[map[k]] || '').trim() : '';
    const seen = new Set();
    const tasks = body.map((r, i) => {
      const t = {
        external_id: get(r, 'external_id') || get(r, 'wbs') || String(i + 1),
        name: get(r, 'name') || `Tarea ${i + 1}`,
        wbs: get(r, 'wbs'),
        task_type: taskType(get(r, 'task_type')),
        responsible: get(r, 'responsible'),
        attached: get(r, 'attached')
      };
      for (const k of dateCols) {
        const raw = get(r, k), iso = toISO(splitDate(raw, order));
        t[k] = iso;
        if (raw && !iso && !/^(n\/?a|ninguno|none|-)$/i.test(raw)) warnings.push(`Fila ${i + 2}: fecha no reconocida "${raw}"`);
      }
      if (t.planned_start && t.planned_end && t.planned_end < t.planned_start) {
        warnings.push(`Fila ${i + 2}: "${t.name}" termina antes de empezar; se invirtieron las fechas`);
        [t.planned_start, t.planned_end] = [t.planned_end, t.planned_start];
      }
      if (seen.has(t.external_id)) { warnings.push(`Fila ${i + 2}: id repetido "${t.external_id}"`); t.external_id += `-${i + 1}`; }
      seen.add(t.external_id);
      const p = get(r, 'parent') || parentOf(t.wbs || (map.external_id != null ? t.external_id : ''));
      if (p) t.parent_external_id = p;
      return t;
    });
    return { tasks, warnings, order };
  }

  // ── Microsoft Project XML ────────────────────────────────────────────
  function xmlText(block, tag) {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim() : '';
  }
  function fromMSProjectXML(text) {
    const warnings = [];
    const blocks = String(text).match(/<Task>[\s\S]*?<\/Task>/g) || [];
    if (!blocks.length) return { tasks: [], warnings: ['El XML no contiene tareas de Microsoft Project'] };
    const stack = [];
    const tasks = [];
    for (const b of blocks) {
      const uid = xmlText(b, 'UID'), level = Number(xmlText(b, 'OutlineLevel')) || 1;
      const name = xmlText(b, 'Name');
      if (uid === '0' || !name) continue;        // tarea resumen del proyecto
      const d = tag => { const v = xmlText(b, tag); return v ? toISO(splitDate(v, 'ymd')) : null; };
      const t = { external_id: uid, name, wbs: xmlText(b, 'WBS') || xmlText(b, 'OutlineNumber'), task_type: 'construir',
                  planned_start: d('Start'), planned_end: d('Finish'), actual_start: d('ActualStart'), actual_end: d('ActualFinish'),
                  responsible: '' };
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length) t.parent_external_id = stack[stack.length - 1].id;
      stack.push({ level, id: uid });
      tasks.push(t);
    }
    return { tasks, warnings };
  }

  function parseSchedule(text, filename) {
    const isXML = /\.xml$/i.test(filename || '') || /^\s*(<\?xml|<Project)/.test(String(text));
    return isXML ? fromMSProjectXML(text) : fromCSV(text);
  }

  // ── vínculos tarea ↔ elementos ───────────────────────────────────────
  // TimeLiner asocia tareas a conjuntos de selección. Si el nombre del
  // conjunto coincide con un nivel, zona o sistema de los elementos
  // clasificados, se generan los vínculos por source_id.
  function autoLinks(tasks, elements, fields = ['level', 'zone', 'system', 'phase']) {
    const index = new Map();
    for (const e of elements) for (const f of fields) {
      const k = norm(e[f]); if (!k) continue;
      if (!index.has(k)) index.set(k, new Set());
      index.get(k).add(e.source_id);
    }
    const links = [], missing = [];
    for (const t of tasks) {
      if (!t.attached) continue;
      const ids = new Set();
      String(t.attached).split(/[;|]/).map(norm).filter(Boolean).forEach(k => (index.get(k) || []).forEach(id => ids.add(id)));
      if (ids.size) links.push({ external_id: t.external_id, source_ids: [...ids] });
      else missing.push(t.name);
    }
    return { links, missing };
  }

  // ── estado en una fecha ──────────────────────────────────────────────
  const STATES = ['oculto', 'normal', 'construyendo', 'demoliendo', 'temporal'];
  function taskWindow(t, mode) {
    if (mode === 'actual') return [t.actual_start || null, t.actual_end || null];
    return [t.planned_start || null, t.planned_end || null];
  }
  /** Estado de una tarea en `date` (YYYY-MM-DD). */
  function taskState(t, date, mode) {
    const [s, e] = taskWindow(t, mode);
    const type = t.type || t.task_type || 'construir';
    const before = !s || date < s, after = !!e && date > e;
    const during = !before && !after;
    if (type === 'demoler') return before ? 'normal' : during ? 'demoliendo' : 'oculto';
    if (type === 'temporal') return during ? 'temporal' : 'oculto';
    return before ? 'oculto' : during ? 'construyendo' : 'normal';
  }
  /**
   * Estado de cada elemento (por dbid) en una fecha. Si varias tareas tocan
   * el mismo elemento gana la de estado más "activo", como en TimeLiner.
   * Elementos sin tarea no aparecen (se muestran normales).
   */
  function stateAt(tasks, date, mode = 'planned') {
    const rank = { oculto: 0, normal: 1, temporal: 2, demoliendo: 3, construyendo: 3 };
    const out = new Map();
    for (const t of tasks) {
      if (!t.dbids || !t.dbids.length) continue;
      const st = taskState(t, date, mode);
      for (const id of t.dbids) {
        const prev = out.get(id);
        if (prev == null || rank[st] > rank[prev]) out.set(id, st);
      }
    }
    return out;
  }

  function range(tasks, mode) {
    let lo = null, hi = null;
    for (const t of tasks) for (const d of mode === 'both'
      ? [t.planned_start, t.planned_end, t.actual_start, t.actual_end] : taskWindow(t, mode)) {
      if (!d) continue;
      if (!lo || d < lo) lo = d;
      if (!hi || d > hi) hi = d;
    }
    return { start: lo, end: hi };
  }

  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  /** Atrasos al día `today`: tareas que debían terminar y no tienen fin real, o terminaron después. */
  function variance(tasks, today) {
    const out = [];
    for (const t of tasks) {
      if (!t.planned_end) continue;
      if (t.actual_end) {
        const d = dayDiff(t.planned_end, t.actual_end);
        if (d !== 0) out.push({ name: t.name, id: t.id || t.external_id, days: d, status: d > 0 ? 'terminó tarde' : 'terminó antes' });
      } else if (today > t.planned_end) {
        out.push({ name: t.name, id: t.id || t.external_id, days: dayDiff(t.planned_end, today), status: t.actual_start ? 'en curso, atrasada' : 'sin iniciar, atrasada' });
      } else if (t.planned_start && today > t.planned_start && !t.actual_start) {
        out.push({ name: t.name, id: t.id || t.external_id, days: dayDiff(t.planned_start, today), status: 'inicio atrasado' });
      }
    }
    return out.sort((a, b) => b.days - a.days);
  }

  function addDays(iso, n) {
    const d = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  const api = { parseCSV, detectDelimiter, fromCSV, fromMSProjectXML, parseSchedule, autoLinks,
                taskState, stateAt, range, variance, addDays, dayDiff, toISO, splitDate, guessOrder, taskType, STATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgelFourD = api;
})(typeof window !== 'undefined' ? window : globalThis);
