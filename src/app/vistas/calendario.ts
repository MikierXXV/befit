/**
 * El calendario: qué toca cada día y qué se hizo.
 *
 * Arriba, la semana o el mes; debajo, «Tu semana», donde se elige una rutina y qué día suyo va en
 * cada día de la semana. Lo planificado sale de ahí (y de los cambios sueltos, en `calendario.js`);
 * lo hecho sale de las series anotadas, que son la única verdad de lo que se entrenó: un día
 * planificado en el que se anotó otra cosa se enseña con lo que se anotó.
 *
 * La SEMANA es la vista por defecto porque en el móvil se lee de arriba abajo con los ejercicios de
 * cada día. El MES es un vistazo con marcas; tocar un día lleva a su semana.
 */

import { datos } from '../almacen';
import { ejerciciosDelDia, hoy } from '../calculos.js';
import {
  diaDeLaSemana, mesDe, planDeFecha, repartir, semanaDe, sumarDias, sumarMeses, type DiaPlaneado,
} from '../calendario.js';
import { fichaPorId, RUTINAS } from '../contenido';
import {
  buscarRutina, calendario, cambiarFecha, diaPlaneado, misRutinas, planDeHoy, ponerSemana, quitarSemana, type PlanDeHoy,
} from '../mis-rutinas';
import { progreso, type Rutina } from '../rutinas.js';
import { enlace, type Ruta } from '../rutas';
import { t } from '../textos';

const idioma = (): string => document.documentElement.lang || 'es';
const numero = (n: number): string => new Intl.NumberFormat(idioma()).format(n);
const escapar = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const plural = (clave: string, n: number): string =>
  t(`${clave}.${new Intl.PluralRules(idioma()).select(n) === 'one' ? 'una' : 'varias'}`).replace('{n}', numero(n));

/** La fecha en hora LOCAL: `new Date('2026-09-28')` sería medianoche UTC, el domingo en América. */
const aDate = (fecha: string): Date => {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(a!, m! - 1, d!);
};
const formato = (fecha: string, opciones: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(idioma(), opciones).format(aDate(fecha));

/** Nombres de los días de la semana, de lunes a domingo, sacados de una semana cualquiera. */
const nombresDias = (largo: 'short' | 'long' | 'narrow'): string[] =>
  semanaDe('2026-09-28').map((f) => formato(f, { weekday: largo }));

/** Todas las rutinas que se pueden planificar: las del visitante primero, luego las de inicio. */
const todas = (): Rutina[] => [...misRutinas(), ...RUTINAS];

/* -------------------------------------------------------------- un día -- */

type Estado = 'completo' | 'parcial' | 'nulo' | 'libre' | 'futuro' | 'descanso';

interface Dia {
  fecha: string;
  plan: PlanDeHoy | null;
  /** Cambiado a mano en esa fecha, no por la semana. */
  cambio: boolean;
  hechos: ReturnType<typeof ejerciciosDelDia>;
  estado: Estado;
}

function dia(fecha: string): Dia {
  const hoyEs = hoy();
  const { plan: planeado, origen } = planDeFecha(calendario(), fecha);
  // Hoy manda lo que diga «Hoy»: si se eligió otro día de rutina a mano, es ese el que se está haciendo.
  const plan = fecha === hoyEs ? planDeHoy() : planeado ? diaPlaneado(planeado) : null;
  const hechos = ejerciciosDelDia(datos().series, fecha);
  let estado: Estado;
  if (plan) {
    const avance = progreso({ nombre: plan.nombreDia, ejercicios: plan.ejercicios }, datos().series.filter((s) => s.fecha === fecha));
    estado = avance.length && avance.every((o) => o.completo) ? 'completo'
      : avance.some((o) => o.hechas > 0) || hechos.length ? 'parcial'
      : fecha < hoyEs ? 'nulo' : 'futuro';
  } else {
    estado = hechos.length ? 'libre' : 'descanso';
  }
  return { fecha, plan, cambio: origen === 'cambio', hechos, estado };
}

const textoEstado = (e: Estado): string => t(`calendario.estado.${e}`);

/* --------------------------------------------------------------- semana -- */

/** Las opciones de un día suelto: como la semana, descanso, o cualquier día de cualquier rutina. */
function opcionesCambio(d: Dia): string {
  const actual = calendario().cambios[d.fecha];
  const valor = !d.cambio ? '' : actual ? `${actual.rutina}|${actual.dia}` : 'nada';
  const opcion = (v: string, texto: string): string =>
    `<option value="${escapar(v)}" ${v === valor ? 'selected' : ''}>${escapar(texto)}</option>`;
  return `
    ${opcion('', t('calendario.como_semana'))}
    ${opcion('nada', t('calendario.estado.descanso'))}
    ${todas().map((r) => `<optgroup label="${escapar(r.nombre)}">${r.dias.map((x, i) => opcion(`${r.id}|${i}`, x.nombre)).join('')}</optgroup>`).join('')}`;
}

function tarjetaDia(d: Dia, largos: string[]): string {
  const hoyEs = hoy();
  const esHoy = d.fecha === hoyEs;
  const editable = d.fecha >= hoyEs;
  const nombre = (id: string): string => escapar(fichaPorId(id)?.nombre ?? id);
  // Lo hecho, si hay; si no, lo planificado. Un día pasado planificado y sin nada anotado enseña lo
  // que tocaba, para que se vea qué se dejó.
  const lista = d.hechos.length
    ? d.hechos.map((e) => `<li>${nombre(e.ejercicio)} <span class="cuantas">${plural('hoy.series', e.series.length)}</span></li>`).join('')
    : d.plan?.ejercicios.map((o) => `<li>${nombre(o.ejercicio)}</li>`).join('') ?? '';
  return `
    <li class="cal-dia" data-estado="${d.estado}" ${esHoy ? 'aria-current="date"' : ''} ${d.fecha < hoyEs ? 'data-pasado' : ''}>
      <div class="cal-dia-cabeza">
        <h3><span class="dia-semana">${escapar(largos[diaDeLaSemana(d.fecha)]!)}</span>
          <span class="dia-numero">${escapar(formato(d.fecha, { day: 'numeric', month: 'short' }))}</span></h3>
        <span class="cal-estado">${d.cambio ? `<span class="cal-cambio">${t('calendario.cambiado')}</span>` : ''}${textoEstado(d.estado)}</span>
      </div>
      ${d.plan ? `
        <p class="cal-plan"><strong>${escapar(d.plan.nombreDia)}</strong> · <span class="rutina">${escapar(d.plan.rutina.nombre)}</span></p>` : ''}
      ${lista ? `<ul class="cal-ejercicios" ${d.hechos.length ? 'data-hechos' : ''}>${lista}</ul>` : ''}
      ${esHoy && (d.plan || d.hechos.length) ? `<a class="boton principal" href="${enlace({ vista: 'hoy', filtros: {} })}">${t('calendario.ir_hoy')}</a>` : ''}
      ${editable ? `
        <details class="cal-cambiar">
          <summary>${t('calendario.cambiar')}</summary>
          <div class="campo"><label class="oculto" for="cambio-${d.fecha}">${t('calendario.cambiar')}</label>
          <select id="cambio-${d.fecha}" data-cambiar-fecha="${d.fecha}">${opcionesCambio(d)}</select></div>
        </details>` : ''}
    </li>`;
}

function vistaSemana(fecha: string): string {
  const largos = nombresDias('long');
  return `<ol class="cal-semana">${semanaDe(fecha).map((f) => tarjetaDia(dia(f), largos)).join('')}</ol>`;
}

/* ------------------------------------------------------------------ mes -- */

function vistaMes(fecha: string): string {
  const mes = fecha.slice(0, 7);
  const cortos = nombresDias('narrow');
  const largos = nombresDias('long');
  return `
    <div class="cal-mes" role="table" aria-label="${escapar(formato(`${mes}-01`, { month: 'long', year: 'numeric' }))}">
      <div class="cal-mes-fila cal-mes-cabeza" role="row">${cortos.map((c, i) =>
        `<span role="columnheader"><abbr title="${escapar(largos[i]!)}">${escapar(c)}</abbr></span>`).join('')}</div>
      ${mesDe(fecha).map((semana) => `
        <div class="cal-mes-fila" role="row">${semana.map((f) => {
          const d = dia(f);
          const fuera = f.slice(0, 7) !== mes;
          const etiqueta = `${formato(f, { weekday: 'long', day: 'numeric', month: 'long' })}: ${d.plan ? `${d.plan.nombreDia}, ` : ''}${textoEstado(d.estado)}`;
          return `<span role="cell"><a href="${enlace({ vista: 'calendario', modo: 'semana', id: f, filtros: {} })}"
            class="cal-celda" data-estado="${d.estado}" ${fuera ? 'data-fuera' : ''} ${f === hoy() ? 'aria-current="date"' : ''}
            aria-label="${escapar(etiqueta)}"><span class="numero">${numero(Number(f.slice(8)))}</span><span class="punto-estado" aria-hidden="true"></span></a></span>`;
        }).join('')}</div>`).join('')}
    </div>
    <ul class="cal-leyenda">${(['completo', 'parcial', 'nulo', 'futuro', 'libre'] as Estado[]).map((e) =>
      `<li><span class="punto-estado" data-estado="${e}" aria-hidden="true"></span>${textoEstado(e)}</li>`).join('')}</ul>`;
}

/* ----------------------------------------------------------- tu semana -- */

function tuSemana(): string {
  const s = calendario().semana;
  const rutinas = todas();
  const elegirRutina = (actual?: string): string => `
    <label for="semana-rutina">${t('calendario.rutina')}</label>
    <select id="semana-rutina" data-semana-rutina>
      ${actual ? '' : `<option value="" selected disabled>${t('calendario.elige_rutina')}</option>`}
      ${rutinas.map((r) => `<option value="${escapar(r.id)}" ${r.id === actual ? 'selected' : ''}>${escapar(r.nombre)}</option>`).join('')}
    </select>`;
  if (!s) {
    return `
      <section class="tu-semana" aria-labelledby="tu-semana-titulo">
        <h2 id="tu-semana-titulo">${t('calendario.tu_semana')}</h2>
        <p class="ayuda">${t('calendario.sin_semana')}</p>
        <div class="campo">${elegirRutina()}</div>
      </section>`;
  }
  const rutina = buscarRutina(s.rutina)?.rutina;
  const largos = nombresDias('long');
  return `
    <section class="tu-semana" aria-labelledby="tu-semana-titulo">
      <h2 id="tu-semana-titulo">${t('calendario.tu_semana')}</h2>
      <p class="ayuda">${t('calendario.ayuda_semana')}</p>
      <div class="campo">${elegirRutina(s.rutina)}</div>
      <ul class="semana-dias">${s.dias.map((d, i) => `
        <li class="campo"><label for="semana-dia-${i}">${escapar(largos[i]!)}</label>
          <select id="semana-dia-${i}" data-semana-dia="${i}">
            <option value="" ${d === null ? 'selected' : ''}>${t('calendario.estado.descanso')}</option>
            ${(rutina?.dias ?? []).map((x, j) => `<option value="${j}" ${d === j ? 'selected' : ''}>${escapar(x.nombre)}</option>`).join('')}
          </select></li>`).join('')}
      </ul>
      <button type="button" class="boton" data-quitar-semana>${t('calendario.quitar')}</button>
    </section>`;
}

/* --------------------------------------------------------------- montar -- */

export function montarCalendario(el: HTMLElement, ruta: Ruta): void {
  const modo = ruta.modo ?? 'semana';
  const fecha = ruta.id && /^\d{4}-\d{2}-\d{2}$/.test(ruta.id) ? ruta.id : hoy();
  const ir = (m: 'semana' | 'mes', f?: string): string => enlace({ vista: 'calendario', modo: m, id: f, filtros: {} });

  function pintar(): void {
    const semana = semanaDe(fecha);
    const titulo = modo === 'mes'
      ? formato(fecha, { month: 'long', year: 'numeric' })
      : t('calendario.rango')
        .replace('{desde}', formato(semana[0]!, { day: 'numeric', month: 'short' }))
        .replace('{hasta}', formato(semana[6]!, { day: 'numeric', month: 'short' }));
    const antes = modo === 'mes' ? sumarMeses(fecha, -1) : sumarDias(fecha, -7);
    const despues = modo === 'mes' ? sumarMeses(fecha, 1) : sumarDias(fecha, 7);
    const sinSemana = !calendario().semana;
    el.innerHTML = `
      ${sinSemana ? tuSemana() : ''}
      <div class="cal-barra">
        <div class="cal-modo" role="group" aria-label="${t('calendario.vista')}">
          <a class="boton" href="${ir('semana', fecha)}" ${modo === 'semana' ? 'aria-current="true"' : ''}>${t('calendario.semana')}</a>
          <a class="boton" href="${ir('mes', fecha)}" ${modo === 'mes' ? 'aria-current="true"' : ''}>${t('calendario.mes')}</a>
        </div>
        <div class="cal-paso">
          <a class="boton plano" href="${ir(modo, antes)}" aria-label="${t(`calendario.anterior_${modo}`)}"><span class="icono" aria-hidden="true">←</span></a>
          <h2 class="cal-titulo" aria-live="polite">${escapar(titulo)}</h2>
          <a class="boton plano" href="${ir(modo, despues)}" aria-label="${t(`calendario.siguiente_${modo}`)}"><span class="icono" aria-hidden="true">→</span></a>
        </div>
        <a class="boton" href="${ir(modo)}">${t('calendario.volver_hoy')}</a>
      </div>
      ${modo === 'mes' ? vistaMes(fecha) : vistaSemana(fecha)}
      ${sinSemana ? '' : tuSemana()}`;
  }

  el.addEventListener('change', (e) => {
    const campo = e.target as HTMLSelectElement;
    const d = campo.dataset;
    if (d.cambiarFecha) {
      const v = campo.value;
      const [rutina, n] = v.split('|');
      cambiarFecha(d.cambiarFecha, v === '' ? undefined : v === 'nada' ? null : { rutina: rutina!, dia: Number(n) } satisfies DiaPlaneado);
    } else if ('semanaRutina' in d) {
      // Una rutina nueva reparte sus días de nuevo: los índices de la anterior no significan nada en ella.
      const r = buscarRutina(campo.value)?.rutina;
      if (r) ponerSemana(r.id, repartir(r.dias.length));
    } else if (d.semanaDia !== undefined) {
      const s = calendario().semana;
      if (!s) return;
      const dias = [...s.dias];
      dias[Number(d.semanaDia)] = campo.value === '' ? null : Number(campo.value);
      // Siete días de descanso no planifican nada: es lo mismo que quitar la semana.
      if (dias.every((x) => x === null)) { quitarSemana(); } else { ponerSemana(s.rutina, dias); }
    } else {
      return;
    }
    const foco = campo.id;
    pintar();
    // Repintar se lleva el desplegable que se acaba de usar: el foco vuelve al suyo, con su
    // desplegable «Cambiar» abierto, para seguir con el teclado por donde se iba.
    const nuevo = document.getElementById(foco);
    nuevo?.closest('details')?.setAttribute('open', '');
    nuevo?.focus();
  });

  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-quitar-semana]')) {
      quitarSemana();
      pintar();
    }
  });

  pintar();
}
