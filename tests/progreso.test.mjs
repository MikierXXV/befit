/**
 * Las cuentas del progreso. Un músculo contado dos veces por la misma serie, o una semana que
 * empieza en domingo, no se ven en el mapa: solo salen pintados de más o de menos.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actividad, grado, lunesDe, seriesPorGrupo, seriesPorMusculo, sumarDias } from '../src/app/progreso.js';

let n = 0;
const serie = (ejercicio, fecha) => ({ id: `s${(n += 1)}`, ejercicio, fecha, creada: n, reps: 8 });
const MUSCULOS = {
  press: { principal: ['pectoral'], sinergista: ['triceps', 'deltoides_anterior'], estabilizador: ['abdomen'] },
  repetido: { principal: ['gluteo_mayor'], estabilizador: ['gluteo_mayor', 'erectores'] },
};

test('la semana empieza en lunes, también si el día es domingo', () => {
  assert.equal(lunesDe('2026-09-24'), '2026-09-21'); // jueves
  assert.equal(lunesDe('2026-09-27'), '2026-09-21'); // domingo
  assert.equal(lunesDe('2026-09-21'), '2026-09-21'); // lunes
});

test('sumar días atraviesa meses, años y el cambio de hora', () => {
  assert.equal(sumarDias('2026-09-28', 7), '2026-10-05');
  assert.equal(sumarDias('2026-12-29', 5), '2027-01-03');
  // 25 de octubre de 2026: cambio de hora en Europa. Sumando milisegundos, el lunes siguiente podía
  // caer en domingo según el huso del equipo.
  assert.equal(sumarDias('2026-10-19', 7), '2026-10-26');
});

test('cada serie cuenta entera, media o un cuarto según el papel del músculo', () => {
  const r = seriesPorMusculo([serie('press', '2026-09-22'), serie('press', '2026-09-23')], (e) => MUSCULOS[e], '2026-09-21', '2026-09-27');
  assert.deepEqual(r, { pectoral: 2, triceps: 1, deltoides_anterior: 1, abdomen: 0.5 });
});

test('un músculo con dos papeles en la misma ficha cuenta una vez, con el más fuerte', () => {
  const r = seriesPorMusculo([serie('repetido', '2026-09-22')], (e) => MUSCULOS[e], '2026-09-21', '2026-09-27');
  assert.deepEqual(r, { gluteo_mayor: 1, erectores: 0.25 });
});

test('solo cuentan las series dentro del periodo, bordes incluidos', () => {
  const lista = [serie('press', '2026-09-20'), serie('press', '2026-09-21'), serie('press', '2026-09-27'), serie('press', '2026-09-28')];
  assert.equal(seriesPorMusculo(lista, (e) => MUSCULOS[e], '2026-09-21', '2026-09-27').pectoral, 2);
});

test('un ejercicio retirado del catálogo no rompe la cuenta', () => {
  assert.deepEqual(seriesPorMusculo([serie('sentadilla-frontal', '2026-09-22')], (e) => MUSCULOS[e], '2026-09-21', '2026-09-27'), {});
});

test('los grados del mapa: nada, 1-4, 5-9 y 10 o más', () => {
  assert.deepEqual([0, 0.25, 1, 4.9, 5, 9.75, 10, 30].map(grado), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test('series por grupo', () => {
  const grupos = { press: 'empuje-horizontal', repetido: 'bisagra-cadera' };
  const r = seriesPorGrupo([serie('press', '2026-09-22'), serie('press', '2026-09-22'), serie('repetido', '2026-09-23'), serie('otro', '2026-09-23')], (e) => grupos[e], '2026-09-21', '2026-09-27');
  assert.deepEqual(r, { 'empuje-horizontal': 2, 'bisagra-cadera': 1 });
});

test('la actividad va por semanas de lunes a domingo, y el futuro no cuenta como descanso', () => {
  const semanas = actividad([serie('press', '2026-09-22'), serie('press', '2026-09-22'), serie('press', '2026-09-14')], '2026-09-24', 2);
  assert.equal(semanas.length, 2);
  assert.equal(semanas[0][0].fecha, '2026-09-14');
  assert.equal(semanas[0][0].series, 1);
  assert.equal(semanas[1][1].series, 2);
  assert.equal(semanas[1][3].fecha, '2026-09-24');
  assert.equal(semanas[1][4], null);
});
