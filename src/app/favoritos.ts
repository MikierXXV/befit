/**
 * Favoritos del visitante.
 *
 * Viven en el almacén común (`almacen.ts`) junto al resto de sus datos; aquí solo está lo propio de
 * la lista: consultarla, alternar un ejercicio y el enlace para llevársela a otro dispositivo, que
 * cabe de sobra en la URL.
 */

import { datos, modificar, suscribir as suscribirDatos } from './almacen';

export const favoritos = (): string[] => datos().favoritos;
export const esFavorito = (id: string): boolean => datos().favoritos.includes(id);

export function alternar(id: string): boolean {
  modificar((d) => ({
    ...d,
    favoritos: d.favoritos.includes(id) ? d.favoritos.filter((x) => x !== id) : [...d.favoritos, id],
  }));
  return esFavorito(id);
}

export function suscribir(fn: (ids: string[]) => void): () => void {
  return suscribirDatos((d) => fn(d.favoritos));
}

/** Enlace para abrir esta misma lista en otro dispositivo. */
export function enlaceCompartir(): string {
  return `${location.origin}${location.pathname}#/favoritos?ids=${favoritos().join(',')}`;
}

/**
 * Añade a los favoritos los que vengan en un enlace compartido.
 *
 * Añade, nunca sustituye: quien abre el enlace de un amigo no espera perder su propia lista. Y los
 * ids se filtran contra el catálogo, porque lo que llega por la URL lo escribe cualquiera.
 */
export function recibirDeEnlace(idsEnlace: string[], existentes: Set<string>): void {
  const nuevos = idsEnlace.filter((id) => existentes.has(id) && !esFavorito(id));
  if (!nuevos.length) return;
  modificar((d) => ({ ...d, favoritos: [...d.favoritos, ...nuevos] }));
}
