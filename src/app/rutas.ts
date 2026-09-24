/**
 * Rutas de la app, en el fragmento (`#/...`).
 *
 * POR QUÉ EN EL FRAGMENTO Y NO CON History API: esto se publica en GitHub Pages, que sirve ficheros
 * estáticos. Con rutas normales, `/f/sentadilla` recargado o compartido da un 404 del propio GitHub,
 * y el truco habitual —un 404.html que reescribe— manda una página de error a los buscadores. El
 * fragmento no llega al servidor: la URL siempre existe.
 *
 * El estado del catálogo (búsqueda y filtros) también va en la ruta. Así un catálogo filtrado se
 * puede compartir y el botón de atrás deshace un filtro, que es lo que la gente espera que haga.
 */

export interface Ruta {
  vista: 'catalogo' | 'ficha' | 'favoritos' | 'datos' | 'hoy' | 'rutinas' | 'rutina';
  id?: string;
  /** En una rutina del visitante: su pantalla de edición. */
  editar?: boolean;
  /** Una rutina que llega por enlace, en el formato de `aEnlace()`. */
  compartida?: string;
  busqueda?: string;
  filtros: Record<string, string[]>;
  ids?: string[];
}

const LISTAS = ['grupo', 'material', 'nivel', 'musculo'];

export function rutaActual(): Ruta {
  const bruto = location.hash.replace(/^#\/?/, '');
  const [camino, consulta] = bruto.split('?');
  const parametros = new URLSearchParams(consulta ?? '');
  const filtros: Record<string, string[]> = {};
  for (const campo of LISTAS) {
    const valor = parametros.get(campo);
    if (valor) filtros[campo] = valor.split(',').filter(Boolean);
  }

  const partes = (camino ?? '').split('/').filter(Boolean);
  if (partes[0] === 'f' && partes[1]) return { vista: 'ficha', id: partes[1], filtros };
  if (partes[0] === 'datos') return { vista: 'datos', filtros };
  if (partes[0] === 'hoy') return { vista: 'hoy', id: partes[1], filtros };
  if (partes[0] === 'rutinas') return { vista: 'rutinas', filtros };
  if (partes[0] === 'rutina' && partes[1] === 'compartida') return { vista: 'rutina', compartida: parametros.get('r') ?? '', filtros };
  if (partes[0] === 'rutina' && partes[1]) return { vista: 'rutina', id: partes[1], editar: partes[2] === 'editar', filtros };
  if (partes[0] === 'favoritos') {
    return { vista: 'favoritos', filtros, ids: parametros.get('ids')?.split(',').filter(Boolean) };
  }
  return { vista: 'catalogo', busqueda: parametros.get('q') ?? '', filtros };
}

export function enlace(ruta: Partial<Ruta> & { vista: Ruta['vista'] }): string {
  const parametros = new URLSearchParams();
  if (ruta.busqueda) parametros.set('q', ruta.busqueda);
  for (const [campo, valores] of Object.entries(ruta.filtros ?? {})) {
    if (valores.length) parametros.set(campo, valores.join(','));
  }
  const consulta = parametros.toString();
  const camino = ruta.vista === 'ficha' ? `f/${ruta.id}`
    : ruta.vista === 'hoy' && ruta.id ? `hoy/${ruta.id}`
    : ruta.vista === 'rutina' ? `rutina/${ruta.id}${ruta.editar ? '/editar' : ''}`
    : ruta.vista === 'catalogo' ? '' : ruta.vista;
  return `#/${camino}${consulta ? `?${consulta}` : ''}`;
}

export function irA(ruta: Partial<Ruta> & { vista: Ruta['vista'] }): void {
  location.hash = enlace(ruta);
}

export function alCambiarRuta(fn: (ruta: Ruta) => void): void {
  addEventListener('hashchange', () => fn(rutaActual()));
}
