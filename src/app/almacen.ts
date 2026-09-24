/**
 * Los datos del visitante, en SU navegador.
 *
 * EN EL NAVEGADOR Y NADA MÁS. No hay cuenta, ni servidor, ni cookie que viaje: todo vive en el
 * localStorage de ese dispositivo. Es una decisión, no una carencia — un sitio estático en GitHub
 * Pages no puede guardar nada del usuario sin montar un servicio detrás, y con él llegan registro,
 * contraseñas, correos y datos personales que este proyecto no quiere tener. Para cambiar de
 * dispositivo se exporta un fichero y se importa en el otro.
 *
 * UNA SOLA CLAVE, VERSIONADA. La primera versión guardaba los favoritos sueltos bajo `favoritos`;
 * al añadir el registro de series habría hecho falta otra clave, y otra con las rutinas, y exportar
 * o migrar significaría perseguirlas todas. Aquí hay un objeto con `version`, y `migrar()` —en
 * `datos.js`, con tests— lo lleva siempre a la forma actual.
 *
 * TODO acceso va en try/catch: en navegación privada, con las cookies bloqueadas o dentro de una
 * vista previa, `localStorage` no lanza al leerlo sino AL TOCARLO, y una excepción aquí dejaría la
 * página en blanco por no poder leer una lista.
 */

import { FICHAS } from './contenido';
import { fusionar, leerExportado, limpiar, migrar, paraExportar, vacio, type Datos } from './datos.js';

const CLAVE = 'befit.datos.v1';
const CLAVE_VIEJA = 'favoritos';

const idsCatalogo = new Set(FICHAS.map((f) => f.id));
const oyentes = new Set<(d: Datos) => void>();

function leerJson(clave: string): unknown {
  try {
    const texto = localStorage.getItem(clave);
    return texto === null ? null : JSON.parse(texto);
  } catch {
    return null;
  }
}

let actuales: Datos = limpiar(migrar(leerJson(CLAVE), leerJson(CLAVE_VIEJA)), idsCatalogo);

/*
 * La migración se GUARDA al arrancar, no al primer cambio. Esperar a que el visitante toque algo
 * dejaba sus favoritos en la clave vieja indefinidamente —comprobado: la insignia contaba bien, pero
 * `befit.datos.v1` seguía sin existir—, y un fichero exportado en ese intervalo habría salido vacío
 * de verdad aunque la pantalla dijera otra cosa.
 */
let hayVieja = false;
try {
  hayVieja = localStorage.getItem(CLAVE_VIEJA) !== null;
} catch {
  // Sin almacenamiento no hay nada que migrar.
}

function guardar(): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(actuales));
    // La clave vieja se borra solo DESPUÉS de haber escrito la nueva: si la escritura fallara, lo que
    // hubiera seguiría donde estaba.
    localStorage.removeItem(CLAVE_VIEJA);
  } catch {
    // Sin almacenamiento, los datos duran lo que la pestaña. Mejor eso que romper la página.
  }
  oyentes.forEach((f) => f(actuales));
}

if (hayVieja) guardar();

export const datos = (): Datos => actuales;

/** Cambia los datos a través de una función que devuelve la versión nueva, y los guarda. */
export function modificar(fn: (d: Datos) => Datos): void {
  actuales = fn(actuales);
  guardar();
}

export function suscribir(fn: (d: Datos) => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/** El contenido del fichero de copia, listo para descargar. */
export const exportar = (): string => paraExportar(actuales);

/**
 * Suma a lo que hay lo de un fichero exportado. Lanza con una clave de `ui.json` si no lo es.
 * Devuelve cuánto era nuevo, para decírselo a quien importa.
 */
export function importar(texto: string): { nuevosFavoritos: number; nuevasSeries: number } {
  const { datos: juntos, nuevosFavoritos, nuevasSeries } = fusionar(actuales, leerExportado(texto));
  actuales = limpiar(juntos, idsCatalogo);
  guardar();
  return { nuevosFavoritos, nuevasSeries };
}

/** Borra todo lo del visitante en este dispositivo. La vista pide confirmación antes. */
export function vaciar(): void {
  actuales = vacio();
  guardar();
}
