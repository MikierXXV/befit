// @ts-check
/**
 * Las cuentas del registro: 1RM estimado, sesiones, mejor marca y evolución.
 *
 * Puro y con test, como `datos.js`, y por lo mismo: es lo que le dice a alguien cuánto levanta. Un
 * 1RM que sale el doble por confundir kilos con repeticiones no lo ve ninguna captura, porque en la
 * pantalla un número equivocado parece exactamente igual que uno bueno.
 *
 * befit ENSEÑA los datos y no decide por nadie: aquí no hay «la semana que viene, 2,5 kg más». La
 * progresión automática es lo que más fallos le ha dado a OpenGym (#278), y equivocarse ahí es
 * cargar a alguien de más.
 */

/** @typedef {import('./datos.js').Serie} Serie */
/** @typedef {'reps' | 'tiempo'} Medida */

/**
 * Por encima de esto las fórmulas se separan entre sí y de la realidad. Las dos se ajustaron con
 * series cortas: a 15 repeticiones Epley y Brzycki ya discrepan más de un 5 %, y a 20 casi un 10.
 */
export const REPS_FIABLES = 10;

/**
 * Epley: peso · (1 + reps / 30).
 * @param {number} peso @param {number} reps
 */
export const epley = (peso, reps) => (reps === 1 ? peso : peso * (1 + reps / 30));

/**
 * Brzycki: peso · 36 / (37 − reps). Se va a infinito en 37, y por eso tiene tope.
 * @param {number} peso @param {number} reps
 */
export const brzycki = (peso, reps) => (reps === 1 ? peso : peso * 36 / (37 - reps));

/**
 * El 1RM estimado de una serie: la media de las dos fórmulas, redondeada a medio kilo, que es lo
 * que se puede cargar en una barra. Una sola fórmula daría una precisión que ninguna de las dos
 * tiene; la media al menos no se casa con el sesgo de una.
 *
 * Nulo si no hay peso —un 1RM de 0 kg no es un dato, es un hueco— o si las repeticiones son tantas
 * que la estimación ya no significa nada.
 *
 * @param {Serie} s
 * @returns {{ kilos: number, fiable: boolean } | null}
 */
export function unoRM(s) {
  if (!s.peso || !s.reps || s.reps >= 30) return null;
  const media = (epley(s.peso, s.reps) + brzycki(s.peso, s.reps)) / 2;
  return { kilos: Math.round(media * 2) / 2, fiable: s.reps <= REPS_FIABLES };
}

/**
 * Qué se sigue de un ejercicio a lo largo del tiempo.
 *
 * Con peso, el 1RM estimado: compara una serie de 5 con otra de 8, que el peso solo no puede. Sin
 * peso —flexiones, dominadas—, las repeticiones de la mejor serie. Y en los isométricos, los
 * segundos. Se decide por lo anotado y no por la ficha: quien hace dominadas con lastre pasa a
 * seguir kilos en cuanto anota el primero.
 *
 * @param {Serie[]} series
 * @param {Medida} medida
 * @returns {'1rm' | 'reps' | 'segundos'}
 */
export function queSeSigue(series, medida) {
  if (medida === 'tiempo') return 'segundos';
  return series.some((s) => unoRM(s)) ? '1rm' : 'reps';
}

/**
 * El valor de una serie en lo que se sigue. Nulo si esa serie no lo tiene: una serie sin peso no
 * cuenta en una gráfica de 1RM, en vez de contar como cero y hundir la línea.
 *
 * @param {Serie} s
 * @param {'1rm' | 'reps' | 'segundos'} tipo
 */
export function valor(s, tipo) {
  if (tipo === '1rm') return unoRM(s)?.kilos ?? null;
  if (tipo === 'reps') return s.reps ?? null;
  return s.segundos ?? null;
}

/**
 * Las series agrupadas por día, del más reciente al más antiguo, y dentro de cada día en el orden
 * en que se hicieron.
 *
 * @param {Serie[]} series
 * @returns {Array<{ fecha: string, series: Serie[] }>}
 */
export function sesiones(series) {
  /** @type {Map<string, Serie[]>} */
  const porDia = new Map();
  for (const s of series) {
    const dia = porDia.get(s.fecha) ?? [];
    dia.push(s);
    porDia.set(s.fecha, dia);
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([fecha, lista]) => ({ fecha, series: lista.slice().sort((a, b) => a.creada - b.creada) }));
}

/**
 * La mejor serie según lo que se sigue. A igualdad, la más antigua: la marca es de cuando se hizo
 * por primera vez, no de la última vez que se igualó.
 *
 * @param {Serie[]} series
 * @param {Medida} medida
 * @returns {Serie | null}
 */
export function mejorMarca(series, medida) {
  const tipo = queSeSigue(series, medida);
  /** @type {Serie | null} */
  let mejor = null;
  let tope = -Infinity;
  for (const s of series.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.creada - b.creada))) {
    const v = valor(s, tipo);
    if (v !== null && v > tope) { tope = v; mejor = s; }
  }
  return mejor;
}

/**
 * Un punto por día con lo mejor de ese día, del más antiguo al más reciente, para la gráfica.
 *
 * El mejor y no la media: una última serie floja por cansancio no dice que ese día se fuera a
 * menos, y con la media la línea bajaba cada vez que alguien hacía una serie de más.
 *
 * @param {Serie[]} series
 * @param {Medida} medida
 * @returns {{ tipo: '1rm' | 'reps' | 'segundos', puntos: Array<{ fecha: string, valor: number }> }}
 */
export function evolucion(series, medida) {
  const tipo = queSeSigue(series, medida);
  const puntos = [];
  for (const { fecha, series: delDia } of sesiones(series).reverse()) {
    const valores = delDia.map((s) => valor(s, tipo)).filter((v) => v !== null);
    if (valores.length) puntos.push({ fecha, valor: Math.max(.../** @type {number[]} */ (valores)) });
  }
  return { tipo, puntos };
}

/**
 * El día de hoy, `AAAA-MM-DD`, en la hora DEL DISPOSITIVO.
 *
 * No `toISOString().slice(0, 10)`: eso es la fecha en UTC, y quien anota pasada la medianoche
 * en Madrid —las 00:30 en verano son las 22:30 UTC del día anterior— acabaría con la serie apuntada
 * en el día que no era.
 *
 * @param {Date} [ahora]
 */
export function hoy(ahora = new Date()) {
  const dos = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

/**
 * Los ejercicios de un día, en el orden en que se EMPEZARON, con sus series.
 *
 * Por la primera serie y no por la última: si al orden lo mandara la última, anotar una serie en el
 * primer ejercicio del día lo mandaba al final de la lista y todo saltaba de sitio bajo el dedo.
 *
 * @param {Serie[]} series
 * @param {string} fecha
 * @returns {Array<{ ejercicio: string, series: Serie[] }>}
 */
export function ejerciciosDelDia(series, fecha) {
  /** @type {Map<string, Serie[]>} */
  const porEjercicio = new Map();
  for (const s of series.filter((x) => x.fecha === fecha).sort((a, b) => a.creada - b.creada)) {
    const lista = porEjercicio.get(s.ejercicio) ?? [];
    lista.push(s);
    porEjercicio.set(s.ejercicio, lista);
  }
  return [...porEjercicio.entries()].map(([ejercicio, lista]) => ({ ejercicio, series: lista }));
}

/**
 * Kilos movidos: peso × repeticiones, sumado. Las series sin peso o por tiempo no suman, en vez de
 * sumar cero y hacer creer que cuentan.
 *
 * @param {Serie[]} series
 */
export const volumen = (series) => series.reduce((total, s) => total + (s.peso && s.reps ? s.peso * s.reps : 0), 0);

/**
 * Segundos en formato de reloj: 90 → «1:30», 5 → «0:05». Redondea HACIA ARRIBA, como cualquier
 * cuenta atrás: con 0,4 s por delante enseña «0:01» y llega a «0:00» justo cuando suena. Hacia
 * abajo marcaría «0:00» casi un segundo antes de sonar, y eso parece un temporizador roto.
 *
 * @param {number} segundos
 */
export function reloj(segundos) {
  const s = Math.max(0, Math.ceil(segundos - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
