/**
 * Registro de visualizaciones: dado el id de una pieza de contenido, entrega su visualización.
 *
 * DOS FORMAS DE RESOLVERSE, Y LA PRIMERA DEBE SER LA MAYORITARIA:
 *
 *  1. **Mecánica parametrizada.** La ficha declara `visualizacion.mecanica` y `visualizacion.parametros`,
 *     y aquí solo se despacha. El parecido de familia queda garantizado por construcción en vez de
 *     por disciplina, y añadir una pieza de contenido no toca código.
 *  2. **Pieza propia.** Solo cuando el contenido no encaja en ninguna mecánica. Son las excepciones
 *     justificadas, no el caso general. Si las propias empiezan a ser mayoría, lo que falta es una
 *     mecánica nueva.
 *
 * Todo se carga con import() dinámico: el recorrido no descarga la visualización de una pieza hasta
 * que el usuario entra en ella.
 *
 * scripts/validar-contenido.mjs lee este fichero y comprueba que toda mecánica declarada en el
 * contenido existe aquí. Por eso las claves se escriben literales y no se generan: si se calcularan,
 * el validador no podría verlas.
 */

import type { Visualizacion } from './lenguaje';

/** Firma común: cada mecánica recibe su contenedor y los parámetros que declara la ficha. */
type Fabrica = (contenedor: HTMLElement, parametros: unknown) => Visualizacion | Promise<Visualizacion>;

const MECANICAS: Record<string, () => Promise<Fabrica>> = {
  eje: async () => {
    const m = await import('./mecanicas/eje');
    return (c, p) => m.crearEje(c, p as Parameters<typeof m.crearEje>[1]);
  },
  // Añade aquí cada mecánica nueva. Una mecánica se justifica cuando cubre una promesa que ninguna
  // de las existentes puede cumplir sin desvirtuarla, no cuando apetece una forma distinta.
};

/**
 * Piezas con implementación propia, indexadas por id de contenido.
 *
 * RECIBEN SUS RÓTULOS DESDE LA FICHA, igual que las mecánicas reciben sus parámetros. Llevarlos
 * escritos dentro parece más cómodo y es exactamente lo que deja piezas hablando en el idioma
 * equivocado el día que se traduce el sitio. El texto visible pertenece al contenido, no al código.
 */
type FabricaPropia = (c: HTMLElement, textos: unknown) => Visualizacion | Promise<Visualizacion>;

const PROPIAS: Record<string, () => Promise<FabricaPropia>> = {
  // 'id-de-la-pieza': async () => {
  //   const m = await import('./mi-pieza');
  //   return (c, t) => m.crearMiPieza(c, t as Parameters<typeof m.crearMiPieza>[1]);
  // },
};

export interface FichaVisualizacion {
  mecanica?: string;
  parametros?: unknown;
  /** Rótulos de una pieza propia. Las mecánicas los llevan dentro de `parametros`. */
  textos?: unknown;
}

export function tieneVisualizacion(id: string, vis: FichaVisualizacion | undefined): boolean {
  return Boolean(PROPIAS[id] ?? (vis?.mecanica && MECANICAS[vis.mecanica]));
}

/**
 * Instancia la visualización de una pieza. La propia tiene prioridad: si un contenido acaba
 * necesitando tratamiento particular, basta con añadirlo a PROPIAS sin tocar su ficha.
 */
export async function crearVisualizacion(
  id: string,
  vis: FichaVisualizacion | undefined,
  contenedor: HTMLElement,
): Promise<Visualizacion> {
  const propia = PROPIAS[id];
  if (propia) {
    const fabrica = await propia();
    return fabrica(contenedor, vis?.textos);
  }

  if (!vis?.mecanica) throw new Error(`"${id}" no declara mecánica ni tiene pieza propia`);
  const cargar = MECANICAS[vis.mecanica];
  if (!cargar) throw new Error(`Mecánica desconocida en "${id}": ${vis.mecanica}`);

  const fabrica = await cargar();
  return fabrica(contenedor, vis.parametros);
}

/** Se exportan para no duplicar las listas en bancos de pruebas ni en el validador. */
export const MECANICAS_DISPONIBLES = Object.keys(MECANICAS);
export const IDS_PROPIAS = Object.keys(PROPIAS);
