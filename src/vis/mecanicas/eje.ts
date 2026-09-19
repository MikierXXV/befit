/**
 * Mecánica «eje»: un continuo entre dos polos, con una marca en algún punto.
 *
 * Sirve para todo contenido que se entienda como "ni tanto ni tan poco": un término medio, un
 * espectro, un umbral, un punto de equilibrio. Es la mecánica de ejemplo de la plantilla y también
 * la más barata de leer, así que conviene mirarla antes de escribir una nueva.
 *
 * LO QUE ESTA PIEZA DEMUESTRA, Y QUE TODA MECÁNICA DEBE CUMPLIR:
 *  - todos los rótulos llegan en `parametros`, ninguno escrito aquí (ver src/app/textos.ts);
 *  - usa la paleta de su familia y solo tres roles de color (ver `Paleta` en lenguaje.ts);
 *  - los objetivos táctiles no bajan de RADIO_TACTIL;
 *  - se puede recorrer con teclado, no solo con el ratón;
 *  - tiene alternativa textual y resolución;
 *  - con `prefers-reduced-motion` va directa al estado final en vez de animar;
 *  - `destruir()` deja el contenedor como estaba y se da de baja de todo.
 */

import {
  ATENUADO, RADIO_TACTIL, TRAZO,
  alAjustarEscala, alternativaTextual, crearSvg, movimientoReducido, nodo, paletaDe, resolver,
  temaActual,
} from '../lenguaje';
import { alCambiarTema } from '../../app/tema';
import type { Visualizacion } from '../lenguaje';

export interface ParametrosEje {
  /** Id de la familia de contenido: de ahí sale el acento. */
  familia_id: string;
  /** Rótulo del extremo izquierdo (el defecto). */
  polo_a: string;
  /** Rótulo del extremo derecho (el exceso). */
  polo_b: string;
  /** Rótulo de la marca (la virtud, el punto justo). */
  marca: string;
  /** Posición de la marca en el eje, de 0 a 1. Por defecto 0.5. */
  posicion?: number;
  alternativa: string;
  resolucion: string;
}

const ANCHO = 700;
const ALTO = 300;
/** Aire mínimo, en píxeles de pantalla, entre la marca y cualquier rótulo. */
const SEPARACION_PX = 6;

export function crearEje(contenedor: HTMLElement, p: ParametrosEje): Visualizacion {
  const svg = crearSvg(contenedor, p.alternativa, ANCHO);
  const posicion = Math.min(1, Math.max(0, p.posicion ?? 0.5));

  const margen = 90;
  const y = ALTO * 0.55;
  const x = (fraccion: number) => margen + fraccion * (ANCHO - margen * 2);

  // ---- estructura ----
  const linea = nodo('line', {
    x1: x(0), y1: y, x2: x(1), y2: y,
    'stroke-width': TRAZO.base, 'stroke-linecap': 'round',
  });
  const topeA = nodo('line', { x1: x(0), y1: y - 14, x2: x(0), y2: y + 14, 'stroke-width': TRAZO.fino });
  const topeB = nodo('line', { x1: x(1), y1: y - 14, x2: x(1), y2: y + 14, 'stroke-width': TRAZO.fino });

  // Los polos se atenúan como FORMA: sus rótulos van a plena opacidad. Ver la nota de ATENUADO.
  const formaAtenuada = [topeA, topeB];

  /*
   * Los rótulos de los extremos se anclan HACIA DENTRO —el izquierdo por su inicio, el derecho por
   * su final—, no centrados sobre el tope. Centrados, la mitad del texto queda fuera del eje y, en
   * un móvil, fuera del lienzo: se recorta y el visitante lee «El otro extrem». El margen no arregla
   * esto, porque el largo del rótulo lo pone el contenido y aquí no se conoce.
   */
  const rotuloA = nodo('text', { x: x(0), y: y + 44, 'text-anchor': 'start', class: 'vis-rotulo' });
  rotuloA.textContent = p.polo_a;
  const rotuloB = nodo('text', { x: x(1), y: y + 44, 'text-anchor': 'end', class: 'vis-rotulo' });
  rotuloB.textContent = p.polo_b;

  // ---- la marca ----
  // RADIO_TACTIL es el valor de partida; el definitivo lo da `vis:escala` más abajo, porque en un
  // móvil estrecho el mismo radio en unidades del viewBox se queda muy por debajo de los 24 px que
  // hacen falta para poder tocarlo.
  const punto = nodo('circle', { cx: x(posicion), cy: y, r: RADIO_TACTIL, class: 'vis-marca' });
  punto.setAttribute('tabindex', '0');
  punto.setAttribute('role', 'img');
  punto.setAttribute('aria-label', p.marca);

  const rotuloMarca = nodo('text', {
    x: x(posicion), y: y - 30, 'text-anchor': 'middle', class: 'vis-rotulo vis-rotulo-enfasis',
  });
  rotuloMarca.textContent = p.marca;

  svg.append(linea, topeA, topeB, rotuloA, rotuloB, punto, rotuloMarca);

  // ---- color, que depende del tema y por tanto se repinta ----
  function pintar(): void {
    const paleta = paletaDe(p.familia_id, temaActual());
    linea.setAttribute('stroke', paleta.neutro);
    topeA.setAttribute('stroke', paleta.neutro);
    topeB.setAttribute('stroke', paleta.neutro);
    formaAtenuada.forEach((el) => el.setAttribute('opacity', String(ATENUADO)));
    punto.setAttribute('fill', paleta.acento);
    punto.setAttribute('stroke', paleta.senal);
    punto.setAttribute('stroke-width', String(TRAZO.base));
  }
  pintar();
  const bajaTema = alCambiarTema(pintar);

  /*
   * El radio y la colocación de los rótulos se recalculan con el ancho real. Toda pieza con algo que
   * se toque debe hacer lo primero; lo segundo, toda pieza que ponga texto junto a algo que crece.
   *
   * Las distancias eran fijas (44 y 30 unidades) y en escritorio sobraba sitio. A 360 px el radio y
   * el cuerpo de letra casi se duplican en unidades, las distancias no, y «Un extremo» quedaba
   * montado sobre la marca. Ahora cada separación es «lo que mide lo de al lado + un hueco», con las
   * de antes como mínimo para que el escritorio no cambie.
   */
  const bajaEscala = alAjustarEscala(svg, ({ escala, radioTactil, tamRotulo }) => {
    punto.setAttribute('r', String(radioTactil));
    const hueco = SEPARACION_PX / escala;
    // Debajo, la línea base va a un cuerpo entero del borde de la marca: el texto cuelga por arriba.
    const bajo = Math.max(44, radioTactil + hueco + tamRotulo);
    // Encima, solo la parte que cuelga bajo la línea base (≈ un cuarto del cuerpo).
    const alto = Math.max(30, radioTactil + hueco + tamRotulo * 0.25);
    rotuloA.setAttribute('y', String(y + bajo));
    rotuloB.setAttribute('y', String(y + bajo));
    rotuloMarca.setAttribute('y', String(y - alto));
  });

  // ---- movimiento ----
  // Con movimiento reducido, la marca aparece ya en su sitio. Una animación "más corta" sigue siendo
  // movimiento; lo que pide la preferencia es no moverse.
  if (!movimientoReducido()) {
    punto.animate(
      [{ transform: `translateX(${x(0) - x(posicion)}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
    );
  }

  alternativaTextual(contenedor, p.alternativa);
  resolver(contenedor, p.resolucion);

  return {
    destruir(): void {
      bajaTema();
      bajaEscala();
      contenedor.replaceChildren();
    },
  };
}
