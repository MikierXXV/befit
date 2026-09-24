/**
 * Las rutinas: la lista, una rutina, su editor y la que llega por un enlace.
 *
 * Las de inicio se leen y se empiezan; para cambiarlas se copian. Las del visitante se editan en su
 * propia pantalla (`#/rutina/<id>/editar`) y no en la del detalle: mezclar leer y editar en la misma
 * vista dejaba un campo de texto encima de cada número, y en el gimnasio lo que se quiere es ver el
 * día y empezarlo, no un formulario.
 */

import { FICHAS, GRUPOS, RUTINAS, etiqueta, fichaPorId, type Ficha } from '../contenido';
import {
  borrarRutina, buscarRutina, copiar, empezarDia, enlaceCompartir, guardarCompartida, guardarRutina, misRutinas, nuevaRutina,
} from '../mis-rutinas';
import { deEnlace, LIMITES, type Objetivo, type Rutina } from '../rutinas.js';
import { enlace, irA } from '../rutas';
import { t } from '../textos';

const idioma = (): string => document.documentElement.lang || 'es';
const numero = (n: number): string => new Intl.NumberFormat(idioma()).format(n);
const escapar = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const plural = (clave: string, n: number): string =>
  t(`${clave}.${new Intl.PluralRules(idioma()).select(n) === 'one' ? 'una' : 'varias'}`).replace('{n}', numero(n));

/** «8–12 rep.» o «30–45 s»: la unidad la pone la ficha, que es la que sabe cómo se mide. */
export function textoRango(o: Objetivo): string {
  const rango = o.min === o.max ? numero(o.min) : `${numero(o.min)}–${numero(o.max)}`;
  return t(fichaPorId(o.ejercicio)?.medida === 'tiempo' ? 'rutinas.rango_tiempo' : 'rutinas.rango_reps').replace('{rango}', rango);
}

/** «3 × 8–12 rep.» */
export const textoObjetivo = (o: Objetivo): string =>
  t('rutinas.objetivo').replace('{series}', numero(o.series)).replace('{rango}', textoRango(o));

const ejerciciosDe = (r: Rutina): number => r.dias.reduce((n, d) => n + d.ejercicios.length, 0);

/* ------------------------------------------------------------------- lista -- */

export function montarListaRutinas(el: HTMLElement): void {
  const propias = misRutinas();
  el.innerHTML = `
    <section>
      <h2>${t('rutinas.tuyas')}</h2>
      ${propias.length ? `
        <ul class="tarjetas-rutina">${propias.map((r) => `
          <li><a href="${enlace({ vista: 'rutina', id: r.id, filtros: {} })}">
            <span class="nombre">${escapar(r.nombre)}</span>
            <span class="detalle">${plural('rutinas.dias', r.dias.length)} · ${plural('rutinas.ejercicios', ejerciciosDe(r))}</span>
          </a></li>`).join('')}
        </ul>` : `<p class="ayuda">${t('rutinas.sin_propias')}</p>`}
      <button type="button" class="boton" data-nueva>${t('rutinas.nueva')}</button>
    </section>
    <section>
      <h2>${t('rutinas.de_inicio')}</h2>
      <ul class="tarjetas-rutina">${RUTINAS.map((r) => `
        <li><a href="${enlace({ vista: 'rutina', id: r.id, filtros: {} })}">
          <span class="nombre">${escapar(r.nombre)}</span>
          <span class="resumen">${escapar(r.resumen)}</span>
          <span class="detalle">${escapar(etiqueta('nivel', r.nivel))} · ${plural('rutinas.por_semana', r.frecuencia)}</span>
        </a></li>`).join('')}
      </ul>
    </section>`;

  el.querySelector('[data-nueva]')?.addEventListener('click', () => {
    const r = nuevaRutina(t('rutinas.nombre_nueva'), t('rutinas.dia_n').replace('{n}', '1'));
    irA({ vista: 'rutina', id: r.id, editar: true, filtros: {} });
  });
}

/* ------------------------------------------------------------------ detalle -- */

/** El cuerpo de una rutina, para leer: sus días y sus ejercicios. Lo usan el detalle y la compartida. */
function dias(r: Rutina, conEmpezar: boolean): string {
  return r.dias.map((d, i) => `
    <section class="dia">
      <div class="dia-cabeza">
        <h2>${escapar(d.nombre)}</h2>
        ${conEmpezar && d.ejercicios.length ? `<button type="button" class="boton" data-empezar="${i}">${t('rutinas.empezar')}</button>` : ''}
      </div>
      ${d.ejercicios.length ? `
        <ol class="objetivos">${d.ejercicios.map((o) => {
          const f = fichaPorId(o.ejercicio);
          return `<li><a href="${enlace({ vista: 'ficha', id: o.ejercicio, filtros: {} })}">${escapar(f?.nombre ?? o.ejercicio)}</a>
            <span class="objetivo">${textoObjetivo(o)}</span></li>`;
        }).join('')}
        </ol>` : `<p class="ayuda">${t('rutinas.dia_vacio')}</p>`}
    </section>`).join('');
}

export function montarRutina(el: HTMLElement, id: string): { titulo: string; entradilla: string } | null {
  const encontrada = buscarRutina(id);
  if (!encontrada) return null;
  const { rutina, deInicio } = encontrada;
  let estado = '';
  let confirmando = false;

  function pintar(): void {
    el.innerHTML = `
      <dl class="datos">
        ${deInicio ? `<div class="dato"><dt>${t('ficha.nivel')}</dt><dd>${escapar(etiqueta('nivel', deInicio.nivel))}</dd></div>
          <div class="dato"><dt>${t('rutinas.frecuencia')}</dt><dd>${plural('rutinas.por_semana', deInicio.frecuencia)}</dd></div>` : ''}
        <div class="dato"><dt>${t('rutinas.sesiones')}</dt><dd>${plural('rutinas.dias', rutina.dias.length)}</dd></div>
      </dl>
      <div class="fila acciones-rutina">
        ${deInicio
          ? `<button type="button" class="boton principal" data-copiar>${t('rutinas.copiar')}</button>`
          : confirmando
            ? `<button type="button" class="boton peligro" data-borrar-si>${t('rutinas.borrar_si')}</button>
               <button type="button" class="boton" data-borrar-no>${t('datos.cancelar')}</button>`
            : `<a class="boton principal" href="${enlace({ vista: 'rutina', id: rutina.id, editar: true, filtros: {} })}">${t('rutinas.editar')}</a>
               <button type="button" class="boton" data-compartir>${t('rutinas.compartir')}</button>
               <button type="button" class="boton" data-borrar>${t('rutinas.borrar')}</button>`}
      </div>
      <p class="estado" role="status">${estado}</p>
      ${dias(rutina, true)}
      ${deInicio?.matices ? `<section class="matices"><h2>${t('ficha.matices')}</h2><p>${escapar(deInicio.matices)}</p></section>` : ''}
      ${deInicio?.fuentes?.length ? `<section class="fuentes"><h2>${t('ficha.fuentes')}</h2><ul>${deInicio.fuentes.map(
        (s) => `<li>${s.url ? `<a href="${escapar(s.url)}" rel="noreferrer">${escapar(s.titulo)}</a>` : escapar(s.titulo)}${s.autor ? ` · ${escapar(s.autor)}` : ''}</li>`,
      ).join('')}</ul></section>` : ''}
      <p><a class="boton" href="${enlace({ vista: 'rutinas', filtros: {} })}"><span class="icono" aria-hidden="true">←</span>${t('rutinas.todas')}</a></p>`;
  }

  el.addEventListener('click', async (e) => {
    const boton = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!boton) return;
    const d = boton.dataset;
    if (d.empezar !== undefined) {
      empezarDia(rutina.id, Number(d.empezar));
      // Directo al primer ejercicio del día, con su maniquí: empezar el día ES abrir ese ejercicio.
      irA({ vista: 'hoy', id: rutina.dias[Number(d.empezar)]?.ejercicios[0]?.ejercicio, filtros: {} });
    }
    if ('copiar' in d) {
      const copia = copiar(rutina, t('rutinas.nombre_copia').replace('{nombre}', rutina.nombre));
      irA({ vista: 'rutina', id: copia.id, editar: true, filtros: {} });
    }
    if ('compartir' in d) {
      const url = enlaceCompartir(rutina);
      /*
       * La hoja de compartir del sistema si la hay —en el móvil es lo que se espera: WhatsApp,
       * mensajes, correo—, y si no, al portapapeles. Cancelar la hoja lanza un AbortError que no es
       * un fallo: no se cae al portapapeles por eso.
       */
      try {
        if (navigator.share) { await navigator.share({ title: rutina.nombre, url }); return; }
        await navigator.clipboard.writeText(url);
        estado = t('rutinas.copiado');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        estado = t('rutinas.no_copiado');
      }
      pintar();
    }
    if ('borrar' in d) { confirmando = true; pintar(); el.querySelector<HTMLButtonElement>('[data-borrar-no]')?.focus(); }
    if ('borrarNo' in d) { confirmando = false; pintar(); el.querySelector<HTMLButtonElement>('[data-borrar]')?.focus(); }
    if ('borrarSi' in d) { borrarRutina(rutina.id); irA({ vista: 'rutinas', filtros: {} }); }
  });

  pintar();
  return { titulo: rutina.nombre, entradilla: deInicio?.resumen ?? '' };
}

/* --------------------------------------------------------------- compartida -- */

export function montarCompartida(el: HTMLElement, texto: string): { titulo: string } | null {
  const rutina = deEnlace(texto, 'compartida');
  if (!rutina) return null;
  el.innerHTML = `
    <p class="ayuda">${t('rutinas.compartida_texto')}</p>
    <div class="fila acciones-rutina">
      <button type="button" class="boton principal" data-guardar>${t('rutinas.guardar_compartida')}</button>
    </div>
    ${dias(rutina, false)}`;
  el.querySelector('[data-guardar]')?.addEventListener('click', () => {
    const suya = guardarCompartida(rutina);
    irA({ vista: 'rutina', id: suya.id, filtros: {} });
  });
  return { titulo: rutina.nombre };
}

/* ------------------------------------------------------------------- editor -- */

/*
 * Añadir o cambiar un ejercicio es un <select>: en el móvil se abre con la rueda del sistema, y con
 * cincuenta ejercicios agrupados por patrón se encuentra cualquiera sin teclear.
 */
const opcionesAgrupadas = (): string => GRUPOS.map((g) => `<optgroup label="${escapar(g.nombre)}">${FICHAS
  .filter((f) => f.grupo_id === g.id).map((f) => `<option value="${f.id}">${escapar(f.nombre)}</option>`).join('')}</optgroup>`).join('');

/**
 * Las alternativas de un ejercicio: los de su mismo grupo, que en befit es su patrón de movimiento.
 * Cambiar un press de banca por unas flexiones mantiene el empuje horizontal del día; cambiarlo por
 * un curl, no. Por eso no se ofrece el catálogo entero.
 */
const alternativas = (f: Ficha): Ficha[] => FICHAS.filter((x) => x.grupo_id === f.grupo_id && x.id !== f.id);

export function montarEditor(el: HTMLElement, id: string): { titulo: string } | null {
  const encontrada = buscarRutina(id);
  // Solo las del visitante se editan; a una de inicio se llega aquí por un enlace escrito a mano.
  if (!encontrada || encontrada.deInicio) return null;
  const rutina: Rutina = structuredClone(encontrada.rutina);

  const guardar = (): void => guardarRutina(rutina);

  const campoNumero = (d: number, e: number, campo: 'series' | 'min' | 'max', valor: number, etiquetaCampo: string): string => `
    <label class="campo">
      <span>${etiquetaCampo}</span>
      <input type="number" inputmode="numeric" min="1" max="${campo === 'series' ? LIMITES.series : LIMITES.valor}" step="1"
             value="${valor}" data-d="${d}" data-e="${e}" data-campo="${campo}" />
    </label>`;

  function pintar(): void {
    el.innerHTML = `
      <form class="editor" novalidate>
        <label class="campo nombre-rutina">
          <span>${t('rutinas.nombre')}</span>
          <input name="nombre" maxlength="${LIMITES.nombre}" value="${escapar(rutina.nombre)}" required />
        </label>
        ${rutina.dias.map((dia, d) => `
          <fieldset class="dia-editor">
            <legend class="oculto">${escapar(dia.nombre)}</legend>
            <div class="dia-cabeza">
              <label class="campo">
                <span>${t('rutinas.nombre_dia')}</span>
                <input maxlength="${LIMITES.nombre}" value="${escapar(dia.nombre)}" data-dia-nombre="${d}" required />
              </label>
              ${rutina.dias.length > 1 ? `<button type="button" class="boton plano" data-quitar-dia="${d}">${t('rutinas.quitar_dia')}</button>` : ''}
            </div>
            <ol class="filas">${dia.ejercicios.map((o, e) => {
              const f = fichaPorId(o.ejercicio);
              const unidad = t(f?.medida === 'tiempo' ? 'rutinas.unidad_tiempo' : 'rutinas.unidad_reps');
              const nombre = escapar(f?.nombre ?? o.ejercicio);
              return `
                <li>
                  <div class="fila-cabeza">
                    <span class="nombre">${nombre}</span>
                    <span class="orden">
                      <button type="button" class="boton plano" data-mover="${d},${e},-1" ${e === 0 ? 'disabled' : ''}
                              aria-label="${escapar(t('rutinas.subir').replace('{nombre}', f?.nombre ?? o.ejercicio))}"><span class="icono" aria-hidden="true">↑</span></button>
                      <button type="button" class="boton plano" data-mover="${d},${e},1" ${e === dia.ejercicios.length - 1 ? 'disabled' : ''}
                              aria-label="${escapar(t('rutinas.bajar').replace('{nombre}', f?.nombre ?? o.ejercicio))}"><span class="icono" aria-hidden="true">↓</span></button>
                      <button type="button" class="boton plano" data-quitar="${d},${e}"
                              aria-label="${escapar(t('rutinas.quitar').replace('{nombre}', f?.nombre ?? o.ejercicio))}"><span class="icono" aria-hidden="true">✕</span></button>
                    </span>
                  </div>
                  <div class="numeros">
                    ${campoNumero(d, e, 'series', o.series, t('rutinas.series'))}
                    ${campoNumero(d, e, 'min', o.min, t('rutinas.minimo').replace('{unidad}', unidad))}
                    ${campoNumero(d, e, 'max', o.max, t('rutinas.maximo').replace('{unidad}', unidad))}
                  </div>
                  ${f && alternativas(f).length ? `
                    <label class="campo cambiar">
                      <span>${t('rutinas.cambiar')}</span>
                      <select data-cambiar="${d},${e}">
                        <option value="">${t('rutinas.cambiar_elige')}</option>
                        ${alternativas(f).map((x) => `<option value="${x.id}">${escapar(x.nombre)}</option>`).join('')}
                      </select>
                    </label>` : ''}
                </li>`;
            }).join('')}
            </ol>
            ${dia.ejercicios.length < LIMITES.ejercicios ? `
              <label class="anadir">
                <span>${t('hoy.anadir')}</span>
                <select data-anadir-a="${d}"><option value="">${t('hoy.elegir')}</option>${opcionesAgrupadas()}</select>
              </label>` : ''}
          </fieldset>`).join('')}
        <div class="fila">
          ${rutina.dias.length < LIMITES.dias ? `<button type="button" class="boton" data-anadir-dia>${t('rutinas.anadir_dia')}</button>` : ''}
          <a class="boton principal" href="${enlace({ vista: 'rutina', id: rutina.id, filtros: {} })}">${t('rutinas.listo')}</a>
        </div>
      </form>`;
  }

  /*
   * Repintar solo tras un cambio de ESTRUCTURA —añadir, quitar, mover, cambiar—, nunca al escribir
   * un número o un nombre. Repintar en el `change` de un número pasaba al siguiente campo con el
   * tabulador... y el repintado se llevaba el foco de ese campo nuevo: había que volver a tocarlo.
   */
  function repintar(foco?: string): void {
    pintar();
    if (foco) el.querySelector<HTMLElement>(foco)?.focus();
  }

  el.addEventListener('submit', (e) => e.preventDefault());

  el.addEventListener('change', (e) => {
    const campo = e.target as HTMLInputElement | HTMLSelectElement;
    const ds = campo.dataset;

    if (campo.name === 'nombre') {
      // Un nombre vacío no se guarda: se devuelve el que había, en vez de dejar una rutina sin título.
      if (campo.value.trim()) { rutina.nombre = campo.value.trim(); guardar(); } else campo.value = rutina.nombre;
      // El titular de la página dice qué se edita; con el nombre viejo parecía que no se había guardado.
      const titular = document.querySelector('.portada')?.querySelector('h1');
      if (titular) titular.textContent = t('rutinas.editando').replace('{nombre}', rutina.nombre);
      return;
    }
    if (ds.diaNombre !== undefined) {
      const dia = rutina.dias[Number(ds.diaNombre)]!;
      if (campo.value.trim()) { dia.nombre = campo.value.trim(); guardar(); } else campo.value = dia.nombre;
      return;
    }
    if (ds.campo) {
      const o = rutina.dias[Number(ds.d)]!.ejercicios[Number(ds.e)]!;
      const clave = ds.campo as 'series' | 'min' | 'max';
      const n = Math.round(Number(campo.value));
      const tope = clave === 'series' ? LIMITES.series : LIMITES.valor;
      // Un número que no vale se deshace en el campo, no se guarda: guardar «0 series» haría que la
      // normalización quitara el ejercicio entero de la rutina sin decir nada.
      if (!Number.isFinite(n) || n < 1 || n > tope) { campo.value = String(o[clave]); return; }
      o[clave] = n;
      /*
       * Un rango al revés se endereza AQUÍ y en pantalla, no solo al guardar. Solo al guardar, lo
       * guardado era «10–15» mientras los campos seguían diciendo mínimo 15 y máximo 10, y al
       * volver a tocar uno se guardaba lo que se veía, no lo que había.
       */
      if (o.min > o.max) {
        [o.min, o.max] = [o.max, o.min];
        el.querySelector<HTMLInputElement>(`[data-d="${ds.d}"][data-e="${ds.e}"][data-campo="min"]`)!.value = String(o.min);
        el.querySelector<HTMLInputElement>(`[data-d="${ds.d}"][data-e="${ds.e}"][data-campo="max"]`)!.value = String(o.max);
      }
      guardar();
      return;
    }
    if (ds.cambiar && campo.value) {
      const [d, e] = ds.cambiar.split(',').map(Number) as [number, number];
      rutina.dias[d]!.ejercicios[e]!.ejercicio = campo.value;
      guardar();
      repintar(`[data-cambiar="${d},${e}"]`);
      return;
    }
    if (ds.anadirA !== undefined && campo.value) {
      const d = Number(ds.anadirA);
      const f = fichaPorId(campo.value);
      // El objetivo inicial, del tipo de ejercicio: 3 × 8-12, o 3 × 20-40 s si se sostiene.
      rutina.dias[d]!.ejercicios.push({ ejercicio: campo.value, series: 3, min: f?.medida === 'tiempo' ? 20 : 8, max: f?.medida === 'tiempo' ? 40 : 12 });
      guardar();
      repintar(`[data-anadir-a="${d}"]`);
    }
  });

  el.addEventListener('click', (e) => {
    const boton = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!boton) return;
    const ds = boton.dataset;
    if (ds.mover) {
      const [d, i, paso] = ds.mover.split(',').map(Number) as [number, number, number];
      const lista = rutina.dias[d]!.ejercicios;
      [lista[i], lista[i + paso]] = [lista[i + paso]!, lista[i]!];
      guardar();
      // El foco sigue al ejercicio, no al hueco: pulsar ↓ tres veces baja el mismo tres puestos.
      const destino = `[data-mover="${d},${i + paso},${paso}"]`;
      repintar(el.querySelector(destino) ? destino : `[data-mover="${d},${i + paso},${-paso}"]`);
    }
    if (ds.quitar) {
      const [d, i] = ds.quitar.split(',').map(Number) as [number, number];
      rutina.dias[d]!.ejercicios.splice(i, 1);
      guardar();
      repintar(`[data-anadir-a="${d}"]`);
    }
    if (ds.quitarDia !== undefined) {
      rutina.dias.splice(Number(ds.quitarDia), 1);
      guardar();
      repintar('input[name=nombre]');
    }
    if ('anadirDia' in ds) {
      rutina.dias.push({ nombre: t('rutinas.dia_n').replace('{n}', String(rutina.dias.length + 1)), ejercicios: [] });
      guardar();
      repintar(`[data-dia-nombre="${rutina.dias.length - 1}"]`);
    }
  });

  pintar();
  return { titulo: rutina.nombre };
}
