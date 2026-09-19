/**
 * Favoritos del visitante.
 *
 * EN EL NAVEGADOR Y NADA MÁS. No hay cuenta, ni servidor, ni cookie que viaje: la lista vive en el
 * localStorage de ese dispositivo. Es una decisión, no una carencia — un sitio estático en GitHub
 * Pages no puede guardar nada del usuario sin montar un servicio detrás, y con él llegan registro,
 * contraseñas, correos y datos personales que este proyecto no quiere tener.
 *
 * Lo que sí hay es un enlace para llevárselos a otro dispositivo: los ids caben de sobra en la URL.
 *
 * TODO acceso va en try/catch: en navegación privada, con las cookies bloqueadas o dentro de una
 * vista previa, `localStorage` no lanza al leerlo sino AL TOCARLO, y una excepción aquí dejaría la
 * página en blanco por no poder leer una lista de favoritos.
 */

const CLAVE = 'favoritos';
const oyentes = new Set<(ids: string[]) => void>();

function leerCrudo(): string[] {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? '[]');
    return Array.isArray(guardado) ? guardado.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

let ids = leerCrudo();

function guardar(): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(ids));
  } catch {
    // Sin almacenamiento, los favoritos duran lo que la pestaña. Mejor eso que romper la página.
  }
  oyentes.forEach((f) => f(ids));
}

export const favoritos = (): string[] => ids;
export const esFavorito = (id: string): boolean => ids.includes(id);

export function alternar(id: string): boolean {
  ids = esFavorito(id) ? ids.filter((x) => x !== id) : [...ids, id];
  guardar();
  return esFavorito(id);
}

export function suscribir(fn: (ids: string[]) => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/** Enlace para abrir esta misma lista en otro dispositivo. */
export function enlaceCompartir(): string {
  return `${location.origin}${location.pathname}#/favoritos?ids=${ids.join(',')}`;
}

/**
 * Añade a los favoritos los que vengan en un enlace compartido.
 *
 * Añade, nunca sustituye: quien abre el enlace de un amigo no espera perder su propia lista. Y los
 * ids se filtran contra el catálogo, porque lo que llega por la URL lo escribe cualquiera.
 */
export function recibirDeEnlace(idsEnlace: string[], existentes: Set<string>): void {
  const nuevos = idsEnlace.filter((id) => existentes.has(id) && !ids.includes(id));
  if (!nuevos.length) return;
  ids = [...ids, ...nuevos];
  guardar();
}
