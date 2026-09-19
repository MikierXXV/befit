/**
 * Hoja de revisión de un movimiento: todas las vistas × las fases clave, en una sola imagen.
 *
 * Se abre con `?hoja=<id de la ficha>` y la saca `scripts/capturar-hoja.mjs`.
 *
 * POR QUÉ UNA IMAGEN Y NO MIRAR LA ANIMACIÓN. Revisar un movimiento reproduciéndolo cuesta diez
 * veces más y se pasa por alto lo que dura dos fotogramas: una rodilla que se mete hacia dentro a
 * mitad de bajada, una mano que atraviesa la barra al pasar. En una hoja, eso salta a la vista. Es
 * la herramienta con la que se corrige el movimiento, y también lo que revisa un agente.
 */

import { crearVisor, vistasDe, type Movimiento } from './visor';

const CELDA = 380;
const CABECERA = 40;

export async function montarHoja(contenedor: HTMLElement, movimiento: unknown, titulo: string): Promise<void> {
  const mov = movimiento as Movimiento;
  const vistas = vistasDe(mov);
  // Las fases: cada pose clave y el punto medio de cada tramo. Los puntos medios importan tanto como
  // las poses: la interpolación entre dos poses buenas puede pasar por una mala.
  const claves = mov.poses.map((p) => p.t).filter((t) => t < 1);
  const todas = [...new Set([...claves, ...claves.map((t, n) => (t + (claves[n + 1] ?? 1)) / 2)])].sort((a, b) => a - b);

  /*
   * Tope de columnas. Un movimiento de diez poses daba dieciocho viñetas, y en el PNG completo cada
   * una salía tan pequeña que había que recortar la imagen por zonas para revisarla: una hoja que no
   * se puede mirar de un vistazo no sirve para lo único que existe. Se reparten por el ciclo en vez
   * de quedarse con las primeras, y las poses con etiqueta tienen preferencia porque son los
   * momentos que la ficha nombra.
   */
  const COLUMNAS = 8;
  const conEtiqueta = new Set(mov.poses.filter((p) => p.etiqueta).map((p) => p.t));
  const fases = todas.length <= COLUMNAS
    ? todas
    : [...new Set([
        ...todas.filter((t) => conEtiqueta.has(t)).slice(0, COLUMNAS),
        ...Array.from({ length: COLUMNAS }, (_, n) => todas[Math.round((n * (todas.length - 1)) / (COLUMNAS - 1))]!),
      ])].sort((a, b) => a - b).slice(0, COLUMNAS);

  const hoja = document.createElement('canvas');
  hoja.className = 'hoja';
  hoja.width = CELDA * fases.length;
  hoja.height = CELDA * vistas.length + CABECERA;
  contenedor.replaceChildren(hoja);

  const ctx = hoja.getContext('2d')!;
  ctx.fillStyle = '#fbfaf8';
  ctx.fillRect(0, 0, hoja.width, hoja.height);
  ctx.fillStyle = '#222';
  ctx.font = '600 20px system-ui';
  ctx.fillText(titulo, 12, 28);

  const lienzo = document.createElement('canvas');
  const visor = await crearVisor(lienzo);
  visor.render.setPixelRatio(1);
  visor.cargar(mov);

  vistas.forEach((vista, fila) => {
    fases.forEach((fase, col) => {
      visor.posar(fase);
      visor.pintar(vista, CELDA, CELDA);
      // drawImage justo después de pintar, en la misma tarea: sin preserveDrawingBuffer el búfer se
      // borra al devolver el control al navegador, y copiarlo más tarde daría una viñeta en blanco.
      ctx.drawImage(lienzo, col * CELDA, CABECERA + fila * CELDA);
      ctx.fillStyle = '#555';
      ctx.font = '14px system-ui';
      const etapa = mov.poses.find((p) => p.t === fase)?.etiqueta ?? '';
      ctx.fillText(`${vista} · t=${fase.toFixed(2)} ${etapa}`, col * CELDA + 8, CABECERA + fila * CELDA + 20);
    });
  });

  visor.destruir();
  Object.assign(window, { __hoja: { lista: true } });
}
