/**
 * «Hoy»: la sesión en el gimnasio.
 *
 * Arriba, lo hecho hoy —ejercicios en el orden en que se empezaron, series y kilos—; debajo, el
 * ejercicio activo con su maniquí y su registro. Se cambia de ejercicio tocando otro de la lista o
 * añadiendo uno del catálogo, sin salir de la pantalla.
 *
 * UN SOLO MANIQUÍ, el del ejercicio activo (regla 4). Uno por ejercicio de la lista serían cinco o
 * seis contextos WebGL en un móvil de gimnasio, y los navegadores empiezan a matar contextos antes
 * de llegar a diez: el síntoma sería un maniquí en blanco lejos de su causa.
 */

import { datos } from '../almacen';
import { ejerciciosDelDia, hoy, volumen } from '../calculos.js';
import { FICHAS, GRUPOS, MOVIMIENTOS, fichaPorId, type Ficha } from '../contenido';
import { favoritos } from '../favoritos';
import { mantenerEncendida } from '../pantalla';
import { enlace, irA } from '../rutas';
import { t } from '../textos';
import { montarRegistro } from './registro';

export interface OpcionesHoy {
  /** El ejercicio que se abre: el de la ruta, o si no el último que se tocó hoy. */
  activo?: string;
  /** Monta el maniquí de una ficha. Lo pone quien sabe si el proyecto lleva el módulo `figura`. */
  montarManiqui: (contenedor: HTMLElement, f: Ficha) => Promise<{ destruir(): void } | null>;
}

const idioma = (): string => document.documentElement.lang || 'es';
const numero = (n: number): string => new Intl.NumberFormat(idioma(), { maximumFractionDigits: 1 }).format(n);

/** «1 serie», «3 series»: la regla de plural la pone el idioma, no un `n === 1`. */
const plural = (clave: string, n: number): string =>
  t(`${clave}.${new Intl.PluralRules(idioma()).select(n) === 'one' ? 'una' : 'varias'}`).replace('{n}', numero(n));

const escapar = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** La fecha de hoy, larga, para la entradilla: «jueves, 24 de septiembre». */
export const fechaDeHoy = (): string =>
  new Intl.DateTimeFormat(idioma(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

export function montarHoy(el: HTMLElement, opciones: OpcionesHoy): { destruir(): void } {
  let destruido = false;
  let maniqui: { destruir(): void } | null = null;
  // La pantalla encendida mientras se está aquí: es la que queda abierta en el banco entre series.
  mantenerEncendida('hoy', true);

  const delDia = (): ReturnType<typeof ejerciciosDelDia> => ejerciciosDelDia(datos().series, hoy());
  const ultimoTocado = (): string | undefined =>
    datos().series.filter((s) => s.fecha === hoy()).sort((a, b) => b.creada - a.creada)[0]?.ejercicio;
  const activo = fichaPorId(opciones.activo ?? '') ?? fichaPorId(ultimoTocado() ?? '');

  /*
   * Añadir un ejercicio es un <select> agrupado por patrón, no un buscador: con cincuenta ejercicios
   * cabe, el móvil lo abre con su propia rueda —grande y cómoda con una mano— y no hay que escribir.
   */
  const selector = (): string => `
    <label class="anadir">
      <span>${t('hoy.anadir')}</span>
      <select data-anadir>
        <option value="">${t('hoy.elegir')}</option>
        ${GRUPOS.map((g) => `<optgroup label="${escapar(g.nombre)}">${FICHAS.filter((f) => f.grupo_id === g.id)
          .map((f) => `<option value="${f.id}">${escapar(f.nombre)}</option>`).join('')}</optgroup>`).join('')}
      </select>
    </label>`;

  function cabeza(): string {
    const dia = delDia();
    // El activo sale en la lista aunque aún no tenga series: acaba de elegirse y es donde se está.
    const lista = activo && !dia.some((e) => e.ejercicio === activo.id) ? [...dia, { ejercicio: activo.id, series: [] }] : dia;
    const series = dia.flatMap((e) => e.series);
    const kilos = volumen(series);
    return `
      ${series.length ? `
        <dl class="datos">
          <div class="dato"><dt>${t('hoy.ejercicios')}</dt><dd>${numero(dia.length)}</dd></div>
          <div class="dato"><dt>${t('hoy.series_total')}</dt><dd>${numero(series.length)}</dd></div>
          ${kilos ? `<div class="dato"><dt>${t('hoy.volumen')}</dt><dd>${t('registro.formato.kg').replace('{v}', numero(kilos))}</dd></div>` : ''}
        </dl>` : ''}
      ${lista.length ? `
        <nav aria-label="${t('hoy.lista')}">
          <ol class="ejercicios-hoy">${lista.map(({ ejercicio, series: suyas }) => {
            const f = fichaPorId(ejercicio);
            return `<li><a href="${enlace({ vista: 'hoy', id: ejercicio, filtros: {} })}" ${ejercicio === activo?.id ? 'aria-current="true"' : ''}>
              <span class="nombre">${escapar(f?.nombre ?? ejercicio)}</span>
              <span class="cuantas">${plural('hoy.series', suyas.length)}</span></a></li>`;
          }).join('')}
          </ol>
        </nav>` : ''}
      ${selector()}`;
  }

  function pintarCabeza(): void {
    const sitioCabeza = el.querySelector<HTMLElement>('.hoy-cabeza');
    if (sitioCabeza) sitioCabeza.innerHTML = cabeza();
  }

  const proporcion = (f: Ficha): string | undefined =>
    (MOVIMIENTOS[f.movimiento_id ?? ''] as { camara?: { proporcion?: string } } | undefined)?.camara?.proporcion;

  el.innerHTML = `
    <div class="hoy-cabeza">${cabeza()}</div>
    ${activo ? `
      <section class="activo" aria-labelledby="activo-titulo">
        <h2 id="activo-titulo"><a href="${enlace({ vista: 'ficha', id: activo.id, filtros: {} })}">${escapar(activo.nombre)}</a></h2>
        <!--
          El registro ANTES que el maniquí, al revés que en la ficha. Aquí se viene a anotar: con el
          maniquí y su mapa muscular delante, el formulario quedaba a casi dos pantallas de
          desplazamiento en el móvil, entre serie y serie. El maniquí queda debajo, para quien
          quiera repasar el gesto.
        -->
        <div class="registro"></div>
        <div class="figura" ${proporcion(activo) ? `style="--proporcion-lienzo: ${proporcion(activo)}"` : ''}></div>
      </section>` : `
      <div class="vacio">
        <p>${t('hoy.vacio')}</p>
        ${favoritos().length ? `
          <p>${t('hoy.desde_favoritos')}</p>
          <ul class="atajos">${favoritos().map((id) => fichaPorId(id)).filter((f): f is Ficha => !!f)
            .map((f) => `<li><a class="boton" href="${enlace({ vista: 'hoy', id: f.id, filtros: {} })}">${escapar(f.nombre)}</a></li>`).join('')}</ul>` : ''}
      </div>`}`;

  el.addEventListener('change', (e) => {
    const campo = e.target as HTMLSelectElement;
    if (campo.matches('[data-anadir]') && campo.value) irA({ vista: 'hoy', id: campo.value, filtros: {} });
  });

  if (activo) {
    montarRegistro(el.querySelector<HTMLElement>('.registro')!, activo, { compacto: true, alCambiar: pintarCabeza });
    const hueco = el.querySelector<HTMLElement>('.figura')!;
    void opciones.montarManiqui(hueco, activo).then((m) => {
      // Si se salió de la pantalla mientras cargaba, el maniquí nace ya sobrando: se libera en el
      // acto. Si no, se quedaba un contexto WebGL vivo sin página que lo enseñara.
      if (destruido) m?.destruir();
      else maniqui = m;
    });
  }

  return {
    destruir(): void {
      destruido = true;
      maniqui?.destruir();
      maniqui = null;
      mantenerEncendida('hoy', false);
    },
  };
}
