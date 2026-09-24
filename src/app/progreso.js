// @ts-check
/**
 * Las cuentas del progreso: series por músculo, por patrón y por día. Puro y con test.
 *
 * TODO SE CUENTA EN SERIES, no en kilos. Los kilos no se pueden sumar entre ejercicios —100 kg de
 * sentadilla y 100 kg de curl no son el mismo trabajo— y las revisiones sobre volumen de
 * entrenamiento lo miden en series por músculo y semana. Es la unidad que permite comparar.
 */

/** @typedef {import('./datos.js').Serie} Serie */
/** @typedef {'principal' | 'sinergista' | 'estabilizador'} Rol */
/** @typedef {Partial<Record<Rol, string[]>>} Musculos */

/**
 * Cuánto cuenta una serie para cada músculo según su papel. Principal, entera; el que ayuda, media;
 * el que sostiene la postura, un cuarto.
 *
 * No son porcentajes de activación —eso la electromiografía no lo da—: es la convención de contar
 * «series fraccionadas» que usan las revisiones de volumen para que un press de banca no sume lo
 * mismo al tríceps que al pectoral. Una convención, y por eso la pantalla la explica.
 */
export const PESOS = /** @type {const} */ ({ principal: 1, sinergista: 0.5, estabilizador: 0.25 });

/**
 * Cortes de los tres grados del mapa, en series por semana: 1-4, 5-9 y 10 o más. El de 10 sale de
 * la revisión de Schoenfeld, Ogborn y Krieger (2017), que asocia 10 series semanales o más por
 * músculo con más hipertrofia que menos de 5. Es una referencia para leer el mapa, no una meta.
 */
export const CORTES = /** @type {const} */ ([1, 5, 10]);

/** @param {string} fecha @returns {Date} */
const aFecha = (fecha) => {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(/** @type {number} */ (a), /** @type {number} */ (m) - 1, /** @type {number} */ (d));
};
/** @param {Date} f */
const aTexto = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;

/**
 * La fecha `n` días después (o antes, con `n` negativo). Con fechas locales y no sumando 86 400 000
 * ms: el día del cambio de hora dura 23 o 25 horas, y sumando milisegundos la semana que lo
 * contiene puede repetir un día o saltárselo según el huso del dispositivo.
 *
 * @param {string} fecha @param {number} n
 */
export function sumarDias(fecha, n) {
  const f = aFecha(fecha);
  f.setDate(f.getDate() + n);
  return aTexto(f);
}

/**
 * El lunes de la semana de una fecha. La semana empieza en lunes, como en el calendario de aquí y
 * en la ISO 8601; con el domingo de `getDay()` como inicio, el entreno del domingo contaba para la
 * semana siguiente.
 *
 * @param {string} fecha
 */
export function lunesDe(fecha) {
  const dia = (aFecha(fecha).getDay() + 6) % 7; // 0 = lunes
  return sumarDias(fecha, -dia);
}

/**
 * Series ponderadas por músculo entre dos fechas, ambas incluidas. Si un músculo aparece con dos
 * papeles en la misma ficha, cuenta el más fuerte, una sola vez.
 *
 * @param {Serie[]} series
 * @param {(ejercicio: string) => Musculos | undefined} musculosDe
 * @param {string} desde @param {string} hasta
 * @returns {Record<string, number>}
 */
export function seriesPorMusculo(series, musculosDe, desde, hasta) {
  /** @type {Record<string, number>} */
  const total = {};
  for (const s of series) {
    if (s.fecha < desde || s.fecha > hasta) continue;
    /** @type {Map<string, number>} */
    const peso = new Map();
    const musculos = musculosDe(s.ejercicio) ?? {};
    for (const rol of /** @type {Rol[]} */ (['estabilizador', 'sinergista', 'principal'])) {
      for (const m of musculos[rol] ?? []) peso.set(m, Math.max(peso.get(m) ?? 0, PESOS[rol]));
    }
    for (const [m, p] of peso) total[m] = (total[m] ?? 0) + p;
  }
  return total;
}

/**
 * El grado del mapa para unas series por semana: 0 (nada), 1, 2 o 3.
 * @param {number} porSemana
 */
export function grado(porSemana) {
  return CORTES.filter((c) => porSemana >= c).length;
}

/**
 * Series por grupo —patrón de movimiento— entre dos fechas.
 *
 * @param {Serie[]} series
 * @param {(ejercicio: string) => string | undefined} grupoDe
 * @param {string} desde @param {string} hasta
 * @returns {Record<string, number>}
 */
export function seriesPorGrupo(series, grupoDe, desde, hasta) {
  /** @type {Record<string, number>} */
  const total = {};
  for (const s of series) {
    if (s.fecha < desde || s.fecha > hasta) continue;
    const g = grupoDe(s.ejercicio);
    if (g) total[g] = (total[g] ?? 0) + 1;
  }
  return total;
}

/**
 * La actividad de las últimas `semanas` semanas, hasta la de `hoy` incluida: una columna por
 * semana, de lunes a domingo, con las series de cada día. Los días posteriores a hoy van como
 * `null`: no son días sin entrenar, son días que aún no han llegado, y pintarlos vacíos lo daba a
 * entender.
 *
 * @param {Serie[]} series
 * @param {string} hoy
 * @param {number} semanas
 * @returns {Array<Array<{ fecha: string, series: number } | null>>}
 */
export function actividad(series, hoy, semanas) {
  /** @type {Map<string, number>} */
  const porDia = new Map();
  for (const s of series) porDia.set(s.fecha, (porDia.get(s.fecha) ?? 0) + 1);
  const primerLunes = sumarDias(lunesDe(hoy), -7 * (semanas - 1));
  return Array.from({ length: semanas }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const fecha = sumarDias(primerLunes, w * 7 + d);
      return fecha > hoy ? null : { fecha, series: porDia.get(fecha) ?? 0 };
    }));
}
