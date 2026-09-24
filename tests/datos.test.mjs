/**
 * Lo que decide qué datos del visitante se guardan, se migran y se pierden.
 *
 *   npm test
 *
 * Sin dependencias: `node:test` viene con Node. Cada caso es un fallo que costaría datos de alguien
 * si llegara a publicarse, así que se prueba antes de que pase.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, fusionar, leerExportado, limpiar, migrar, normalizarDescansos, normalizarSerie, paraExportar, vacio } from '../src/app/datos.js';

const serie = (id, extra = {}) => ({ id, ejercicio: 'sentadilla-barra', fecha: '2026-09-24', creada: 1, reps: 8, peso: 60, ...extra });

test('sin nada guardado, empieza vacío y en la versión actual', () => {
  assert.deepEqual(migrar(null), { version: VERSION, favoritos: [], series: [], descansos: {} });
});

test('los favoritos de la versión vieja no se pierden al cambiar de clave', () => {
  const datos = migrar(null, ['sentadilla-barra', 'flexiones', 'flexiones']);
  assert.deepEqual(datos.favoritos, ['sentadilla-barra', 'flexiones']);
});

test('si ya hay datos nuevos, la lista vieja se ignora y no vuelve a sumarse', () => {
  const datos = migrar({ version: 1, favoritos: ['dominadas'], series: [] }, ['flexiones']);
  assert.deepEqual(datos.favoritos, ['dominadas']);
});

test('lo que no es un favorito válido se descarta', () => {
  assert.deepEqual(migrar({ favoritos: ['a', '', 3, null, 'b'] }).favoritos, ['a', 'b']);
});

test('una serie se reconstruye campo a campo: lo que no se conoce, fuera', () => {
  const limpia = normalizarSerie({ ...serie('s1'), hackeo: '<script>', notas: 'x' });
  assert.deepEqual(limpia, serie('s1'));
});

test('una serie absurda se rechaza entera, no a medias', () => {
  assert.equal(normalizarSerie(serie('s1', { reps: -3 })), null);
  assert.equal(normalizarSerie(serie('s1', { peso: Number.NaN })), null);
  assert.equal(normalizarSerie(serie('s1', { fecha: 'ayer' })), null);
  assert.equal(normalizarSerie({ id: 's1', ejercicio: 'x', fecha: '2026-09-24' }), null);
});

test('una serie por tiempo, sin repeticiones, es válida', () => {
  const plancha = { id: 'p1', ejercicio: 'plancha-frontal', fecha: '2026-09-24', creada: 1, segundos: 45 };
  assert.deepEqual(normalizarSerie(plancha), plancha);
});

test('series repetidas por id se quedan en una', () => {
  assert.equal(migrar({ series: [serie('s1'), serie('s1', { reps: 99 })] }).series.length, 1);
});

test('limpiar quita favoritos retirados del catálogo pero conserva su historial', () => {
  const datos = { ...vacio(), favoritos: ['sentadilla-frontal', 'flexiones'], series: [serie('s1', { ejercicio: 'sentadilla-frontal' })] };
  const limpios = limpiar(datos, new Set(['flexiones']));
  assert.deepEqual(limpios.favoritos, ['flexiones']);
  assert.equal(limpios.series.length, 1);
});

test('importar suma y nunca borra lo que ya había', () => {
  const aqui = { ...vacio(), favoritos: ['a'], series: [serie('s1')] };
  const fuera = { ...vacio(), favoritos: ['b', 'a'], series: [serie('s1', { reps: 1 }), serie('s2')] };
  const { datos, nuevosFavoritos, nuevasSeries } = fusionar(aqui, fuera);
  assert.deepEqual(datos.favoritos, ['a', 'b']);
  assert.equal(nuevosFavoritos, 1);
  assert.equal(nuevasSeries, 1);
  // La serie repetida se queda con la versión de este dispositivo.
  assert.equal(datos.series.find((s) => s.id === 's1')?.reps, 8);
});

test('exportar e importar devuelve exactamente lo mismo', () => {
  const datos = { ...vacio(), favoritos: ['a'], series: [serie('s1'), serie('s2', { rir: 2 })] };
  assert.deepEqual(leerExportado(paraExportar(datos)), datos);
});

test('un fichero que no es de befit se rechaza con un mensaje traducible', () => {
  assert.throws(() => leerExportado('no es json'), /datos.error_formato/);
  assert.throws(() => leerExportado('{"favoritos":[]}'), /datos.error_formato/);
  assert.throws(() => leerExportado(JSON.stringify({ app: 'befit', version: VERSION + 1 })), /datos.error_version/);
});

test('los descansos absurdos se descartan, uno a uno', () => {
  assert.deepEqual(normalizarDescansos({ a: 90, b: 0, c: 40000, d: 12.5, e: '60', '': 60 }), { a: 90 });
  assert.deepEqual(normalizarDescansos([60]), {});
});

test('una copia de antes de los descansos se sigue leyendo', () => {
  const vieja = JSON.stringify({ app: 'befit', version: 1, favoritos: ['a'], series: [] });
  assert.deepEqual(leerExportado(vieja).descansos, {});
});

test('al importar, el descanso ajustado en este dispositivo manda', () => {
  const aqui = { ...vacio(), descansos: { a: 90 } };
  const fuera = { ...vacio(), descansos: { a: 30, b: 120 } };
  assert.deepEqual(fusionar(aqui, fuera).datos.descansos, { a: 90, b: 120 });
});
