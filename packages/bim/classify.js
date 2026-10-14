/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · clasificación de elementos BIM (fase 4, plan "MEP")

   De las propiedades que entrega el visor (Revit/Navisworks) obtiene:
   disciplina, sistema, nivel, zona, categoría y etapa. Primero lee las
   propiedades conocidas (en inglés y español); luego aplica las reglas del
   proyecto (classification_rules), que siempre ganan. Lo que no se pueda
   clasificar queda como "sin_clasificar" para revisarlo, nunca se inventa.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const PROPS = {
    category: ['category', 'categoria', 'revit category', 'categoria de revit'],
    level: ['level', 'nivel', 'reference level', 'nivel de referencia', 'base constraint', 'restriccion de base',
            'schedule level', 'nivel de planificacion', 'base level', 'nivel base'],
    system: ['system name', 'nombre de sistema', 'system type', 'tipo de sistema', 'system classification', 'clasificacion de sistema'],
    phase: ['phase created', 'fase de creacion', 'phase', 'fase'],
    zone: ['zone', 'zona', 'room', 'habitacion', 'space', 'espacio', 'area']
  };

  // Categorías → disciplina. Se compara por inclusión, en inglés y español.
  const DISCIPLINES = [
    ['Protección contra incendio', ['sprinkler', 'rociador', 'fire alarm', 'alarma de incendio']],
    ['Mecánica (HVAC)', ['duct', 'conducto', 'air terminal', 'terminal de aire', 'mechanical equipment', 'equipo mecanico', 'equipos mecanicos', 'flex duct']],
    ['Hidrosanitaria', ['pipe', 'tuberia', 'plumbing', 'aparato sanitario', 'aparatos sanitarios', 'accesorio de tuberia', 'flex pipe']],
    ['Eléctrica', ['cable tray', 'bandeja de cables', 'bandeja', 'conduit', 'tubo', 'electrical', 'electric', 'electrico', 'electrica',
                   'lighting', 'luminaria', 'iluminacion', 'communication', 'comunicacion', 'data device', 'dispositivo de datos']],
    ['Estructura', ['structural', 'estructural', 'foundation', 'cimentacion', 'rebar', 'armadura', 'pilar estructural']],
    ['Arquitectura', ['wall', 'muro', 'door', 'puerta', 'window', 'ventana', 'floor', 'suelo', 'piso', 'ceiling', 'techo', 'roof', 'cubierta',
                      'stair', 'escalera', 'railing', 'barandilla', 'baranda', 'curtain', 'muro cortina', 'casework', 'mobiliario', 'furniture', 'generic model', 'modelo generico']]
  ];
  const FIRE_SYSTEM = /fire|incendio|rociad|sprink/;

  function findProp(props, names) {
    for (const p of props) {
      const n = norm(p.displayName);
      if (names.includes(n) && p.displayValue !== '' && p.displayValue != null) return String(p.displayValue).trim();
    }
    return '';
  }

  function disciplineFor(category, system) {
    const c = norm(category), s = norm(system);
    if (!c && !s) return '';
    if (FIRE_SYSTEM.test(s)) return 'Protección contra incendio';
    for (const [d, keys] of DISCIPLINES) if (keys.some(k => c.includes(k))) return d;
    return '';
  }

  function ruleMatches(rule, props) {
    const target = norm(rule.property);
    const p = props.find(x => norm(x.displayName) === target || norm(`${x.displayCategory}/${x.displayName}`) === target);
    const val = p ? String(p.displayValue == null ? '' : p.displayValue) : null;
    if (rule.operator === 'exists') return val != null && val !== '';
    if (val == null) return false;
    const a = norm(val), b = norm(rule.value);
    switch (rule.operator) {
      case 'contains': return a.includes(b);
      case 'starts_with': return a.startsWith(b);
      case 'regex': try { return new RegExp(rule.value, 'i').test(val); } catch (_) { return false; }
      default: return a === b;
    }
  }

  /**
   * @param el    { dbId, name, externalId, properties: [{displayCategory, displayName, displayValue}] }
   * @param rules filas de classification_rules (ya ordenadas por position)
   * @returns fila para upsert_element_mappings
   */
  function classify(el, rules) {
    const props = el.properties || [];
    const out = {
      source_id: String(el.externalId || ''), dbid: el.dbId, name: String(el.name || '').slice(0, 300),
      category: findProp(props, PROPS.category), level: findProp(props, PROPS.level), system: findProp(props, PROPS.system),
      phase: findProp(props, PROPS.phase), zone: findProp(props, PROPS.zone), discipline: ''
    };
    out.discipline = disciplineFor(out.category, out.system);
    let viaRule = false;
    for (const r of rules || []) {
      if (r.enabled === false) continue;
      if (ruleMatches(r, props)) { out[r.field] = r.set_value; viaRule = true; }
    }
    out.classification = viaRule ? 'regla' : out.discipline ? 'propiedad' : 'sin_clasificar';
    // Propiedades útiles para buscar después (recortadas, sin todo el volcado).
    const keep = {};
    for (const p of props.slice(0, 200)) {
      if (p.hidden || p.displayValue === '' || p.displayValue == null) continue;
      const k = `${p.displayCategory || ''}/${p.displayName}`.slice(0, 80);
      if (Object.keys(keep).length < 40) keep[k] = String(p.displayValue).slice(0, 200);
    }
    out.props = keep;
    for (const k of ['category', 'level', 'system', 'phase', 'zone']) out[k] = String(out[k]).slice(0, 120);
    return out;
  }

  /** Resumen para avisar: cuántos quedaron sin clasificar y por qué. */
  function summary(rows) {
    const s = { total: rows.length, sin_clasificar: 0, sin_nivel: 0, sin_id: 0, por_disciplina: {} };
    for (const r of rows) {
      if (!r.source_id) s.sin_id++;
      if (r.classification === 'sin_clasificar') s.sin_clasificar++;
      if (!r.level) s.sin_nivel++;
      const d = r.discipline || 'sin clasificar';
      s.por_disciplina[d] = (s.por_disciplina[d] || 0) + 1;
    }
    return s;
  }

  const api = { classify, summary, disciplineFor, ruleMatches, PROPS, DISCIPLINES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgelClassify = api;
})(typeof window !== 'undefined' ? window : globalThis);
