/**
 * El registro de series: anotar, borrar y consultar las de un ejercicio.
 *
 * Encima del almacén común, como los favoritos. Las cuentas —1RM, sesiones, evolución— no están
 * aquí sino en `calculos.js`, puras y con test.
 */

import { datos, modificar } from './almacen';
import { hoy } from './calculos.js';
import { normalizarSerie, type Serie } from './datos.js';

export type Anotacion = Pick<Serie, 'ejercicio' | 'peso' | 'reps' | 'segundos' | 'rir'>;

export const seriesDe = (ejercicio: string): Serie[] => datos().series.filter((s) => s.ejercicio === ejercicio);

/**
 * Anota una serie hoy. Pasa por `normalizarSerie`, la misma puerta que un fichero importado: lo que
 * no pasaría al importarlo tampoco entra al escribirlo aquí. Devuelve la serie, o null si no valía.
 *
 * El id lleva la hora y un sufijo aleatorio: con solo la hora, dos series anotadas en el mismo
 * milisegundo —un doble toque en el móvil— compartían id, y al importar la copia en otro dispositivo
 * una de las dos se daba por repetida y desaparecía.
 */
export function anotar(anotacion: Anotacion): Serie | null {
  const ahora = Date.now();
  const serie = normalizarSerie({
    ...anotacion,
    id: `${ahora.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    fecha: hoy(),
    creada: ahora,
  });
  if (!serie) return null;
  modificar((d) => ({ ...d, series: [...d.series, serie] }));
  return serie;
}

export function borrar(id: string): Serie | null {
  const serie = datos().series.find((s) => s.id === id) ?? null;
  if (serie) modificar((d) => ({ ...d, series: d.series.filter((s) => s.id !== id) }));
  return serie;
}

/** Devuelve una serie borrada a su sitio, con su id y su fecha de entonces. */
export function restaurar(serie: Serie): void {
  if (datos().series.some((s) => s.id === serie.id)) return;
  modificar((d) => ({ ...d, series: [...d.series, serie] }));
}
