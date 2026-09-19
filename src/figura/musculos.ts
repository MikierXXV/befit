/**
 * Mapa muscular en SVG, de frente y de espalda, con el rol de cada músculo en el ejercicio.
 *
 * Los trazados son de `body-muscles` (Apache 2.0, Ivan Vulović). Solo se usan sus trazados, no su
 * componente: el componente pinta con una escala de intensidad amarillo→rojo que dice "este músculo
 * trabaja al 70 %", y eso es exactamente la afirmación que la EMG no permite hacer. Aquí se dice el
 * rol —principal, sinergista, estabilizador—, que sí está respaldado.
 *
 * Y va en SVG y no pintado sobre el maniquí: no abre un segundo contexto WebGL, se puede tocar para
 * filtrar por músculo y un lector de pantalla puede leerlo.
 */

import { BACK_MUSCLES, FRONT_MUSCLES } from 'body-muscles';
import { t } from '../app/textos';

export type Rol = 'principal' | 'sinergista' | 'estabilizador';

/** Vocabulario de befit → prefijos de los trazados. Un músculo nuestro puede ocupar varias zonas del mapa. */
export const ZONAS: Record<string, string[]> = {
  pectoral: ['chest-upper', 'chest-lower'],
  deltoides_anterior: ['shoulder-front'],
  deltoides_lateral: ['shoulder-side'],
  deltoides_posterior: ['deltoid-rear'],
  biceps: ['biceps'],
  triceps: ['triceps-long', 'triceps-lateral'],
  antebrazo: ['forearm', 'forearm-flexors', 'forearm-extensors'],
  trapecio_superior: ['traps-upper'],
  // El mapa no tiene romboides: el trapecio medio es la zona que los cubre, y así se anota.
  trapecio_medio: ['traps-mid', 'traps-lower'],
  dorsal: ['lats-upper', 'lats-mid', 'lats-lower'],
  serrato: ['serratus-anterior'],
  erectores: ['lower-back-erectors', 'spine'],
  abdomen: ['abs-upper', 'abs-lower'],
  oblicuos: ['obliques'],
  gluteo_mayor: ['gluteus-maximus'],
  gluteo_medio: ['gluteus-medius'],
  cuadriceps: ['quads'],
  aductores: ['adductors'],
  isquiotibiales: ['hamstrings-medial', 'hamstrings-lateral'],
  gemelos: ['calves-gastroc-medial', 'calves-gastroc-lateral'],
  soleo: ['calves-soleus'],
  flexores_cadera: ['hip-flexor'],
};

const NS = 'http://www.w3.org/2000/svg';

export function pintarMapa(contenedor: HTMLElement, musculos: Partial<Record<Rol, string[]>>) {
  const rolDe = new Map<string, Rol>();
  // Principal pisa a sinergista y este a estabilizador: si una ficha repite un músculo, manda el rol fuerte.
  for (const rol of ['estabilizador', 'sinergista', 'principal'] as Rol[]) {
    for (const m of musculos[rol] ?? []) {
      const zonas = ZONAS[m];
      if (!zonas) throw new Error(`Músculo sin zona en el mapa: ${m}`);
      zonas.forEach((z) => rolDe.set(z, rol));
    }
  }

  contenedor.replaceChildren();
  for (const [lado, trazados, viewBox] of [
    ['frente', FRONT_MUSCLES, '0 0 35 93'],
    ['espalda', BACK_MUSCLES, '37 0 35 93'],
  ] as const) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('class', 'mapa');
    svg.setAttribute('role', 'img');
    const activos = trazados.filter((t) => rolDe.has(zona(t.id)));
    // La alternativa textual nombra los músculos EN EL IDIOMA DEL SITIO, no con los nombres ingleses
    // del paquete de trazados: quien usa lector de pantalla oiría "lats-upper-left" si no.
    const nombres = [...new Set(activos.map((m) => t(`catalogo.musculos.${nuestro(zona(m.id)) ?? ''}`)))];
    svg.setAttribute('aria-label', `${t(`figura.lado.${lado}`)}: ${nombres.join(', ') || t('figura.sin_destacados')}`);
    for (const t of trazados) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', t.path);
      p.setAttribute('class', `zona ${rolDe.get(zona(t.id)) ?? ''}`.trim());
      svg.append(p);
    }
    contenedor.append(svg);
  }
}

/** De una zona del mapa al músculo nuestro que la ocupa, para poder nombrarla en el idioma del sitio. */
function nuestro(zona: string): string | undefined {
  return Object.entries(ZONAS).find(([, zonas]) => zonas.includes(zona))?.[0];
}

/** `quads-left` → `quads`; `spine` → `spine`. */
function zona(id: string) {
  return id.replace(/-(left|right)$/, '');
}
