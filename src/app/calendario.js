// @ts-check
/**
 * El calendario como valores: qué toca cada día y qué se hizo. Puro y con test, como `datos.js` y
 * `rutinas.js`; la vista está en `vistas/calendario.ts`.
 *
 * DOS CAPAS, y la de abajo se repite sola:
 *  - `semana`: una rutina y qué día suyo va en cada día de la semana. Es lo que la gente planifica
 *    de verdad —«lunes torso, jueves pierna»— y no hay que volver a apuntarlo cada semana.
 *  - `cambios`: un día suelto que no sigue la semana, en una fecha concreta: otro día de rutina, o
 *    nada. Mover el entreno del martes al miércoles no debe obligar a rehacer la semana entera.
 *
 * Las FECHAS son `AAAA-MM-DD` en hora local, como las de las series, y se calculan con `Date.UTC`:
 * con la hora local, sumar un día a medianoche el día del cambio de hora daba el mismo día dos veces.
 */

import { LIMITES } from './rutinas.js';

/**
 * @typedef {object} DiaPlaneado
 * @property {string} rutina  Id de una rutina del usuario o de una de inicio.
 * @property {number} dia     Índice del día dentro de la rutina.
 */

/**
 * @typedef {object} Semana
 * @property {string} rutina
 * @property {Array<number | null>} dias  Siete, de LUNES a domingo: el índice del día de rutina, o
 *   `null` si ese día se descansa. Empieza en lunes y no en domingo como `getDay()`: la semana de
 *   entreno se piensa de lunes a domingo, y así el índice es la columna que se pinta.
 * @property {string} desde  Fecha desde la que vale. Los días anteriores no cuentan como «no
 *   hecho»: planificar hoy no puede llenar de faltas las semanas en que aún no había plan.
 */

/**
 * @typedef {object} Calendario
 * @property {Semana | null} semana
 * @property {Record<string, DiaPlaneado | null>} cambios  Por fecha. `null` es «ese día, nada».
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Ida y vuelta, y no solo `Date.parse`: el 31 de febrero lo acepta y lo convierte en 3 de marzo.
const esFecha = (/** @type {unknown} */ x) =>
  typeof x === 'string' && FECHA.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`)) && new Date(`${x}T00:00:00Z`).toISOString().startsWith(x);
const esTexto = (/** @type {unknown} */ x) => typeof x === 'string' && x.trim().length > 0;
const esDia = (/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 0 && /** @type {number} */ (x) < LIMITES.dias;

/**
 * Los cambios sueltos se guardan sin fecha de caducidad, pero no infinitos: un fichero importado
 * podría traer miles. Con este tope caben años de cambios de alguien que los usa a diario.
 */
export const MAX_CAMBIOS = 1000;

/** @returns {Calendario} */
export const calendarioVacio = () => ({ semana: null, cambios: {} });

/** @param {any} d @returns {DiaPlaneado | null} */
function normalizarDiaPlaneado(d) {
  if (!d || typeof d !== 'object' || !esTexto(d.rutina) || !esDia(d.dia)) return null;
  return { rutina: d.rutina, dia: d.dia };
}

/**
 * Reconstruido campo a campo, como las series y las rutinas: puede llegar de un fichero importado.
 * Añadirlo NO subió `VERSION`, igual que los descansos: si falta, es un calendario vacío, y los
 * datos y las copias de antes se leen igual.
 *
 * @param {any} crudo
 * @returns {Calendario}
 */
export function normalizarCalendario(crudo) {
  const limpio = calendarioVacio();
  if (!crudo || typeof crudo !== 'object') return limpio;
  const s = crudo.semana;
  if (s && typeof s === 'object' && esTexto(s.rutina) && Array.isArray(s.dias) && s.dias.length === 7 && esFecha(s.desde)) {
    const dias = s.dias.map((/** @type {unknown} */ d) => (esDia(d) ? /** @type {number} */ (d) : null));
    // Una semana sin ningún día de entreno no planifica nada: se guarda como que no hay semana.
    if (dias.some((/** @type {number | null} */ d) => d !== null)) limpio.semana = { rutina: s.rutina, dias, desde: s.desde };
  }
  if (crudo.cambios && typeof crudo.cambios === 'object' && !Array.isArray(crudo.cambios)) {
    const fechas = Object.keys(crudo.cambios).filter(esFecha).sort().slice(-MAX_CAMBIOS);
    for (const f of fechas) {
      const v = crudo.cambios[f];
      if (v === null) limpio.cambios[f] = null;
      else {
        const d = normalizarDiaPlaneado(v);
        if (d) limpio.cambios[f] = d;
      }
    }
  }
  return limpio;
}

/* ---------------------------------------------------------------- fechas -- */

/** @param {string} fecha */
const aUTC = (fecha) => Date.parse(`${fecha}T00:00:00Z`);
/** @param {number} ms */
const deUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param {string} fecha
 * @param {number} n  Días, positivos o negativos.
 */
export const sumarDias = (fecha, n) => deUTC(aUTC(fecha) + n * 86_400_000);

/** 0 = lunes … 6 = domingo. @param {string} fecha */
export const diaDeLaSemana = (fecha) => (new Date(aUTC(fecha)).getUTCDay() + 6) % 7;

/** El lunes de la semana de esa fecha. @param {string} fecha */
export const lunesDe = (fecha) => sumarDias(fecha, -diaDeLaSemana(fecha));

/** Las siete fechas de la semana, de lunes a domingo. @param {string} fecha */
export const semanaDe = (fecha) => Array.from({ length: 7 }, (_, i) => sumarDias(lunesDe(fecha), i));

/**
 * La cuadrícula de un mes: semanas enteras de lunes a domingo, con los días del mes anterior y del
 * siguiente que completan la primera y la última. Sin ellos, el día 1 no caería bajo su columna.
 *
 * @param {string} fecha  Cualquier día del mes.
 * @returns {string[][]}
 */
export function mesDe(fecha) {
  const mes = fecha.slice(0, 7);
  const semanas = [];
  // Una fila por cada lunes hasta el último que aún cae dentro del mes.
  for (let lunes = lunesDe(`${mes}-01`); lunes.slice(0, 7) <= mes; lunes = sumarDias(lunes, 7)) semanas.push(semanaDe(lunes));
  return semanas;
}

/** El primer día del mes anterior o siguiente. @param {string} fecha @param {number} n */
export function sumarMeses(fecha, n) {
  const total = Number(fecha.slice(0, 4)) * 12 + Number(fecha.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/* ----------------------------------------------------------------- plan -- */

/**
 * Lo que toca un día: el cambio suelto si lo hay, si no la semana —desde que empezó a valer—, y si
 * no, nada. `origen` dice de dónde sale, para que la vista distinga un día movido a mano.
 *
 * @param {Calendario} cal
 * @param {string} fecha
 * @returns {{ plan: DiaPlaneado | null, origen: 'cambio' | 'semana' | 'nada' }}
 */
export function planDeFecha(cal, fecha) {
  if (Object.prototype.hasOwnProperty.call(cal.cambios, fecha)) return { plan: cal.cambios[fecha] ?? null, origen: 'cambio' };
  const s = cal.semana;
  if (s && fecha >= s.desde) {
    const dia = s.dias[diaDeLaSemana(fecha)];
    if (dia !== null && dia !== undefined) return { plan: { rutina: s.rutina, dia }, origen: 'semana' };
  }
  return { plan: null, origen: 'nada' };
}

/**
 * Repartir N días de rutina por la semana, para no hacer elegir siete desplegables al empezar: los
 * días de entreno separados por al menos uno de descanso mientras quepan. Es solo la propuesta
 * inicial; cada día se cambia después.
 *
 * @param {number} n  Días que tiene la rutina.
 * @returns {Array<number | null>}
 */
export function repartir(n) {
  /** @type {Record<number, number[]>} */
  const huecos = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  const dias = /** @type {Array<number | null>} */ (Array(7).fill(null));
  (huecos[Math.max(1, Math.min(7, n))] ?? []).forEach((columna, i) => { dias[columna] = i; });
  return dias;
}

/**
 * Pone un cambio suelto. Si deja el día como ya lo dejaba la semana, el cambio se QUITA en vez de
 * guardarse: si no, cambiar luego la semana no movería ese día, y no habría forma de saber por qué.
 *
 * @param {Calendario} cal
 * @param {string} fecha
 * @param {DiaPlaneado | null | undefined} valor  `undefined` quita el cambio y vuelve a la semana.
 * @returns {Calendario}
 */
export function cambiarDia(cal, fecha, valor) {
  const cambios = { ...cal.cambios };
  delete cambios[fecha];
  if (valor !== undefined) {
    const deSemana = planDeFecha({ ...cal, cambios: {} }, fecha).plan;
    const igual = valor === null ? deSemana === null : !!deSemana && deSemana.rutina === valor.rutina && deSemana.dia === valor.dia;
    if (!igual) cambios[fecha] = valor;
  }
  return { ...cal, cambios };
}

/**
 * Quita del calendario una rutina borrada: su semana y sus cambios. Un plan que apunta a una rutina
 * que ya no existe pintaba días con nombre vacío.
 *
 * @param {Calendario} cal
 * @param {string} rutina
 * @returns {Calendario}
 */
export function sinRutina(cal, rutina) {
  const cambios = Object.fromEntries(Object.entries(cal.cambios).filter(([, v]) => v?.rutina !== rutina));
  return { semana: cal.semana?.rutina === rutina ? null : cal.semana, cambios };
}

/**
 * Junta el calendario importado con el de este dispositivo. Como los descansos, manda el de aquí:
 * la semana importada solo entra si aquí no hay ninguna, y un cambio suelto solo si aquí esa fecha
 * no tiene uno.
 *
 * @param {Calendario} actual
 * @param {Calendario} importado
 * @returns {Calendario}
 */
export function fusionarCalendario(actual, importado) {
  return normalizarCalendario({ semana: actual.semana ?? importado.semana, cambios: { ...importado.cambios, ...actual.cambios } });
}
