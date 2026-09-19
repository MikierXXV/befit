/**
 * Lenguaje gráfico común de las visualizaciones.
 *
 * ES LA PIEZA QUE HACE QUE N VISUALIZACIONES DISTINTAS SE SIENTAN DEL MISMO SISTEMA. Toda pieza
 * —SVG, física o 3D— pasa por aquí. Si una necesita saltarse una de estas funciones, o la regla
 * está mal o la pieza está mal; no se resuelve con una excepción local, porque la primera excepción
 * es la que autoriza a la segunda.
 */

import { temaActual, type Tema } from '../app/tema';
import { t } from '../app/textos';

export type { Tema };
export { temaActual };

/** Grosores de trazo. Tres, y ninguno más: cada grosor extra es un matiz que nadie sabrá leer. */
export const TRAZO = { fino: 1, base: 1.5, enfasis: 3 } as const;

/**
 * Radio mínimo de un nodo que se toca, en unidades del `viewBox`.
 *
 * Sale de una cuenta, no del gusto: dentro del visor la escala real se queda alrededor de 1,1–1,35
 * —depende de cuánto alto se lleven los controles de cada pieza— y el mínimo táctil que exige la
 * WCAG son 24 píxeles. Con radio 9 los nodos se quedan entre 20 y 23,8: cerca, pero por debajo.
 * Con 11 pasan de 24 incluso en el caso peor.
 *
 * Más grande, quien lo necesite. Por debajo de esto, no: deja de poder tocarse.
 */
export const RADIO_TACTIL = 11;

/**
 * Cuánto se apaga lo que ha quedado en segundo plano.
 *
 * Y LA REGLA QUE LO ACOMPAÑA: **NUNCA SOBRE TEXTO.** Atenuar un rótulo con opacidad no lo vuelve
 * discreto, lo vuelve ilegible, y no es cuestión de afinar el número: un secundario que da 6,2:1 a
 * plena opacidad se queda en 1,7 al 0,35, y en tema claro ni siquiera 0,75 llega al 4,5 que se
 * exige. No existe una atenuación que sea a la vez perceptible y legible.
 *
 * El segundo plano se dice atenuando la FORMA —la caja, el trazo, el arco— y dejando el rótulo
 * intacto. El estado ya viaja además en el color y en el discontinuo del trazo, que es donde de
 * verdad se lee.
 */
export const ATENUADO = 0.35;

/** Proporción única del hueco de visualización. El marco común es lo que crea la familia. */
export const PROPORCION = 7 / 3;

/**
 * Regla de tres colores: nunca más roles que estos.
 *
 * `neutro` es la estructura, `acento` identifica la familia, `senal` marca lo único que el usuario
 * debe mirar ahora. Una pieza con cuatro colores es una pieza en la que nada destaca.
 */
export interface Paleta {
  neutro: string;
  acento: string;
  senal: string;
}

/** Acentos por familia, uno por tema. Los inyecta el arranque desde el contenido. */
type Acentos = Record<string, { claro: string; oscuro: string }>;
let ACENTOS: Acentos = {};

/**
 * Registra los acentos del contenido. Se llama una vez, al arrancar.
 *
 * Están en el contenido y no en design/tokens.json a propósito: el acento identifica una familia
 * concreta del tema tratado, así que nace y muere con ella. Lo que sí es diseño —y por tanto vive
 * en los tokens— son los umbrales que esos acentos tienen que cumplir.
 */
export function registrarAcentos(acentos: Acentos): void {
  ACENTOS = acentos;
}

export function movimientoReducido(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Paleta de una familia.
 *
 * CADA FAMILIA DECLARA DOS ACENTOS, no uno. El modo oscuro no es invertir: un color calibrado para
 * leerse sobre papel pierde contraste sobre un fondo casi negro, y al medir una paleta de acento
 * único lo normal es que falle la mitad de las comprobaciones. El schema lo exige y
 * scripts/check-contraste.mjs lo verifica en ambos temas antes de cada despliegue.
 */
export function paletaDe(familiaId: string, tema: Tema = temaActual()): Paleta {
  const acento = ACENTOS[familiaId]?.[tema];
  if (!acento) throw new Error(`Familia sin acento registrado: ${familiaId}`);
  return {
    neutro: tema === 'claro' ? '#5C5850' : '#A8A39A',
    acento,
    senal: tema === 'claro' ? '#1A1917' : '#EDEBE6',
  };
}

/** Contrato de toda visualización. `destruir` no es opcional: ver la nota de escena3d.ts. */
export interface Visualizacion {
  destruir(): void;
}

/**
 * Alternativa textual de la pieza.
 *
 * OBLIGATORIA EN TODAS, no solo en las 3D. Una visualización que solo se entiende viéndola deja
 * fuera a quien usa lector de pantalla y a quien tiene el ancho de banda justo. Si la alternativa
 * no se puede escribir, la pieza no está explicando nada que se pueda explicar: eso es un defecto
 * de la pieza, no de la alternativa.
 */
export function alternativaTextual(contenedor: HTMLElement, texto: string): void {
  const p = document.createElement('p');
  p.className = 'vis-alternativa';
  p.textContent = texto;
  contenedor.append(p);
}

/**
 * Cierre de la pieza: qué se supone que el usuario ha entendido.
 *
 * Va aparte de la alternativa textual porque cumplen funciones distintas: la alternativa describe
 * lo que se ve, esta dice lo que significa. Una pieza sin resolución es una animación bonita.
 */
export function resolver(contenedor: HTMLElement, texto: string): void {
  const p = document.createElement('p');
  p.className = 'vis-resolucion';
  p.textContent = texto;
  contenedor.append(p);
}

/**
 * La caja con la proporción única, donde va el dibujo y nada más.
 *
 * EXISTE PORQUE EL DIBUJO Y EL TEXTO NO PUEDEN COMPARTIR CAJA. La caja recorta lo que se sale
 * —tiene que hacerlo: un trazo desbordado ensuciaría la página— y la resolución de la pieza es
 * texto que va debajo, no dentro. Con una sola caja, la resolución se escribía y no se veía nunca:
 * el peor de los fallos, porque no hay ningún síntoma que lo delate.
 */
export function crearLienzo(contenedor: HTMLElement): HTMLElement {
  const lienzo = document.createElement('div');
  lienzo.className = 'vis-lienzo';
  contenedor.append(lienzo);
  return lienzo;
}

/** Tamaño al que debe VERSE un rótulo, en píxeles de pantalla, sea cual sea el ancho del hueco. */
const TAM_ROTULO_PX = 15;
/**
 * Lado mínimo de un objetivo táctil, en píxeles de pantalla. WCAG 2.1, criterio 2.5.8.
 *
 * Se apunta un 5 % por encima, no justo al límite. Calcular el radio exacto deja el resultado
 * rozando los 24 px, y entre el redondeo del navegador y el punto flotante unas veces cae dentro y
 * otras fuera: una comprobación que falla la mitad de las veces y sin motivo aparente es una
 * comprobación que alguien acaba desactivando. El mismo criterio que con el contraste.
 */
const MIN_TACTIL_PX = 24 * 1.05;

/**
 * Detalle del evento `vis:escala`, que el SVG emite al crearse y cada vez que cambia de tamaño.
 *
 * `radioTactil` viene en unidades del viewBox y ya trae la conversión hecha: aplicándolo tal cual,
 * el nodo mide 24 píxeles reales en cualquier pantalla.
 */
export interface Escala {
  /** Cuántos píxeles de pantalla mide una unidad del viewBox. */
  escala: number;
  radioTactil: number;
  /**
   * Cuerpo de los rótulos en unidades del viewBox, el mismo valor que recibe `--tam-rotulo`.
   *
   * Hace falta para colocar, no solo para dibujar. Rótulos y nodos táctiles crecen en unidades al
   * estrecharse la pantalla, pero una distancia escrita a mano —«el rótulo, 44 unidades por debajo»—
   * no crece: en el eje, a 360 px, los polos quedaban encima de la marca. Toda separación entre
   * cosas que se agrandan se calcula con esto y con `radioTactil`.
   */
  tamRotulo: number;
}

/**
 * Lienzo SVG con el marco común. Usarlo es lo que garantiza la proporción única.
 *
 * Y ADEMÁS AJUSTA LO QUE SE DIBUJA AL TAMAÑO REAL DE LA PANTALLA. Una pieza se dibuja en unidades
 * de su viewBox, de modo que un rótulo de 15 unidades se ve perfecto en el portátil donde se
 * programó y se queda en siete píxeles en un móvil de 360: ilegible justo en la pantalla donde más
 * gente lo va a leer. Aquí se recalcula el tamaño en unidades para que el resultado en píxeles sea
 * siempre el mismo. El de los rótulos se aplica solo, con una variable CSS; el de los nodos que se
 * tocan lo aplica cada pieza, escuchando `vis:escala`, porque solo ella sabe cuáles son.
 */
export function crearSvg(contenedor: HTMLElement, etiqueta: string, ancho = 700): SVGSVGElement {
  const alto = Math.round(ancho / PROPORCION);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
  svg.setAttribute('class', 'vis-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', etiqueta);
  crearLienzo(contenedor).append(svg);

  const ajustar = (): void => {
    const anchoReal = svg.getBoundingClientRect().width;
    if (!anchoReal) return;
    const escala = anchoReal / ancho;
    // Dentro de un SVG, un `px` de CSS es una unidad del viewBox: por eso la variable lleva px.
    const tamRotulo = TAM_ROTULO_PX / escala;
    svg.style.setProperty('--tam-rotulo', `${tamRotulo}px`);
    const radioTactil = Math.max(RADIO_TACTIL, MIN_TACTIL_PX / 2 / escala);
    svg.dispatchEvent(new CustomEvent<Escala>('vis:escala', { detail: { escala, radioTactil, tamRotulo } }));
  };

  new ResizeObserver(ajustar).observe(svg);
  // La primera vez hay que esperar a que el navegador haya medido el lienzo: recién insertado en el
  // DOM, su ancho todavía es cero y la escala saldría infinita.
  requestAnimationFrame(ajustar);

  return svg;
}

/** Azúcar para escuchar `vis:escala` con el tipo correcto. Devuelve la baja. */
export function alAjustarEscala(svg: SVGSVGElement, f: (e: Escala) => void): () => void {
  const oyente = (e: Event) => f((e as CustomEvent<Escala>).detail);
  svg.addEventListener('vis:escala', oyente);
  return () => svg.removeEventListener('vis:escala', oyente);
}

/** Atajo para crear nodos SVG con atributos, que es el 80 % del código de una mecánica. */
export function nodo<K extends keyof SVGElementTagNameMap>(
  tipo: K,
  atributos: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tipo);
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, String(v));
  return el;
}

/**
 * Rótulo dentro de una pieza. El texto llega desde fuera, siempre: ver la cabecera de textos.ts.
 * `t()` se reexporta aquí para que una mecánica no tenga que importar de dos sitios.
 */
export { t };
