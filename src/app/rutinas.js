// @ts-check
/**
 * Las rutinas como valores: normalizarlas, copiarlas, compararlas con lo hecho y meterlas en un
 * enlace. Puro y con test, como `datos.js`.
 *
 * Una rutina del usuario tiene la misma forma que una de inicio (`content/<idioma>/rutinas/`) sin
 * lo editorial: sin resumen, sin fuentes, sin matices. Así copiar una de inicio es quitar campos,
 * y no traducir de un formato a otro.
 */

/**
 * @typedef {object} Objetivo
 * @property {string} ejercicio  Id de la ficha.
 * @property {number} series
 * @property {number} min        Repeticiones o segundos, según la `medida` de la ficha.
 * @property {number} max
 */

/**
 * @typedef {object} Dia
 * @property {string} nombre
 * @property {Objetivo[]} ejercicios
 */

/**
 * @typedef {object} Rutina
 * @property {string} id
 * @property {string} nombre
 * @property {Dia[]} dias
 */

/**
 * @typedef {object} Plan
 * @property {string} fecha   El día en que se eligió, `AAAA-MM-DD`. Otro día, el plan ya no vale.
 * @property {string} rutina  Id de una rutina del usuario o de una de inicio.
 * @property {number} dia     Índice del día dentro de la rutina.
 */

export const LIMITES = { nombre: 60, dias: 7, ejercicios: 15, series: 10, valor: 600 };

const esTexto = (/** @type {unknown} */ x) => typeof x === 'string' && x.trim().length > 0;
const entero = (/** @type {unknown} */ x, /** @type {number} */ min, /** @type {number} */ max) =>
  Number.isInteger(x) && /** @type {number} */ (x) >= min && /** @type {number} */ (x) <= max;
const recortar = (/** @type {string} */ s) => s.trim().slice(0, LIMITES.nombre);

/**
 * Un objetivo válido o nada. Con el mínimo por encima del máximo se INTERCAMBIAN en vez de rechazar
 * el ejercicio: al editar, escribir primero el 12 y luego el 8 deja un instante «12-8», y descartar
 * el ejercicio entero por eso se lo llevaba de la rutina sin avisar.
 *
 * @param {any} o
 * @returns {Objetivo | null}
 */
export function normalizarObjetivo(o) {
  if (!o || typeof o !== 'object' || !esTexto(o.ejercicio)) return null;
  if (!entero(o.series, 1, LIMITES.series) || !entero(o.min, 1, LIMITES.valor) || !entero(o.max, 1, LIMITES.valor)) return null;
  return { ejercicio: o.ejercicio, series: o.series, min: Math.min(o.min, o.max), max: Math.max(o.min, o.max) };
}

/**
 * Una rutina reconstruida campo a campo, como las series: lo que llega de un enlace compartido lo
 * ha escrito cualquiera. Los días vacíos se admiten —una rutina a medio montar los tiene—, pero no
 * una rutina sin días.
 *
 * @param {any} r
 * @returns {Rutina | null}
 */
export function normalizarRutina(r) {
  if (!r || typeof r !== 'object' || !esTexto(r.id) || !esTexto(r.nombre) || !Array.isArray(r.dias)) return null;
  const dias = r.dias.slice(0, LIMITES.dias).flatMap((/** @type {any} */ d) => {
    if (!d || typeof d !== 'object' || !esTexto(d.nombre) || !Array.isArray(d.ejercicios)) return [];
    const ejercicios = d.ejercicios.slice(0, LIMITES.ejercicios).map(normalizarObjetivo).filter((/** @type {Objetivo | null} */ o) => o !== null);
    return [{ nombre: recortar(d.nombre), ejercicios }];
  });
  if (!dias.length) return null;
  return { id: r.id, nombre: recortar(r.nombre), dias };
}

/**
 * @param {any} p
 * @returns {Plan | null}
 */
export function normalizarPlan(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) return null;
  if (!esTexto(p.rutina) || !entero(p.dia, 0, LIMITES.dias - 1)) return null;
  return { fecha: p.fecha, rutina: p.rutina, dia: p.dia };
}

/**
 * Copia una rutina —de inicio o del usuario— como rutina nueva del usuario. Se queda solo con lo
 * que se puede editar: una copia que arrastrara fuentes y matices los enseñaría como si siguieran
 * valiendo después de cambiarle la mitad de los ejercicios.
 *
 * @param {Rutina} origen
 * @param {string} id
 * @param {string} nombre
 * @returns {Rutina}
 */
export function copiarRutina(origen, id, nombre) {
  return {
    id,
    nombre: recortar(nombre),
    dias: origen.dias.map((d) => ({ nombre: d.nombre, ejercicios: d.ejercicios.map((o) => ({ ...o })) })),
  };
}

/**
 * Cuántas series lleva hecho cada ejercicio del plan y cuántas quedan.
 *
 * Cuenta las series anotadas HOY de ese ejercicio, se hicieran en el orden que se hicieran: quien
 * adelanta el remo porque la barra de sentadilla está ocupada no tiene que ver el plan descuadrado.
 *
 * @param {Dia} dia
 * @param {Array<{ ejercicio: string }>} seriesDeHoy
 * @returns {Array<Objetivo & { hechas: number, completo: boolean }>}
 */
export function progreso(dia, seriesDeHoy) {
  return dia.ejercicios.map((o) => {
    const hechas = seriesDeHoy.filter((s) => s.ejercicio === o.ejercicio).length;
    return { ...o, hechas, completo: hechas >= o.series };
  });
}

/**
 * Lo mínimo para rehacer una rutina en otro dispositivo, en una cadena que cabe en una URL.
 *
 * Solo ids y números, sin claves: `nombre|día~ejercicio,series,min,max;…|…`. Medido con la de torso
 * y pierna: 2 068 caracteres en JSON y base64, 780 así. Hay apps de mensajería que cortan los
 * enlaces largos sin avisar, y quien lo recibiera abriría una rutina a medias.
 *
 * @param {Rutina} r
 */
export function aEnlace(r) {
  const limpio = (/** @type {string} */ s) => s.replace(/[|~;,]/g, ' ');
  const dias = r.dias.map((d) => `${limpio(d.nombre)}~${d.ejercicios.map((o) => `${o.ejercicio},${o.series},${o.min},${o.max}`).join(';')}`);
  return [limpio(r.nombre), ...dias].join('|');
}

/**
 * La vuelta de `aEnlace`. Pasa por `normalizarRutina`: lo que llega por una URL no se cree.
 *
 * @param {string} texto
 * @param {string} id  El id que tendrá al guardarse, que nunca viaja en el enlace.
 * @returns {Rutina | null}
 */
export function deEnlace(texto, id) {
  const [nombre, ...dias] = texto.split('|');
  return normalizarRutina({
    id,
    nombre,
    dias: dias.map((d) => {
      const [nombreDia, lista = ''] = d.split('~');
      return {
        nombre: nombreDia,
        ejercicios: lista.split(';').filter(Boolean).map((e) => {
          const [ejercicio, series, min, max] = e.split(',');
          return { ejercicio, series: Number(series), min: Number(min), max: Number(max) };
        }),
      };
    }),
  });
}
