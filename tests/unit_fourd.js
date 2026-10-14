#!/usr/bin/env node
// Pruebas del módulo 4D (calendarios de TimeLiner / MS Project y estados por fecha).
// Uso: node tests/unit_fourd.js
'use strict';
const assert = require('assert');
const F = require('../packages/bim/fourd.js');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('CSV de TimeLiner en español con punto y coma y día/mes', () => {
  const csv = '﻿Nombre;ID de visualización;Inicio planificado;Fin planificado;Inicio real;Fin real;Tipo de tarea;Asociado\n' +
    'Cimentación;1;13/01/2026 08:00;30/01/2026 17:00;14/01/2026;02/02/2026;Construir;Cimentación\n' +
    'Losa N1;1.1;02/02/2026;20/02/2026;;;Construir;Nivel 1\n' +
    '"Cimbra; tramo ""A""";1.2;02/02/2026;25/02/2026;;;Temporal;Nivel 1\n' +
    'Muro existente;2;01/03/2026;05/03/2026;;;Demoler;Existente\n';
  const r = F.fromCSV(csv);
  assert.strictEqual(r.order, 'dmy');
  assert.strictEqual(r.tasks.length, 4);
  const [a, b, c, d] = r.tasks;
  assert.deepStrictEqual([a.planned_start, a.planned_end, a.actual_start, a.actual_end], ['2026-01-13', '2026-01-30', '2026-01-14', '2026-02-02']);
  assert.strictEqual(b.parent_external_id, '1');
  assert.strictEqual(c.name, 'Cimbra; tramo "A"');
  assert.strictEqual(c.task_type, 'temporal');
  assert.strictEqual(d.task_type, 'demoler');
  assert.strictEqual(a.attached, 'Cimentación');
  assert.deepStrictEqual(r.warnings, []);
});

test('CSV en inglés mes/día se detecta y fechas inválidas avisan', () => {
  const csv = 'Name,Planned Start,Planned End,Task Type\nSlab,1/15/2026,1/30/2026,Construct\nBad,2/31/2026,3/2/2026,Construct\n';
  const r = F.fromCSV(csv);
  assert.strictEqual(r.order, 'mdy');
  assert.strictEqual(r.tasks[0].planned_start, '2026-01-15');
  assert.strictEqual(r.tasks[1].planned_start, null);
  assert.ok(r.warnings.some(w => w.includes('2/31/2026')));
});

test('sin columna de nombre no importa nada', () => {
  const r = F.fromCSV('foo,bar\n1,2\n');
  assert.strictEqual(r.tasks.length, 0);
  assert.ok(r.warnings[0].includes('nombre'));
});

test('fechas invertidas e ids repetidos se corrigen con aviso', () => {
  const r = F.fromCSV('Name,ID,Planned Start,Planned End\nA,7,2026-03-10,2026-03-01\nB,7,2026-03-01,2026-03-02\n');
  assert.strictEqual(r.tasks[0].planned_start, '2026-03-01');
  assert.notStrictEqual(r.tasks[0].external_id, r.tasks[1].external_id);
  assert.strictEqual(r.warnings.length, 2);
});

test('XML de Microsoft Project con jerarquía', () => {
  const xml = `<?xml version="1.0"?><Project><Tasks>
    <Task><UID>0</UID><Name>Proyecto</Name><OutlineLevel>0</OutlineLevel></Task>
    <Task><UID>1</UID><Name>Estructura &amp; losas</Name><OutlineLevel>1</OutlineLevel><Start>2026-02-01T08:00:00</Start><Finish>2026-04-30T17:00:00</Finish></Task>
    <Task><UID>2</UID><Name>Losa N1</Name><OutlineLevel>2</OutlineLevel><Start>2026-02-01T08:00:00</Start><Finish>2026-02-20T17:00:00</Finish><ActualStart>2026-02-03T08:00:00</ActualStart></Task>
    <Task><UID>3</UID><Name>Losa N2</Name><OutlineLevel>2</OutlineLevel><Start>2026-02-21T08:00:00</Start><Finish>2026-03-10T17:00:00</Finish></Task>
    <Task><UID>4</UID><Name>Acabados</Name><OutlineLevel>1</OutlineLevel><Start>2026-05-01T08:00:00</Start><Finish>2026-06-30T17:00:00</Finish></Task>
  </Tasks></Project>`;
  const r = F.parseSchedule(xml, 'obra.xml');
  assert.strictEqual(r.tasks.length, 4);
  assert.strictEqual(r.tasks[0].name, 'Estructura & losas');
  assert.strictEqual(r.tasks[1].parent_external_id, '1');
  assert.strictEqual(r.tasks[2].parent_external_id, '1');
  assert.strictEqual(r.tasks[3].parent_external_id, undefined);
  assert.strictEqual(r.tasks[1].actual_start, '2026-02-03');
});

test('estados por tipo de tarea, como TimeLiner', () => {
  const t = (type) => ({ type, planned_start: '2026-02-01', planned_end: '2026-02-10' });
  const seq = type => ['2026-01-31', '2026-02-01', '2026-02-10', '2026-02-11'].map(d => F.taskState(t(type), d, 'planned'));
  assert.deepStrictEqual(seq('construir'), ['oculto', 'construyendo', 'construyendo', 'normal']);
  assert.deepStrictEqual(seq('demoler'), ['normal', 'demoliendo', 'demoliendo', 'oculto']);
  assert.deepStrictEqual(seq('temporal'), ['oculto', 'temporal', 'temporal', 'oculto']);
});

test('modo real: sin inicio real la obra no aparece', () => {
  const task = { type: 'construir', planned_start: '2026-02-01', planned_end: '2026-02-10', actual_start: null, actual_end: null };
  assert.strictEqual(F.taskState(task, '2026-02-20', 'planned'), 'normal');
  assert.strictEqual(F.taskState(task, '2026-02-20', 'actual'), 'oculto');
  task.actual_start = '2026-02-05';
  assert.strictEqual(F.taskState(task, '2026-02-20', 'actual'), 'construyendo');
});

test('stateAt combina tareas sobre el mismo elemento', () => {
  const tasks = [
    { type: 'construir', planned_start: '2026-01-01', planned_end: '2026-01-31', dbids: [1, 2] },
    { type: 'demoler', planned_start: '2026-03-01', planned_end: '2026-03-05', dbids: [2] }];
  const s = F.stateAt(tasks, '2026-03-02');
  assert.strictEqual(s.get(1), 'normal');
  assert.strictEqual(s.get(2), 'demoliendo');
  assert.strictEqual(F.stateAt(tasks, '2025-12-31').get(2), 'normal');   // la demolición aún no empieza
});

test('atrasos planeado contra real', () => {
  const v = F.variance([
    { name: 'A', planned_start: '2026-01-01', planned_end: '2026-01-10', actual_end: '2026-01-15' },
    { name: 'B', planned_start: '2026-01-01', planned_end: '2026-01-10' },
    { name: 'C', planned_start: '2026-01-01', planned_end: '2026-02-10' },
    { name: 'D', planned_start: '2026-01-01', planned_end: '2026-01-10', actual_end: '2026-01-10' }], '2026-01-20');
  assert.deepStrictEqual(v.map(x => [x.name, x.days, x.status]),
    [['C', 19, 'inicio atrasado'], ['B', 10, 'sin iniciar, atrasada'], ['A', 5, 'terminó tarde']]);
});

test('vínculos automáticos por nombre de conjunto', () => {
  const r = F.autoLinks(
    [{ external_id: '1', name: 'Losa', attached: 'Nivel 1' }, { external_id: '2', name: 'Fachada', attached: 'Fachada Norte' },
     { external_id: '3', name: 'Mixto', attached: 'nivel 1; Nivel 2' }],
    [{ source_id: 'a', level: 'Nivel 1' }, { source_id: 'b', level: 'NIVEL 1' }, { source_id: 'c', level: 'Nivel 2' }]);
  assert.deepStrictEqual(r.links, [{ external_id: '1', source_ids: ['a', 'b'] }, { external_id: '3', source_ids: ['a', 'b', 'c'] }]);
  assert.deepStrictEqual(r.missing, ['Fachada']);
});

test('rango de fechas', () => {
  const r = F.range([{ planned_start: '2026-02-01', planned_end: '2026-03-01', actual_end: '2026-03-09' }, { planned_start: '2026-01-15', planned_end: '2026-01-20' }], 'both');
  assert.deepStrictEqual(r, { start: '2026-01-15', end: '2026-03-09' });
});

let ok = 0;
for (const [name, fn] of tests) {
  try { fn(); ok++; console.log(`PASS   ${name}`); }
  catch (e) { console.log(`FAIL   ${name}\n       ${e.message.split('\n').join('\n       ')}`); }
}
console.log(`\n${ok}/${tests.length} pruebas 4D superadas`);
process.exit(ok === tests.length ? 0 : 1);
