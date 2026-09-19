/**
 * La pieza que el módulo `figura` aporta a una ficha: maniquí, controles y mapa muscular.
 *
 * Es el único punto de contacto con la app. La app no sabe de Three.js ni de poses: llama a
 * `montarFigura` y recibe algo con `destruir()`. Así el mismo módulo sirve a una app de catálogo y
 * a un sitio de contenido, que son variantes distintas de la plantilla.
 *
 * UN CONTEXTO WebGL VIVO: `destruir()` libera el renderer de verdad (ver visor.ts). La app lo llama
 * al salir de la ficha, y el presupuesto de auditar.mjs lo comprueba sobre el sitio compilado.
 */

import '../estilos/figura.css';
import { t } from '../app/textos';
import { pintarMapa, type Rol } from './musculos';
import { crearVisor, vistasDe, type Movimiento, type Vista } from './visor';

interface Ficha {
  nombre: string;
  musculos?: Partial<Record<Rol, string[]>>;
}

export async function montarFigura(
  contenedor: HTMLElement,
  movimiento: unknown,
  ficha: Ficha,
): Promise<{ destruir(): void }> {
  const mov = movimiento as Movimiento;
  /*
   * `?cartel` congela la primera pose y esconde los controles: es como se saca la imagen fija del
   * catálogo (scripts/generar-carteles.mjs). Sin congelar, cada cartel salía en un punto distinto
   * del movimiento —uno arriba, otro a medio bajar— y la rejilla parecía un montón de fotos sueltas.
   * `?vista` elige desde dónde se mira, porque la vista buena para reproducir no siempre es la que
   * mejor identifica el ejercicio en una miniatura.
   */
  const parametros = new URLSearchParams(location.search);
  const cartel = parametros.has('cartel');
  if (cartel) {
    contenedor.classList.add('cartel');
    /*
     * Y la página entera sin fondo. `omitBackground` de Playwright solo recorta lo que el navegador
     * no ha pintado: con el `background` del body puesto, el PNG sale con el color del tema en el
     * que se generó, y esos carteles claros sobre el tema oscuro eran nueve rectángulos blancos.
     */
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }

  contenedor.innerHTML = `
    <div class="caja">
    <div class="escenario">
      <canvas class="lienzo" aria-label="${ficha.nombre}"></canvas>
      <!--
        La etapa NO va aquí como rótulo suelto: se enciende sobre la línea de tiempo, que es donde
        significa algo. Una palabra en una esquina dice en qué punto está; encendida sobre la línea
        dice además dónde cae ese punto dentro del ciclo y qué viene después.
        El aria-live va en la propia marca, para que un lector de pantalla siga anunciando el cambio.
      -->
      <!--
        LA FASE DEL MOVIMIENTO, EN UNA LÍNEA DE TIEMPO.

        Antes era una palabra suelta en una esquina del lienzo —«Abajo»— y no decía lo que de verdad
        se quiere saber: por dónde va el ciclo, cuánto falta para el punto bajo, y dónde estaba eso
        que acaba de pasar. Aquí las etapas están marcadas sobre la línea y el cursor va por ella.
        Y se puede arrastrar: parar el movimiento justo en el punto que interesa es media razón por
        la que alguien mira esto.

        Es un input de tipo range de verdad, no una barra dibujada: así se maneja con el teclado y
        lo anuncia un lector de pantalla sin escribir una línea para ello. (Y sin comillas
        invertidas en este comentario: está dentro de una plantilla de texto, donde una sola cierra
        la cadena. Ya costó un error de compilación una vez.)
      -->
      <div class="tiempo">
        <input class="cursor" type="range" min="0" max="1000" step="1" value="0"
               aria-label="${t('figura.fase')}" />
        <div class="etapas"></div>
      </div>
      <div class="controles">
        <button type="button" class="reproducir" data-accion="pausa" aria-pressed="false"
                aria-label="${t('figura.pausa')}"><span class="icono" aria-hidden="true">❚❚</span></button>
        <span class="grupo" role="group" aria-label="${t('figura.velocidad')}">
          <span class="rotulo">${t('figura.velocidad')}</span>
          <span class="segmentado">
            <button type="button" data-velocidad="0.5">½×</button>
            <button type="button" data-velocidad="1" aria-pressed="true">1×</button>
          </span>
        </span>
        <span class="grupo vistas" role="group" aria-label="${t('figura.vista')}">
          <span class="rotulo">${t('figura.vista')}</span>
          <span class="segmentado"></span>
        </span>
      </div>
    </div>
    <div class="musculos">
      <h2>${t('figura.musculos')}</h2>
      <div class="mapas"></div>
      <ul class="leyenda"></ul>
    </div>
    </div>`;

  /*
   * Las marcas son las poses que llevan etiqueta, y solo esas: una pose intermedia sin nombre no es
   * un hito del movimiento, es un fotograma de paso. La etiqueta es una CLAVE, no texto: el
   * movimiento es común a los dos idiomas y la traducción vive en ui.json.
   */
  const hitos = (mov.poses as Array<{ t: number; etiqueta?: string }>).filter((x) => x.etiqueta);
  contenedor.querySelector('.etapas')!.innerHTML = hitos
    .map((x) => `<span style="--t: ${x.t}" data-clave="${x.etiqueta}" aria-live="polite">${t(`figura.etapas.${x.etiqueta}`)}</span>`)
    .join('');

  const lienzo = contenedor.querySelector<HTMLCanvasElement>('.lienzo')!;
  const visor = await crearVisor(lienzo);
  visor.cargar(mov);

  const grupoVistas = contenedor.querySelector('.vistas')!;
  let vista: Vista = (parametros.get('vista') as Vista) ?? mov.camara.vista;
  // Se conserva el rótulo del grupo al rellenarlo con los botones de vista.
  const segmentoVistas = grupoVistas.querySelector('.segmentado')!;
  segmentoVistas.replaceChildren(...vistasDe(mov).map((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.vista = v;
    b.textContent = t(`figura.vistas.${v}`);
    b.setAttribute('aria-pressed', String(v === vista));
    return b;
  }));

  pintarMapa(contenedor.querySelector<HTMLElement>('.mapas')!, ficha.musculos ?? {});
  contenedor.querySelector('.leyenda')!.innerHTML = (['principal', 'sinergista', 'estabilizador'] as Rol[])
    .map((rol) => `<li><span class="muestra ${rol}"></span>${t(`figura.roles.${rol}`)}</li>`).join('');
  /*
   * De dónde salen los roles, dicho una vez y en todas las fichas. Sin esta línea, un reparto de
   * manual puesto al lado de una fuente de electromiografía se lee como si fuera una medición, y
   * ninguna ficha lo desmiente salvo la que se acordó de escribirlo en su texto.
   */
  contenedor.querySelector('.musculos')!.insertAdjacentHTML('beforeend',
    `<p class="nota-roles">${t('figura.roles_origen')}</p>`);

  let velocidad = 1;
  let pausado = cartel;
  // El cartel se saca del punto que el movimiento diga, no siempre del principio.
  let fase = cartel ? (mov.cartel?.fase ?? 0) : 0;
  let claveAnterior: string | undefined;
  let anterior = performance.now();
  let animacion = 0;
  const marcas = [...contenedor.querySelectorAll<HTMLElement>('.etapas span')];
  const cursor = contenedor.querySelector<HTMLInputElement>('.cursor')!;

  cursor.addEventListener('input', () => {
    fase = Number(cursor.value) / 1000;
    /*
     * Arrastrar PARA el movimiento. Si siguiera corriendo, el bucle devolvería el cursor a su sitio
     * en el siguiente fotograma y sería imposible dejarlo donde uno quiere: se pelean los dos.
     */
    pausado = true;
    const boton = contenedor.querySelector<HTMLButtonElement>('.reproducir')!;
    boton.querySelector('.icono')!.textContent = '▶';
    boton.setAttribute('aria-label', t('figura.seguir'));
    boton.setAttribute('aria-pressed', 'true');
    visor.posar(fase);
    visor.pintar(vista, lienzo.clientWidth, lienzo.clientHeight);
  });

  contenedor.querySelector('.controles')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.accion === 'pausa') {
      pausado = !pausado;
      /*
       * Cambia el ICONO, y la palabra vive en la etiqueta accesible. Con el texto dentro, el botón
       * cambiaba de ancho al pulsarlo —«Pausa» y «Seguir» no miden lo mismo— y toda la fila de
       * controles daba un salto lateral cada vez.
       */
      b.querySelector('.icono')!.textContent = pausado ? '▶' : '❚❚';
      b.setAttribute('aria-label', t(pausado ? 'figura.seguir' : 'figura.pausa'));
      b.setAttribute('aria-pressed', String(pausado));
    }
    if (b.dataset.velocidad) {
      velocidad = Number(b.dataset.velocidad);
      b.parentElement!.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }
    if (b.dataset.vista) {
      vista = b.dataset.vista as Vista;
      grupoVistas.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }
  });

  function bucle(ahora: number): void {
    const dt = Math.min((ahora - anterior) / 1000, 0.1);
    anterior = ahora;
    if (!pausado) fase = (fase + (dt * velocidad) / mov.duracion) % 1;
    visor.posar(fase);
    visor.pintar(vista, lienzo.clientWidth, lienzo.clientHeight);
    // La etiqueta del movimiento es una CLAVE ("abajo"), no texto: el movimiento es común a los dos
    // idiomas. La traducción vive en ui.json, donde el validador de idiomas puede vigilarla.
    const clave = [...mov.poses].reverse().find((p) => p.t <= fase && p.etiqueta)?.etiqueta;
    // Solo se toca el DOM cuando cambia de etapa: esto corre sesenta veces por segundo.
    if (clave !== claveAnterior) {
      claveAnterior = clave;
      for (const m of marcas) m.classList.toggle('activa', m.dataset.clave === clave);
    }
    // El cursor solo se escribe cuando el movimiento corre: si no, pisa lo que se está arrastrando.
    if (!pausado) cursor.value = String(Math.round(fase * 1000));
    animacion = requestAnimationFrame(bucle);
  }
  animacion = requestAnimationFrame(bucle);

  return {
    destruir() {
      cancelAnimationFrame(animacion);
      visor.destruir();
      contenedor.replaceChildren();
    },
  };
}
