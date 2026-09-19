/**
 * Tema claro / oscuro.
 *
 * La resolución inicial NO está aquí: la hace un script síncrono en index.html, antes del primer
 * pintado. Si se dejara para este módulo, el navegador pintaría el tema claro y lo cambiaría
 * después —el destello blanco al entrar en un sitio oscuro—, y eso no se arregla con CSS porque la
 * preferencia guardada solo existe en JavaScript.
 *
 * Este módulo se ocupa de lo que viene después: cambiarlo y avisar a quien esté pintando.
 */

export type Tema = 'claro' | 'oscuro';

const oyentes = new Set<(tema: Tema) => void>();

export function temaActual(): Tema {
  return document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro';
}

export function cambiarTema(tema: Tema = temaActual() === 'claro' ? 'oscuro' : 'claro'): void {
  document.documentElement.dataset.tema = tema;
  localStorage.setItem('tema', tema);
  oyentes.forEach((f) => f(tema));
}

/**
 * Avisa cuando cambia el tema. Devuelve la función para darse de baja.
 *
 * Las visualizaciones DEBEN darse de baja al destruirse. Una pieza que sigue suscrita después de
 * cerrarse repinta sobre un contenedor que ya no existe, y como el error salta dentro del oyente no
 * rompe nada visible: se acumula en silencio hasta que la pestaña va a tirones.
 */
export function alCambiarTema(f: (tema: Tema) => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/**
 * Cuando el usuario no ha elegido, el sitio sigue al sistema en vivo. Con elección guardada, no:
 * quien ha pulsado el botón ha dicho lo que quiere y el sistema no debe contradecirle a mitad de
 * sesión.
 */
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (localStorage.getItem('tema')) return;
  const tema: Tema = e.matches ? 'oscuro' : 'claro';
  document.documentElement.dataset.tema = tema;
  oyentes.forEach((f) => f(tema));
});
