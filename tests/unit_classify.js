#!/usr/bin/env node
// Pruebas de clasificación BIM. Uso: node tests/unit_classify.js
'use strict';
const assert = require('assert');
const C = require('../packages/bim/classify.js');
const tests = [];
const test = (n, f) => tests.push([n, f]);
const P = (cat, name, value) => ({ displayCategory: cat, displayName: name, displayValue: value });

test('ducto de Revit en inglés', () => {
  const r = C.classify({ dbId: 7, externalId: 'abc-1', name: 'Rectangular Duct', properties: [
    P('Element', 'Category', 'Ducts'), P('Constraints', 'Reference Level', 'Level 3'), P('Mechanical', 'System Name', 'Supply Air 2')] }, []);
  assert.deepStrictEqual([r.discipline, r.level, r.system, r.category, r.classification], ['Mecánica (HVAC)', 'Level 3', 'Supply Air 2', 'Ducts', 'propiedad']);
  assert.strictEqual(r.source_id, 'abc-1');
});

test('tubería contra incendio en español gana por el sistema', () => {
  const r = C.classify({ dbId: 1, externalId: 'x', properties: [P('Elemento', 'Categoría', 'Tuberías'), P('Restricciones', 'Nivel de referencia', 'N2'),
    P('Mecánico', 'Clasificación de sistema', 'Protección contra incendios húmeda')] }, []);
  assert.strictEqual(r.discipline, 'Protección contra incendio');
  assert.strictEqual(r.level, 'N2');
});

test('eléctrica, estructura y arquitectura', () => {
  assert.strictEqual(C.disciplineFor('Cable Trays', ''), 'Eléctrica');
  assert.strictEqual(C.disciplineFor('Luminarias', ''), 'Eléctrica');
  assert.strictEqual(C.disciplineFor('Structural Framing', ''), 'Estructura');
  assert.strictEqual(C.disciplineFor('Muros', ''), 'Arquitectura');
  assert.strictEqual(C.disciplineFor('Pipe Fittings', 'Domestic Cold Water'), 'Hidrosanitaria');
});

test('sin datos queda sin clasificar (no se inventa)', () => {
  const r = C.classify({ dbId: 2, externalId: 'y', name: 'Solid', properties: [P('Item', 'Type', 'Solid')] }, []);
  assert.strictEqual(r.classification, 'sin_clasificar');
  assert.strictEqual(r.discipline, '');
});

test('las reglas del proyecto ganan y respetan su orden', () => {
  const rules = [
    { field: 'discipline', property: 'Layer', operator: 'starts_with', value: 'E-', set_value: 'Eléctrica', enabled: true },
    { field: 'level', property: 'Item/Layer', operator: 'regex', value: '^E-N(\\d+)', set_value: 'Nivel por capa', enabled: true },
    { field: 'zone', property: 'Comments', operator: 'contains', value: 'torre a', set_value: 'Torre A', enabled: false }];
  const r = C.classify({ dbId: 3, externalId: 'z', properties: [P('Item', 'Layer', 'E-N3-ALUMBRADO'), P('Item', 'Comments', 'Torre A sótano')] }, rules);
  assert.deepStrictEqual([r.discipline, r.level, r.zone, r.classification], ['Eléctrica', 'Nivel por capa', '', 'regla']);
});

test('regex inválida no rompe', () => {
  assert.strictEqual(C.ruleMatches({ property: 'Name', operator: 'regex', value: '([' }, [P('', 'Name', 'x')]), false);
});

test('resumen para el aviso de calidad', () => {
  const rows = [{ source_id: 'a', classification: 'propiedad', level: 'N1', discipline: 'Eléctrica' },
                { source_id: '', classification: 'sin_clasificar', level: '', discipline: '' }];
  assert.deepStrictEqual(C.summary(rows), { total: 2, sin_clasificar: 1, sin_nivel: 1, sin_id: 1, por_disciplina: { 'Eléctrica': 1, 'sin clasificar': 1 } });
});

test('props se recortan', () => {
  const many = Array.from({ length: 300 }, (_, i) => P('C', 'p' + i, 'v'.repeat(500)));
  const r = C.classify({ dbId: 1, externalId: 'q', properties: many }, []);
  assert.ok(Object.keys(r.props).length <= 40 && Object.values(r.props).every(v => v.length <= 200));
});

let ok = 0;
for (const [n, f] of tests) { try { f(); ok++; console.log('PASS   ' + n); } catch (e) { console.log('FAIL   ' + n + '\n       ' + e.message); } }
console.log(`\n${ok}/${tests.length} pruebas de clasificación superadas`);
process.exit(ok === tests.length ? 0 : 1);
