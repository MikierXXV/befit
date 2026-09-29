/**
 * El calendario: qué toca cada día. Un fallo aquí planifica el entreno en el día que no es, o llena
 * de faltas semanas en que aún no había plan, y quien lo usa deja de fiarse de él.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cambiarDia, calendarioVacio, diaDeLaSemana, fusionarCalendario, lunesDe, mesDe, normalizarCalendario, planDeFecha, repartir,
  semanaDe, sinRutina, sumarDias, sumarMeses,
} from '../src/app/calendario.js';
import { fusionar, migrar, vacio } from '../src/app/datos.js';

// El 28 de septiembre de 2026 es lunes.
const semana = { rutina: 'torso-pierna', dias: [0, null, null, 1, null, null, null], desde: '2026-09-28' };
const cal = { semana, cambios: {} };

test('las fechas cruzan meses, años y el cambio de hora sin repetir ni saltar días', () => {
  assert.equal(sumarDias('2026-09-30', 1), '2026-10-01');
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  // 25 de octubre de 2026: cambio de hora en Europa.
  assert.equal(sumarDias('2026-10-25', 1), '2026-10-26');
  assert.equal(diaDeLaSemana('2026-09-28'), 0);
  assert.equal(diaDeLaSemana('2026-10-04'), 6);
  assert.equal(lunesDe('2026-10-04'), '2026-09-28');
  assert.deepEqual(semanaDe('2026-10-01'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
});

test('el mes va en semanas enteras de lunes a domingo, con el día 1 bajo su columna', () => {
  const sep = mesDe('2026-09-15');
  assert.equal(sep[0][0], '2026-08-31');
  assert.equal(sep[0][1], '2026-09-01');
  assert.equal(sep.at(-1).at(-1), '2026-10-04');
  assert.ok(sep.every((s) => s.length === 7));
  // Febrero de 2027 empieza en lunes y acaba en domingo: cuatro filas, sin días de otros meses.
  const feb = mesDe('2027-02-10');
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0], '2027-02-01');
  assert.equal(feb[3][6], '2027-02-28');
  assert.equal(sumarMeses('2026-12-15', 1), '2027-01-01');
  assert.equal(sumarMeses('2026-01-15', -1), '2025-12-01');
});

test('la semana se repite, pero no antes de que empezara a valer', () => {
  assert.deepEqual(planDeFecha(cal, '2026-10-05'), { plan: { rutina: 'torso-pierna', dia: 0 }, origen: 'semana' });
  assert.deepEqual(planDeFecha(cal, '2026-10-08'), { plan: { rutina: 'torso-pierna', dia: 1 }, origen: 'semana' });
  assert.deepEqual(planDeFecha(cal, '2026-10-06'), { plan: null, origen: 'nada' });
  // El lunes anterior no tenía plan: no puede salir como un entreno que no se hizo.
  assert.deepEqual(planDeFecha(cal, '2026-09-21'), { plan: null, origen: 'nada' });
});

test('un cambio suelto manda sobre la semana, también para quitar el entreno', () => {
  let c = cambiarDia(cal, '2026-10-05', null);
  assert.deepEqual(planDeFecha(c, '2026-10-05'), { plan: null, origen: 'cambio' });
  c = cambiarDia(c, '2026-10-06', { rutina: 'torso-pierna', dia: 0 });
  assert.deepEqual(planDeFecha(c, '2026-10-06').plan, { rutina: 'torso-pierna', dia: 0 });
  // Volver a la semana quita el cambio.
  c = cambiarDia(c, '2026-10-05', undefined);
  assert.equal('2026-10-05' in c.cambios, false);
});

test('un cambio que deja el día como ya lo dejaba la semana no se guarda', () => {
  assert.deepEqual(cambiarDia(cal, '2026-10-05', { rutina: 'torso-pierna', dia: 0 }).cambios, {});
  assert.deepEqual(cambiarDia(cal, '2026-10-06', null).cambios, {});
});

test('repartir separa los días de entreno con descansos mientras quepan', () => {
  assert.deepEqual(repartir(2), [0, null, null, 1, null, null, null]);
  assert.deepEqual(repartir(3), [0, null, 1, null, 2, null, null]);
  assert.equal(repartir(7).filter((d) => d !== null).length, 7);
});

test('lo que llega de fuera se reconstruye y lo absurdo se descarta', () => {
  assert.deepEqual(normalizarCalendario(null), calendarioVacio());
  assert.deepEqual(normalizarCalendario({ semana: { ...semana, dias: [0, 1] } }).semana, null);
  assert.deepEqual(normalizarCalendario({ semana: { ...semana, dias: Array(7).fill(null) } }).semana, null);
  assert.deepEqual(normalizarCalendario({ semana: { ...semana, dias: [0, 'x', -1, 9, 1.5, null, 2] } }).semana.dias, [0, null, null, null, null, null, 2]);
  const c = normalizarCalendario({ cambios: { '2026-10-05': null, '2026-02-31': null, ayer: null, '2026-10-06': { rutina: 'r', dia: 99 }, '2026-10-07': { rutina: 'r', dia: 1 } } });
  assert.deepEqual(c.cambios, { '2026-10-05': null, '2026-10-07': { rutina: 'r', dia: 1 } });
});

test('borrar una rutina la saca del calendario', () => {
  const c = sinRutina({ semana, cambios: { '2026-10-06': { rutina: 'torso-pierna', dia: 0 }, '2026-10-07': { rutina: 'otra', dia: 0 }, '2026-10-08': null } }, 'torso-pierna');
  assert.equal(c.semana, null);
  assert.deepEqual(c.cambios, { '2026-10-07': { rutina: 'otra', dia: 0 }, '2026-10-08': null });
});

test('al importar, el calendario de este dispositivo manda', () => {
  const fuera = { semana: { ...semana, rutina: 'otra' }, cambios: { '2026-10-05': null, '2026-10-06': { rutina: 'otra', dia: 0 } } };
  const aqui = { semana, cambios: { '2026-10-05': { rutina: 'torso-pierna', dia: 1 } } };
  const junto = fusionarCalendario(aqui, fuera);
  assert.equal(junto.semana.rutina, 'torso-pierna');
  assert.deepEqual(junto.cambios['2026-10-05'], { rutina: 'torso-pierna', dia: 1 });
  assert.deepEqual(junto.cambios['2026-10-06'], { rutina: 'otra', dia: 0 });
  // Sin semana aquí, entra la importada.
  assert.equal(fusionarCalendario(calendarioVacio(), fuera).semana.rutina, 'otra');
});

test('los datos de antes, sin calendario, se leen con uno vacío; y el calendario viaja en la copia', () => {
  assert.deepEqual(migrar({ version: 1, favoritos: [], series: [] }).calendario, calendarioVacio());
  const { datos } = fusionar(vacio(), { ...vacio(), calendario: cal });
  assert.deepEqual(datos.calendario, cal);
});
