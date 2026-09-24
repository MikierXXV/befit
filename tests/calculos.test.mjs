/**
 * Las cuentas del registro. Un 1RM equivocado se ve igual de bien en pantalla que uno bueno: solo
 * lo caza una prueba.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brzycki, epley, evolucion, hoy, mejorMarca, queSeSigue, sesiones, unoRM } from '../src/app/calculos.js';

let n = 0;
const serie = (fecha, extra) => ({ id: `s${(n += 1)}`, ejercicio: 'x', fecha, creada: n, ...extra });

test('las dos fórmulas dan lo publicado para 100 kg × 10', () => {
  assert.equal(Math.round(epley(100, 10) * 10) / 10, 133.3);
  assert.equal(Math.round(brzycki(100, 10) * 10) / 10, 133.3);
});

test('una repetición es el propio peso, no una estimación', () => {
  assert.deepEqual(unoRM(serie('2026-09-24', { peso: 120, reps: 1 })), { kilos: 120, fiable: true });
});

test('el 1RM se redondea a medio kilo, que es lo que se puede cargar', () => {
  const { kilos } = unoRM(serie('2026-09-24', { peso: 60, reps: 8 }));
  assert.equal(kilos * 2, Math.round(kilos * 2));
  assert.ok(kilos > 70 && kilos < 80);
});

test('por encima de 10 repeticiones se avisa de que no es fiable', () => {
  assert.equal(unoRM(serie('2026-09-24', { peso: 40, reps: 10 })).fiable, true);
  assert.equal(unoRM(serie('2026-09-24', { peso: 40, reps: 15 })).fiable, false);
});

test('sin peso, o con demasiadas repeticiones, no hay 1RM', () => {
  assert.equal(unoRM(serie('2026-09-24', { reps: 12 })), null);
  assert.equal(unoRM(serie('2026-09-24', { peso: 0, reps: 12 })), null);
  assert.equal(unoRM(serie('2026-09-24', { peso: 20, reps: 36 })), null);
});

test('qué se sigue depende de lo anotado, no solo de la ficha', () => {
  assert.equal(queSeSigue([serie('2026-09-24', { reps: 8 })], 'reps'), 'reps');
  assert.equal(queSeSigue([serie('2026-09-24', { reps: 8 }), serie('2026-09-25', { peso: 10, reps: 5 })], 'reps'), '1rm');
  assert.equal(queSeSigue([serie('2026-09-24', { segundos: 40 })], 'tiempo'), 'segundos');
});

test('las sesiones van de la más reciente a la más antigua, y cada una en orden', () => {
  const lista = [serie('2026-09-20', { reps: 5 }), serie('2026-09-24', { reps: 7 }), serie('2026-09-24', { reps: 6 })];
  const res = sesiones(lista);
  assert.deepEqual(res.map((s) => s.fecha), ['2026-09-24', '2026-09-20']);
  assert.deepEqual(res[0].series.map((s) => s.reps), [7, 6]);
});

test('la mejor marca a igualdad es la primera vez, no la última', () => {
  const primera = serie('2026-09-01', { reps: 12 });
  const lista = [serie('2026-09-10', { reps: 12 }), primera, serie('2026-09-05', { reps: 9 })];
  assert.equal(mejorMarca(lista, 'reps'), primera);
});

test('la evolución toma lo mejor de cada día y en orden de calendario', () => {
  const lista = [
    serie('2026-09-24', { peso: 60, reps: 8 }),
    serie('2026-09-24', { peso: 60, reps: 5 }),
    serie('2026-09-17', { peso: 55, reps: 8 }),
    serie('2026-09-20', { reps: 8 }),
  ];
  const { tipo, puntos } = evolucion(lista, 'reps');
  assert.equal(tipo, '1rm');
  // El día sin peso no aparece como cero: no aparece.
  assert.deepEqual(puntos.map((p) => p.fecha), ['2026-09-17', '2026-09-24']);
  assert.equal(puntos[1].valor, unoRM(lista[0]).kilos);
});

test('hoy es la fecha del dispositivo, no la de UTC', () => {
  assert.equal(hoy(new Date(2026, 8, 25, 0, 30)), '2026-09-25');
  assert.equal(hoy(new Date(2026, 0, 5)), '2026-01-05');
});
