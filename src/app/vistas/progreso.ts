/**
 * «Progreso»: qué músculos se han trabajado, cuánto por patrón y qué días.
 *
 * befit ENSEÑA y no receta. No hay «te faltan 3 series de dorsal» ni objetivos que cumplir: la
 * referencia de las revisiones —unas 10 series por músculo y semana— se usa para leer el mapa,
 * explicada y con su fuente, y lo que cada cual haga con eso es cosa suya.
 */

import { datos } from '../almacen';
import { hoy } from '../calculos.js';
import { GRUPOS, etiqueta, fichaPorId } from '../contenido';
import { actividad, CORTES, grado, lunesDe, seriesPorGrupo, seriesPorMusculo, sumarDias } from '../progreso.js';
import { enlace } from '../rutas';
import { temaActual } from '../tema';
import { t } from '../textos';

type Periodo = 'semana' | 'media';

/** Las semanas del calendario de actividad: medio año, que cabe en el ancho de un móvil. */
const SEMANAS = 26;

/*
 * El mapa es opcional, como el maniquí: vive en el módulo `figura`, y un proyecto sin él enseña la
 * tabla sola. Se carga aparte para que la pantalla no espere a los trazados.
 */
const cargarMapa = Object.values(
  import.meta.glob<{ pintarMapaGrados: (c: HTMLElement, g: Record<string, number>) => void }>('../../figura/musculos.ts'),
)[0];

const idioma = (): string => document.documentElement.lang || 'es';
const numero = (n: number, decimales = 0): string =>
  new Intl.NumberFormat(idioma(), { maximumFractionDigits: decimales }).format(n);
const fechaCorta = (f: string): string => {
  const [a, m, d] = f.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(idioma(), { day: 'numeric', month: 'short' }).format(new Date(a, m - 1, d));
};
const escapar = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let periodo: Periodo = 'semana';

export function montarProgreso(el: HTMLElement): void {
  const series = datos().series;
  if (!series.length) {
    el.innerHTML = `
      <div class="vacio">
        <p>${t('progreso.vacio')}</p>
        <a class="boton principal" href="${enlace({ vista: 'hoy', filtros: {} })}">${t('hoy.titulo')}</a>
      </div>`;
    return;
  }

  const dia = hoy();
  const lunes = lunesDe(dia);
  const musculosDe = (id: string) => fichaPorId(id)?.musculos;
  const grupoDe = (id: string) => fichaPorId(id)?.grupo_id;

  /*
   * Los dos periodos. «Esta semana» va de lunes a hoy. La media va sobre las cuatro semanas
   * ANTERIORES, completas: con la semana en curso dentro, un jueves la media salía un cuarto más
   * baja de lo que era, porque contaba como semana entera una que llevaba tres días.
   */
  const rango = (): { desde: string; hasta: string; semanas: number } =>
    periodo === 'semana'
      ? { desde: lunes, hasta: dia, semanas: 1 }
      : { desde: sumarDias(lunes, -28), hasta: sumarDias(lunes, -1), semanas: 4 };

  function pintar(): void {
    const { desde, hasta, semanas } = rango();
    const porMusculo = Object.fromEntries(
      Object.entries(seriesPorMusculo(series, musculosDe, desde, hasta)).map(([m, v]) => [m, v / semanas]),
    );
    const porGrupo = seriesPorGrupo(series, grupoDe, desde, hasta);
    const semana = series.filter((s) => s.fecha >= lunes && s.fecha <= dia);
    const cal = actividad(series, dia, SEMANAS);
    const diasActivos = cal.flat().filter((c) => c && c.series > 0).length;

    const musculos = Object.entries(porMusculo).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const sinTrabajar = principalesHechos().filter((m) => !porMusculo[m]);

    const maxGrupo = Math.max(1, ...Object.values(porGrupo));

    el.innerHTML = `
      <dl class="datos">
        <div class="dato"><dt>${t('progreso.series_semana')}</dt><dd>${numero(semana.length)}</dd></div>
        <div class="dato"><dt>${t('progreso.dias_semana')}</dt><dd>${numero(new Set(semana.map((s) => s.fecha)).size)}</dd></div>
        <div class="dato"><dt>${t('progreso.dias_medio_ano')}</dt><dd>${numero(diasActivos)}</dd></div>
      </dl>

      <div class="segmentado-periodo" role="group" aria-label="${t('progreso.periodo')}">
        <button type="button" class="boton" data-periodo="semana" aria-pressed="${periodo === 'semana'}">${t('progreso.esta_semana')}</button>
        <button type="button" class="boton" data-periodo="media" aria-pressed="${periodo === 'media'}">${t('progreso.media')}</button>
      </div>
      <p class="ayuda rango">${t('progreso.rango').replace('{desde}', fechaCorta(desde)).replace('{hasta}', fechaCorta(hasta))}</p>

      <section>
        <h2>${t('progreso.musculos')}</h2>
        <div class="progreso-mapa"><div class="mapas"></div></div>
        <ul class="leyenda-grados">
          ${[1, 2, 3].map((g) => `<li><span class="muestra g${g}" aria-hidden="true"></span>${t(`progreso.grado_${g}`)
            .replace('{a}', numero(CORTES[g - 1]!)).replace('{b}', numero((CORTES[g] ?? 0) - 1))}</li>`).join('')}
        </ul>
        <p class="ayuda">${t('progreso.explicacion')}
          <a href="https://pubmed.ncbi.nlm.nih.gov/27433992/" rel="noreferrer">${t('progreso.fuente')}</a></p>
        ${musculos.length ? `
          <div class="tabla-desplazable">
            <table class="tabla-musculos">
              <caption class="oculto">${t('progreso.musculos')}</caption>
              <thead><tr><th scope="col">${t('catalogo.campo.musculo')}</th><th scope="col">${t(periodo === 'semana' ? 'progreso.col_semana' : 'progreso.col_media')}</th></tr></thead>
              <tbody>${musculos.map(([m, v]) => `
                <tr data-grado="${grado(v)}"><th scope="row">${escapar(etiqueta('musculos', m))}</th><td>${numero(v, 1)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
        ${sinTrabajar.length ? `<p class="ayuda">${t('progreso.sin_trabajar')} ${sinTrabajar.map((m) => escapar(etiqueta('musculos', m))).join(', ')}.</p>` : ''}
      </section>

      <section>
        <h2>${t('progreso.patrones')}</h2>
        <ul class="barras">${GRUPOS.map((g) => {
          const v = (porGrupo[g.id] ?? 0) / semanas;
          const acento = g.color_acento?.[temaActual()];
          return `<li>
            <span class="nombre">${escapar(g.nombre)}</span>
            <span class="barra-fondo"><span class="barra-valor" style="width: ${((porGrupo[g.id] ?? 0) / maxGrupo) * 100}%;${acento ? ` background: ${acento};` : ''}"></span></span>
            <span class="valor">${numero(v, 1)}</span>
          </li>`;
        }).join('')}
        </ul>
        <p class="ayuda">${t(periodo === 'semana' ? 'progreso.patrones_nota_semana' : 'progreso.patrones_nota_media')}</p>
      </section>

      <section>
        <h2>${t('progreso.actividad')}</h2>
        ${calendario(cal, diasActivos)}
      </section>`;

    void cargarMapa?.().then(({ pintarMapaGrados }) => {
      const hueco = el.querySelector<HTMLElement>('.progreso-mapa .mapas');
      if (hueco) pintarMapaGrados(hueco, Object.fromEntries(musculos.map(([m, v]) => [m, grado(v)])));
    });
  }

  el.addEventListener('click', (e) => {
    const boton = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-periodo]');
    if (!boton || boton.dataset.periodo === periodo) return;
    periodo = boton.dataset.periodo as Periodo;
    pintar();
    el.querySelector<HTMLButtonElement>(`[data-periodo="${periodo}"]`)?.focus();
  });

  pintar();
}

/**
 * Los músculos principales de los ejercicios que el visitante ha hecho ALGUNA VEZ, para decir cuáles
 * se han quedado sin series en el periodo.
 *
 * Solo esos, y no los veintidós del mapa: decir «sin series: serrato, sóleo, aductores» a quien no
 * hace ningún ejercicio para ellos es una lista de reproches que no le dice nada que no sepa. Lo
 * útil es «esto lo trabajabas y esta semana no».
 */
function principalesHechos(): string[] {
  const vistos = new Set<string>();
  for (const s of datos().series) for (const m of fichaPorId(s.ejercicio)?.musculos?.principal ?? []) vistos.add(m);
  return [...vistos];
}

/**
 * El calendario de actividad: una columna por semana, una fila por día, de lunes a domingo.
 *
 * En HTML y no en SVG: son cuadrados en una rejilla, y así cada uno lleva su `title` sin montar
 * tooltips a mano. Tres tonos por tramos de series, como el mapa; los días que aún no han llegado
 * no se pintan, en vez de parecer días de descanso.
 */
function calendario(cal: ReturnType<typeof actividad>, diasActivos: number): string {
  const tono = (n: number): number => (n === 0 ? 0 : n < 10 ? 1 : n < 20 ? 2 : 3);
  const letra = (i: number): string =>
    new Intl.DateTimeFormat(idioma(), { weekday: 'narrow' }).format(new Date(2026, 8, 21 + i)); // 21-sep-2026 es lunes
  /*
   * El nombre del mes sobre la primera semana que lo empieza, y no sobre cada semana: 26 rótulos en
   * 360 px se pisaban unos a otros.
   */
  const meses = cal.map((semana, i) => {
    const primero = semana.find((d) => d && d.fecha.endsWith('-01')) ?? (i === 0 ? semana[0] : null);
    if (!primero) return '';
    const [a, m] = primero.fecha.split('-').map(Number) as [number, number];
    return new Intl.DateTimeFormat(idioma(), { month: 'short' }).format(new Date(a, m - 1, 1));
  });
  const resumen = t('progreso.actividad_resumen').replace('{dias}', numero(diasActivos)).replace('{semanas}', numero(SEMANAS));
  return `
    <div class="tabla-desplazable">
      <div class="calendario" role="img" aria-label="${escapar(resumen)}" style="--semanas: ${cal.length}">
        <span></span>${meses.map((m) => `<span class="mes" aria-hidden="true">${escapar(m)}</span>`).join('')}
        ${[0, 1, 2, 3, 4, 5, 6].map((d) => `
          <span class="dia-semana" aria-hidden="true">${d % 2 === 0 ? escapar(letra(d)) : ''}</span>
          ${cal.map((semana) => {
            const c = semana[d];
            if (!c) return '<span class="celda futura"></span>';
            return `<span class="celda t${tono(c.series)}" title="${escapar(`${fechaCorta(c.fecha)}: ${t('progreso.series_dia').replace('{n}', numero(c.series))}`)}"></span>`;
          }).join('')}`).join('')}
      </div>
    </div>
    <p class="ayuda">${resumen}</p>
    <ul class="leyenda-grados en-linea">
      <li><span class="muestra t0" aria-hidden="true"></span>${t('progreso.cal_0')}</li>
      <li><span class="muestra t1" aria-hidden="true"></span>${t('progreso.cal_1')}</li>
      <li><span class="muestra t2" aria-hidden="true"></span>${t('progreso.cal_2')}</li>
      <li><span class="muestra t3" aria-hidden="true"></span>${t('progreso.cal_3')}</li>
    </ul>`;
}
