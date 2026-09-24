/**
 * Las rutinas: lo que entra, lo que se copia, lo que se cuenta como hecho y lo que viaja en un
 * enlace. Una rutina rota por un enlace mal leído llega a otro móvil como una rutina a medias, y
 * quien la recibe no tiene forma de saberlo.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { aEnlace, copiarRutina, deEnlace, normalizarObjetivo, normalizarPlan, normalizarRutina, progreso } from '../src/app/rutinas.js';

const o = (ejercicio, series = 3, min = 8, max = 12) => ({ ejercicio, series, min, max });
const rutina = { id: 'r1', nombre: 'Torso y pierna', dias: [{ nombre: 'Torso A', ejercicios: [o('press-banca', 3, 6, 10), o('remo-barra')] }, { nombre: 'Pierna A', ejercicios: [o('plancha-lateral', 3, 20, 40)] }] };

test('un rango escrito al revés se endereza en vez de perder el ejercicio', () => {
  assert.deepEqual(normalizarObjetivo(o('x', 3, 12, 8)), o('x', 3, 8, 12));
});

test('un objetivo absurdo se descarta', () => {
  assert.equal(normalizarObjetivo(o('x', 0)), null);
  assert.equal(normalizarObjetivo(o('x', 3, 8, 9999)), null);
  assert.equal(normalizarObjetivo(o('x', 2.5)), null);
  assert.equal(normalizarObjetivo({ ...o('x'), ejercicio: '' }), null);
});

test('la rutina se reconstruye: lo desconocido fuera, los días vacíos se admiten', () => {
  const r = normalizarRutina({ ...rutina, fuentes: ['x'], dias: [...rutina.dias, { nombre: 'Día 3', ejercicios: [] }] });
  assert.equal(r.dias.length, 3);
  assert.equal('fuentes' in r, false);
  assert.equal(normalizarRutina({ ...rutina, dias: [] }), null);
});

test('copiar una rutina de inicio se queda con lo editable y no comparte objetos', () => {
  const inicio = { ...rutina, resumen: 'r', fuentes: [{ titulo: 't' }], matices: 'm' };
  const copia = copiarRutina(inicio, 'u1', 'Mi torso y pierna');
  assert.deepEqual(Object.keys(copia).sort(), ['dias', 'id', 'nombre']);
  copia.dias[0].ejercicios[0].series = 5;
  assert.equal(inicio.dias[0].ejercicios[0].series, 3);
});

test('el progreso cuenta las series de hoy de cada ejercicio, en el orden que sea', () => {
  const hoy = [{ ejercicio: 'remo-barra' }, { ejercicio: 'press-banca' }, { ejercicio: 'remo-barra' }, { ejercicio: 'remo-barra' }];
  const [press, remo] = progreso(rutina.dias[0], hoy);
  assert.deepEqual([press.hechas, press.completo], [1, false]);
  assert.deepEqual([remo.hechas, remo.completo], [3, true]);
});

test('el plan de hoy se valida', () => {
  assert.deepEqual(normalizarPlan({ fecha: '2026-09-24', rutina: 'r1', dia: 1 }), { fecha: '2026-09-24', rutina: 'r1', dia: 1 });
  assert.equal(normalizarPlan({ fecha: 'hoy', rutina: 'r1', dia: 1 }), null);
  assert.equal(normalizarPlan({ fecha: '2026-09-24', rutina: 'r1', dia: -1 }), null);
});

test('una rutina va y vuelve por el enlace sin perder nada', () => {
  assert.deepEqual(deEnlace(aEnlace(rutina), 'r1'), rutina);
});

test('los separadores dentro de un nombre no rompen el enlace', () => {
  const rara = { ...rutina, nombre: 'Lunes | martes; ~ok, sí' };
  const vuelta = deEnlace(aEnlace(rara), 'r1');
  assert.equal(vuelta.dias.length, 2);
  assert.equal(vuelta.dias[1].ejercicios[0].ejercicio, 'plancha-lateral');
});

test('un enlace manipulado no cuela ejercicios imposibles', () => {
  const r = deEnlace('Hack|Día~press-banca,3,8,12;remo-barra,99,1,1;,3,8,12', 'r1');
  assert.deepEqual(r.dias[0].ejercicios.map((e) => e.ejercicio), ['press-banca']);
  assert.equal(deEnlace('', 'r1'), null);
});

test('las rutinas de inicio del contenido pasan por la misma puerta sin perder nada', () => {
  for (const f of readdirSync('content/es/rutinas')) {
    const r = JSON.parse(readFileSync(`content/es/rutinas/${f}`, 'utf8'));
    const n = normalizarRutina(r);
    assert.deepEqual(n.dias.map((d) => d.ejercicios), r.dias.map((d) => d.ejercicios), f);
  }
});
