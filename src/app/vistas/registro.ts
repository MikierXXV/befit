/**
 * El bloque «Tu registro» de la ficha: anotar una serie, las de hoy, la mejor marca, el 1RM
 * estimado, la evolución y las sesiones anteriores.
 *
 * SE REPINTA SOLO ÉL, nunca la ficha entera. Anotar una serie entre dos del ejercicio es lo que más
 * se va a hacer, y repintar la ficha destruiría y volvería a montar el maniquí —un contexto WebGL,
 * Three.js y el modelo— a cada toque, con la pantalla parpadeando en mitad del gimnasio.
 */

import { evolucion, hoy, mejorMarca, queSeSigue, REPS_FIABLES, sesiones, unoRM } from '../calculos.js';
import type { Ficha } from '../contenido';
import type { Serie } from '../datos.js';
import { anotar, borrar, restaurar, seriesDe } from '../registro';
import { enlace } from '../rutas';
import { t } from '../textos';

const idioma = (): string => document.documentElement.lang || 'es';
const numero = (n: number): string => new Intl.NumberFormat(idioma(), { maximumFractionDigits: 1 }).format(n);
const con = (clave: string, valores: Record<string, string | number>): string =>
  Object.entries(valores).reduce((texto, [k, v]) => texto.replaceAll(`{${k}}`, typeof v === 'number' ? numero(v) : v), t(clave));

/*
 * La fecha se reconstruye con año, mes y día, no con `new Date('2026-09-24')`: esa forma se lee
 * como medianoche UTC, y en cualquier huso al oeste de Greenwich la sesión salía rotulada con el
 * día anterior.
 */
function fecha(dia: string, largo = false): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(idioma(), largo ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' })
    .format(new Date(a, m - 1, d));
}

/** Una serie en una línea: «60 kg × 8», «12 rep.», «45 s». El RIR aparte, si se anotó. */
function textoSerie(s: Serie): string {
  const partes: string[] = [];
  if (s.segundos !== undefined) {
    partes.push(con('registro.formato.segundos', { v: s.segundos }));
    if (s.peso) partes.unshift(con('registro.formato.kg', { v: s.peso }));
    return partes.join(' · ');
  }
  return s.peso ? con('registro.formato.peso_reps', { peso: s.peso, reps: s.reps ?? 0 }) : con('registro.formato.reps', { v: s.reps ?? 0 });
}

const textoRir = (s: Serie): string => (s.rir === undefined ? '' : con('registro.formato.rir', { v: s.rir }));

/**
 * La evolución, en SVG hecho a mano. Sin librería: una línea y unos puntos no justifican 50 kB en
 * un presupuesto de JS que vigila `auditar.mjs`.
 *
 * El SVG se estira con `preserveAspectRatio="none"` para llenar el ancho, y por eso NO lleva texto
 * dentro —las letras se deformarían con él—: los rótulos de los ejes son HTML alrededor. Los puntos
 * son trazos de longitud cero con remate redondo y `non-scaling-stroke`: un <circle> estirado se
 * vuelve un óvalo, un remate redondo sigue siendo un círculo.
 *
 * El eje horizontal es el calendario, no el número de sesión: dos sesiones separadas por un mes de
 * parón no son vecinas, y dibujarlas juntas escondería justo el parón.
 */
function grafica(puntos: Array<{ fecha: string; valor: number }>, tipo: string): string {
  const dia = (f: string): number => {
    const [a, m, d] = f.split('-').map(Number) as [number, number, number];
    return Date.UTC(a, m - 1, d);
  };
  const x0 = dia(puntos[0]!.fecha);
  const x1 = dia(puntos[puntos.length - 1]!.fecha);
  const valores = puntos.map((p) => p.valor);
  const bajo = Math.min(...valores);
  const alto = Math.max(...valores);
  // Un margen del 10 % por arriba y por abajo, para que el punto más alto no quede cortado por la
  // mitad contra el borde. Con todos iguales, la línea va por el centro y no por el suelo.
  const holgura = alto === bajo ? Math.max(1, alto * 0.1) : (alto - bajo) * 0.1;
  const [ymin, ymax] = [bajo - holgura, alto + holgura];
  const px = (f: string): number => 2 + ((dia(f) - x0) / Math.max(1, x1 - x0)) * 96;
  const py = (v: number): number => 38 - ((v - ymin) / (ymax - ymin)) * 36;
  const traza = puntos.map((p) => `${px(p.fecha).toFixed(2)},${py(p.valor).toFixed(2)}`).join(' ');
  const unidad = (v: number): string => con(`registro.formato.${tipo === '1rm' ? 'kg' : tipo}`, { v });
  const resumen = con('registro.grafica_resumen', {
    desde: unidad(puntos[0]!.valor),
    hasta: unidad(puntos[puntos.length - 1]!.valor),
    sesiones: String(puntos.length),
  });

  return `
    <figure class="evolucion">
      <figcaption>${t(`registro.evolucion.${tipo}`)}</figcaption>
      <div class="lienzo">
        <div class="eje-y" aria-hidden="true"><span>${unidad(alto)}</span><span>${unidad(bajo)}</span></div>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${escapar(resumen)}">
          <line class="guia" x1="0" x2="100" y1="${py(alto)}" y2="${py(alto)}" />
          <line class="guia" x1="0" x2="100" y1="${py(bajo)}" y2="${py(bajo)}" />
          <polyline class="linea" points="${traza}" />
          ${puntos.map((p) => `<path class="punto" d="M${px(p.fecha).toFixed(2)} ${py(p.valor).toFixed(2)}h0" />`).join('')}
        </svg>
        <span></span>
        <div class="eje-x" aria-hidden="true"><span>${fecha(puntos[0]!.fecha)}</span><span>${fecha(puntos[puntos.length - 1]!.fecha)}</span></div>
      </div>
    </figure>`;
}

/** Monta el bloque en `el`. No hay nada que desmontar: vive y muere con el HTML de la ficha. */
export function montarRegistro(el: HTMLElement, f: Ficha): void {
  const medida = f.medida ?? 'reps';
  const sinMaterial = f.material?.includes('ninguno') ?? false;
  let deshacer: Serie | null = null;
  let estado = '';

  function pintar(): void {
    const todas = seriesDe(f.id);
    const porDia = sesiones(todas);
    const deHoy = porDia[0]?.fecha === hoy() ? porDia[0].series : [];
    const anteriores = porDia.filter((s) => s.fecha !== hoy()).slice(0, 5);
    // La última serie rellena el formulario: la siguiente suele ser igual, y en el gimnasio se
    // anota con una mano y el móvil sudado. Cambiar un número es más rápido que escribir dos.
    const ultima = todas.slice().sort((a, b) => b.creada - a.creada)[0];
    const mejor = mejorMarca(todas, medida);
    const tipo = queSeSigue(todas, medida);
    const rm = tipo === '1rm' ? todas.map(unoRM).filter((r) => r !== null).sort((a, b) => b.kilos - a.kilos)[0] : null;
    const { puntos } = evolucion(todas, medida);

    const campoPeso = `
      <label class="campo">
        <span>${t(sinMaterial ? 'registro.lastre' : 'registro.peso')}</span>
        <input name="peso" type="number" inputmode="decimal" min="0" max="999" step="0.5"
               value="${ultima?.peso ?? ''}" placeholder="${sinMaterial ? '0' : ''}" />
      </label>`;
    const campoCantidad = medida === 'tiempo'
      ? `<label class="campo"><span>${t('registro.segundos')}</span>
           <input name="segundos" type="number" inputmode="numeric" min="1" max="3600" step="1" required value="${ultima?.segundos ?? ''}" /></label>`
      : `<label class="campo"><span>${t('registro.reps')}</span>
           <input name="reps" type="number" inputmode="numeric" min="1" max="100" step="1" required value="${ultima?.reps ?? ''}" /></label>`;
    const campoRir = medida === 'tiempo' ? '' : `
      <label class="campo">
        <span>${t('registro.rir')}</span>
        <select name="rir">
          <option value="">${t('registro.rir_sin')}</option>
          ${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join('')}
        </select>
      </label>`;

    el.innerHTML = `
      <h2 id="registro-titulo">${t('registro.titulo')}</h2>
      <form class="anotar" aria-labelledby="registro-titulo">
        <div class="campos">${campoPeso}${campoCantidad}${campoRir}</div>
        <button type="submit" class="boton principal">${t('registro.anotar')}</button>
      </form>
      ${medida === 'tiempo' ? '' : `<p class="ayuda">${t('registro.rir_ayuda')}</p>`}
      <p class="estado" role="status">${estado}${deshacer ? ` <button type="button" class="boton plano" data-deshacer>${t('registro.deshacer')}</button>` : ''}</p>

      ${deHoy.length ? `
        <h3>${t('registro.hoy')}</h3>
        <ol class="series">${deHoy.map((s, n) => `
          <li>
            <span class="n">${n + 1}</span>
            <span class="valor">${textoSerie(s)}</span>
            <span class="rir">${textoRir(s)}</span>
            <button type="button" class="boton plano" data-borrar="${s.id}" aria-label="${escapar(con('registro.borrar', { n: String(n + 1) }))}">
              <span class="icono" aria-hidden="true">✕</span>
            </button>
          </li>`).join('')}
        </ol>` : ''}

      ${todas.length ? `
        <dl class="datos marcas">
          ${mejor ? `<div class="dato"><dt>${t('registro.mejor')}</dt><dd>${textoSerie(mejor)}</dd></div>` : ''}
          ${rm ? `<div class="dato"><dt>${t('registro.unorm')}</dt><dd>${con('registro.formato.kg', { v: rm.kilos })}${rm.fiable ? '' : ' *'}</dd></div>` : ''}
        </dl>
        ${rm ? `<p class="ayuda">${t('registro.unorm_nota')}${rm.fiable ? '' : ` * ${con('registro.unorm_aviso', { n: String(REPS_FIABLES) })}`}</p>` : ''}
        ${puntos.length >= 2 ? grafica(puntos, tipo) : ''}
      ` : `<p class="ayuda">${t('registro.vacio')}</p>`}

      ${anteriores.length ? `
        <h3>${t('registro.anteriores')}</h3>
        <ul class="sesiones">${anteriores.map((s) => `
          <li><span class="dia">${fecha(s.fecha, true)}</span>
              <span class="lista">${s.series.map(textoSerie).join(', ')}</span></li>`).join('')}
        </ul>` : ''}

      <p class="enlace-datos"><a href="${enlace({ vista: 'datos', filtros: {} })}">${t('registro.tus_datos')}</a></p>`;
  }

  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const leer = (nombre: string): number | undefined => {
      const campo = form.elements.namedItem(nombre) as HTMLInputElement | HTMLSelectElement | null;
      if (!campo || campo.value === '') return undefined;
      const n = Number(campo.value);
      return Number.isFinite(n) ? n : undefined;
    };
    const serie = anotar({ ejercicio: f.id, peso: leer('peso') || undefined, reps: leer('reps'), segundos: leer('segundos'), rir: leer('rir') });
    deshacer = null;
    estado = serie ? t('registro.anotada') : t('registro.error');
    pintar();
    // El foco vuelve al botón, no se pierde en el <body>: la siguiente serie es otro toque en el
    // mismo sitio, y con lector de pantalla perder el foco es perder el sitio en la página.
    el.querySelector<HTMLButtonElement>('.anotar button')?.focus();
  });

  el.addEventListener('click', (e) => {
    const boton = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!boton) return;
    if (boton.dataset.borrar) {
      deshacer = borrar(boton.dataset.borrar);
      estado = t('registro.borrada');
      pintar();
      el.querySelector<HTMLButtonElement>('[data-deshacer]')?.focus();
    } else if ('deshacer' in boton.dataset && deshacer) {
      restaurar(deshacer);
      deshacer = null;
      estado = '';
      pintar();
      el.querySelector<HTMLButtonElement>('.anotar button')?.focus();
    }
  });

  pintar();
}

const escapar = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
