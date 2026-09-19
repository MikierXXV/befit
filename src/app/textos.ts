/**
 * Cadenas de interfaz. Todo el texto visible sale de aquí, nunca de un literal en el código.
 *
 * POR QUÉ ES UNA REGLA Y NO UNA COSTUMBRE. Un literal en español dentro de una visualización no
 * llama la atención de nadie mientras el sitio se desarrolla en español: se descubre el día que
 * alguien abre la versión inglesa y encuentra doce piezas hablando en castellano. Por eso hay un
 * guion —scripts/check-idiomas.mjs— que lo vigila y bloquea el despliegue.
 *
 * Los ficheros son content/<idioma>/ui.json. Se cargan todos en compilación y se elige por el `lang`
 * del documento, que es también lo que leen los lectores de pantalla: una sola fuente para las dos
 * cosas, que no pueden desincronizarse.
 */

type Arbol = { [clave: string]: string | Arbol };

const ficheros = import.meta.glob<{ default: Arbol }>('../../content/*/ui.json', { eager: true });

function idiomaActual(): string {
  return document.documentElement.lang || 'es';
}

function cargar(): Arbol {
  const idioma = idiomaActual();
  const entrada = Object.entries(ficheros).find(([ruta]) => ruta.includes(`/${idioma}/`));
  if (!entrada) {
    // Falta el fichero entero: es un error de proyecto, no una cadena que se pueda inventar.
    throw new Error(`No hay content/${idioma}/ui.json`);
  }
  return entrada[1].default;
}

const arbol = cargar();

/**
 * Busca una cadena por su ruta con puntos: `t('vis.respaldo_3d')`.
 *
 * Si falta, devuelve la propia clave en vez de una cadena vacía. Una clave suelta en pantalla se ve
 * y se corrige; un hueco vacío pasa desapercibido hasta que alguien pregunta por qué ese botón no
 * dice nada.
 */
export function t(ruta: string): string {
  const valor = ruta.split('.').reduce<string | Arbol | undefined>(
    (nodo, clave) => (typeof nodo === 'object' && nodo !== null ? nodo[clave] : undefined),
    arbol,
  );
  if (typeof valor === 'string') return valor;
  console.warn(`[textos] falta la clave "${ruta}" en content/${idiomaActual()}/ui.json`);
  return ruta;
}

/** El árbol completo, para quien necesite recorrerlo (bancos de pruebas, generadores). */
export const TEXTOS = arbol;
