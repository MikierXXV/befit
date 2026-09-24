// @ts-check
/**
 * Los datos del visitante, como valores: crear, migrar, limpiar y fusionar.
 *
 * AQUÍ NO HAY localStorage NI DOM, a propósito. Todo lo que decide qué se guarda y qué se pierde
 * vive en funciones puras para poder probarlo con `node --test` sin navegador ni dependencias; el
 * acceso al almacenamiento, con sus try/catch, está en `almacen.ts`. Es la regla que OpenGym
 * aprendió con dos fallos reales de su motor de progresión: lo que decide sobre los datos de alguien
 * lleva test.
 *
 * Y va en JS con JSDoc, no en TypeScript, por lo mismo que `cinematica.js`: Node lo ejecuta tal
 * cual, y el compilador lo lee igual gracias a `allowJs` y a `@ts-check`.
 */

/** Sube cuando cambie la forma de los datos, y con ella una migración en `migrar()`. */
export const VERSION = 1;

/**
 * @typedef {object} Serie
 * @property {string} id           Único por serie: fecha de creación más un sufijo aleatorio.
 * @property {string} ejercicio    Id de la ficha.
 * @property {string} fecha        Día del entreno, `AAAA-MM-DD`, en hora local.
 * @property {number} creada       Marca de tiempo, para ordenar dentro del día.
 * @property {number} [peso]       Kilos. Sin peso es una serie con el propio cuerpo.
 * @property {number} [reps]
 * @property {number} [segundos]   En los ejercicios que se sostienen en vez de repetirse.
 * @property {number} [rir]        Repeticiones en reserva, 0-5, si se anotan.
 */

/**
 * @typedef {object} Datos
 * @property {number} version
 * @property {string[]} favoritos
 * @property {Serie[]} series
 */

/** @returns {Datos} */
export function vacio() {
  return { version: VERSION, favoritos: [], series: [] };
}

const esTexto = (/** @type {unknown} */ x) => typeof x === 'string' && x.length > 0;
const esNumero = (/** @type {unknown} */ x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/**
 * Una serie que llega de fuera —de un fichero importado, o de una versión vieja— se reconstruye
 * campo a campo y no se copia tal cual: lo que no se reconoce se descarta, y lo que no tiene sentido
 * (reps negativas, una fecha que no es fecha) invalida la serie entera en vez de colarse.
 *
 * @param {any} s
 * @returns {Serie | null}
 */
export function normalizarSerie(s) {
  if (!s || typeof s !== 'object') return null;
  if (!esTexto(s.id) || !esTexto(s.ejercicio)) return null;
  if (typeof s.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.fecha)) return null;
  /** @type {Serie} */
  const limpia = { id: s.id, ejercicio: s.ejercicio, fecha: s.fecha, creada: esNumero(s.creada) ? s.creada : 0 };
  for (const campo of /** @type {const} */ (['peso', 'reps', 'segundos', 'rir'])) {
    if (s[campo] === undefined) continue;
    if (!esNumero(s[campo])) return null;
    limpia[campo] = s[campo];
  }
  // Una serie sin repeticiones ni tiempo no dice nada: no se guarda un registro vacío.
  if (limpia.reps === undefined && limpia.segundos === undefined) return null;
  return limpia;
}

/**
 * Lleva cualquier cosa que haya en el almacenamiento a la forma actual.
 *
 * `favoritosViejos` es la lista que la primera versión de befit guardaba suelta bajo la clave
 * `favoritos`. Se incorpora UNA VEZ, al no encontrar datos nuevos: quien ya tenía favoritos no debe
 * perderlos porque la app haya cambiado dónde los guarda.
 *
 * @param {unknown} crudo
 * @param {unknown} [favoritosViejos]
 * @returns {Datos}
 */
export function migrar(crudo, favoritosViejos) {
  const datos = vacio();
  const origen = /** @type {any} */ (crudo);
  if (origen && typeof origen === 'object') {
    if (Array.isArray(origen.favoritos)) datos.favoritos = unicos(origen.favoritos.filter(esTexto));
    if (Array.isArray(origen.series)) datos.series = unicasPorId(origen.series.map(normalizarSerie).filter(esSerie));
  } else if (Array.isArray(favoritosViejos)) {
    datos.favoritos = unicos(favoritosViejos.filter(esTexto));
  }
  return datos;
}

/**
 * Deja fuera los favoritos que ya no existen en el catálogo.
 *
 * Las SERIES no se tocan aunque su ejercicio desaparezca: son el historial de alguien, y un
 * ejercicio retirado del catálogo —pasó con la sentadilla frontal— no borra lo que esa persona
 * levantó. La vista decide cómo enseñarlas.
 *
 * @param {Datos} datos
 * @param {Set<string>} idsCatalogo
 * @returns {Datos}
 */
export function limpiar(datos, idsCatalogo) {
  return { ...datos, favoritos: datos.favoritos.filter((id) => idsCatalogo.has(id)) };
}

/**
 * Junta lo importado con lo que ya hay. SUMA, nunca sustituye: importar el fichero de otro móvil no
 * puede borrar lo que se anotó en este. Una serie repetida —mismo id— se queda con la que ya estaba.
 *
 * @param {Datos} actuales
 * @param {Datos} importados
 * @returns {{ datos: Datos, nuevosFavoritos: number, nuevasSeries: number }}
 */
export function fusionar(actuales, importados) {
  const favoritos = unicos([...actuales.favoritos, ...importados.favoritos]);
  const conocidas = new Set(actuales.series.map((s) => s.id));
  const nuevas = importados.series.filter((s) => !conocidas.has(s.id));
  return {
    datos: { version: VERSION, favoritos, series: [...actuales.series, ...nuevas] },
    nuevosFavoritos: favoritos.length - actuales.favoritos.length,
    nuevasSeries: nuevas.length,
  };
}

/**
 * Lee un fichero exportado. Lanza con un mensaje-clave de `ui.json` si no es un fichero de befit,
 * para que la vista lo traduzca en vez de enseñar un error de JSON.
 *
 * @param {string} texto
 * @returns {Datos}
 */
export function leerExportado(texto) {
  let crudo;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new Error('datos.error_formato');
  }
  if (!crudo || typeof crudo !== 'object' || crudo.app !== 'befit') throw new Error('datos.error_formato');
  if (typeof crudo.version !== 'number' || crudo.version > VERSION) throw new Error('datos.error_version');
  return migrar(crudo);
}

/**
 * El fichero que se descarga. Lleva `app` para reconocerlo al importarlo, y la fecha para que quien
 * tenga varios sepa cuál es el último.
 *
 * @param {Datos} datos
 * @param {Date} [ahora]
 */
export function paraExportar(datos, ahora = new Date()) {
  return JSON.stringify({ app: 'befit', exportado: ahora.toISOString(), ...datos }, null, 2);
}

/** @param {string[]} lista */
function unicos(lista) {
  return [...new Set(lista)];
}

/** @param {Serie[]} lista */
function unicasPorId(lista) {
  const vistas = new Set();
  return lista.filter((s) => (vistas.has(s.id) ? false : (vistas.add(s.id), true)));
}

/** @param {Serie | null} s @returns {s is Serie} */
function esSerie(s) {
  return s !== null;
}
