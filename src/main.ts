/**
 * App de catálogo: buscar, filtrar, abrir una ficha, guardar favoritos.
 *
 * Una sola página que se repinta al cambiar la ruta. No hay framework: el catálogo es una lista y
 * una ficha es un formulario de lectura, y para eso el DOM basta. Lo que sí hay es una regla:
 * **todo lo visible sale de ui.json**, que es lo que permite tener dos idiomas sin duplicar código
 * y lo que vigila `scripts/check-idiomas.mjs`.
 *
 * LA PIEZA VISUAL ES OPCIONAL. Si el proyecto se creó con el módulo `figura`, la ficha muestra el
 * maniquí; si no, muestra solo texto. Se detecta con import.meta.glob y no con un import directo,
 * porque un import de un fichero que no existe no es un `undefined`: es un error de compilación.
 */

import './estilos/sitio.css';
import './estilos/app.css';
import { FICHAS, GRUPOS, MOVIMIENTOS, etiqueta, fichaPorId, grupoPorId, valoresDe, type Ficha } from './app/contenido';
import { alternar, enlaceCompartir, esFavorito, favoritos, recibirDeEnlace } from './app/favoritos';
import { alCambiarRuta, enlace, irA, rutaActual, type Ruta } from './app/rutas';
import { alCambiarTema, cambiarTema, temaActual } from './app/tema';
import { t } from './app/textos';

const cargarFigura = Object.values(
  import.meta.glob<{ montarFigura: (c: HTMLElement, m: unknown, f: Ficha) => Promise<{ destruir(): void }> }>('./figura/ficha.ts'),
)[0];

const cargarHoja = Object.values(
  import.meta.glob<{ montarHoja: (c: HTMLElement, m: unknown, titulo: string) => Promise<void> }>('./figura/hoja.ts'),
)[0];

const sitio = document.querySelector<HTMLElement>('#sitio')!;
let vivo: { destruir(): void } | null = null;

const ids = new Set(FICHAS.map((f) => f.id));

function coincide(f: Ficha, ruta: Ruta): boolean {
  const q = (ruta.busqueda ?? '').trim().toLowerCase();
  if (q && !`${f.nombre} ${f.resumen}`.toLowerCase().includes(q)) return false;
  const { grupo, material, nivel, musculo } = ruta.filtros;
  if (grupo?.length && !grupo.includes(f.grupo_id)) return false;
  if (nivel?.length && !(f.nivel && nivel.includes(f.nivel))) return false;
  if (material?.length && !material.every((m) => f.material?.includes(m))) return false;
  if (musculo?.length) {
    const suyos = Object.values(f.musculos ?? {}).flat();
    if (!musculo.every((m) => suyos.includes(m))) return false;
  }
  return true;
}

/* --------------------------------------------------------------- catálogo -- */

function pintarCatalogo(ruta: Ruta, lista: Ficha[]): void {
  const filtros = [
    ['grupo', GRUPOS.map((g) => g.id), (v: string) => grupoPorId(v)?.nombre ?? v],
    ['material', valoresDe('material'), (v: string) => etiqueta('material', v)],
    ['nivel', valoresDe('nivel'), (v: string) => etiqueta('nivel', v)],
    ['musculo', valoresDe('musculos'), (v: string) => etiqueta('musculos', v)],
  ] as const;

  sitio.innerHTML = `
    ${cabecera(ruta)}
    <form class="buscador" role="search">
      <label class="oculto" for="q">${t('catalogo.buscar')}</label>
      <input id="q" type="search" name="q" value="${escapar(ruta.busqueda ?? '')}" placeholder="${t('catalogo.buscar')}" />
    </form>
    <div class="filtros">
      ${filtros.map(([campo, valores, nombrar]) => valores.length ? `
        <fieldset>
          <legend>${t(`catalogo.campo.${campo}`)}</legend>
          ${valores.map((v) => `
            <button type="button" class="chip" data-campo="${campo}" data-valor="${v}"
                    aria-pressed="${(ruta.filtros[campo] ?? []).includes(v)}">${escapar(nombrar(v))}</button>`).join('')}
        </fieldset>` : '').join('')}
    </div>
    <p class="cuenta" role="status">${t('catalogo.resultados').replace('{n}', String(lista.length))}</p>
    ${lista.length ? `<ul class="rejilla">${lista.map(tarjeta).join('')}</ul>` : `<p class="vacio">${t('catalogo.sin_resultados')}</p>`}`;

  const buscador = sitio.querySelector<HTMLInputElement>('#q')!;
  let temporizador = 0;
  buscador.addEventListener('input', () => {
    // Se espera a que pare de teclear: cada pulsación cambia la ruta, y sin esto el historial se
    // llena de una entrada por letra y el botón de atrás deja de servir para nada.
    clearTimeout(temporizador);
    temporizador = window.setTimeout(() => {
      const anterior = rutaActual();
      history.replaceState(null, '', enlace({ ...anterior, busqueda: buscador.value }));
      pintar();
    }, 250);
  });

  sitio.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const { campo, valor } = chip.dataset as { campo: string; valor: string };
      const actuales = ruta.filtros[campo] ?? [];
      const siguientes = actuales.includes(valor) ? actuales.filter((v) => v !== valor) : [...actuales, valor];
      irA({ ...ruta, vista: ruta.vista, filtros: { ...ruta.filtros, [campo]: siguientes } });
    });
  });
}

/*
 * El cartel puede no existir: el contenido va por delante de la animación a propósito, y una ficha
 * sin maniquí se publica igual. El hueco se reserva siempre —si no, la rejilla salta al cargar— y la
 * imagen rota se esconde en vez de dejar el icono de imagen rota del navegador.
 */
function tarjeta(f: Ficha): string {
  return `
    <li class="tarjeta">
      <a href="${enlace({ vista: 'ficha', id: f.id, filtros: {} })}">
        <span class="cartel">
          <img src="${import.meta.env.BASE_URL}carteles/${f.id}.png" alt="" loading="lazy"
               width="480" height="480" onerror="this.hidden = true" />
          ${f.movimiento_id ? '' : `<span class="pendiente">${t('catalogo.sin_maniqui')}</span>`}
        </span>
        <span class="nombre">${escapar(f.nombre)}</span>
        <span class="grupo">${escapar(grupoPorId(f.grupo_id)?.nombre ?? '')}</span>
      </a>
      ${botonFavorito(f)}
    </li>`;
}

const botonFavorito = (f: Ficha): string => `
  <button type="button" class="favorito" data-favorito="${f.id}" aria-pressed="${esFavorito(f.id)}"
          aria-label="${t(esFavorito(f.id) ? 'favoritos.quitar' : 'favoritos.guardar').replace('{nombre}', f.nombre)}">
    <span aria-hidden="true">${esFavorito(f.id) ? '★' : '☆'}</span>
  </button>`;

/* ------------------------------------------------------------------ ficha -- */

async function pintarFicha(ruta: Ruta): Promise<void> {
  const f = fichaPorId(ruta.id!);
  if (!f) { irA({ vista: 'catalogo', filtros: {} }); return; }
  const movimiento = f.movimiento_id ? MOVIMIENTOS[f.movimiento_id] : undefined;
  const grupo = grupoPorId(f.grupo_id);

  sitio.innerHTML = `
    ${cabecera(ruta)}
    <article class="ficha">
      <a class="volver" href="${enlace({ vista: 'catalogo', filtros: ruta.filtros })}">${t('ficha.volver')}</a>
      <header>
        <p class="grupo">${escapar(grupoPorId(f.grupo_id)?.nombre ?? '')}</p>
        <h1>${escapar(f.nombre)}</h1>
        ${botonFavorito(f)}
      </header>
      <div class="figura"></div>
      <p class="resumen">${escapar(f.resumen)}</p>
      ${f.ejecucion?.length ? `<section><h2>${t('ficha.ejecucion')}</h2><ol>${f.ejecucion.map((p) => `<li>${escapar(p)}</li>`).join('')}</ol></section>` : ''}
      <dl class="datos">
        ${f.material?.length ? `<dt>${t('ficha.material')}</dt><dd>${f.material.map((m) => escapar(etiqueta('material', m))).join(', ')}</dd>` : ''}
        ${f.nivel ? `<dt>${t('ficha.nivel')}</dt><dd>${escapar(etiqueta('nivel', f.nivel))}</dd>` : ''}
      </dl>
      ${f.fuentes?.length ? `<section class="fuentes"><h2>${t('ficha.fuentes')}</h2><ul>${f.fuentes.map(
        (s) => `<li>${s.url ? `<a href="${escapar(s.url)}" rel="noreferrer">${escapar(s.titulo)}</a>` : escapar(s.titulo)}</li>`,
      ).join('')}</ul></section>` : ''}
    </article>`;

  /*
   * El acento del grupo entra como variable en la ficha, no como clase: los estilos del módulo del
   * maniquí pintan los tres grados de esfuerzo mezclando `--acento` con el fondo, y así el mapa de
   * cada grupo sale en su color sin que el módulo sepa cuántos grupos hay ni cómo se llaman.
   */
  const acento = grupo?.color_acento?.[temaActual()];
  if (acento) sitio.querySelector<HTMLElement>('.ficha')!.style.setProperty('--acento', acento);

  if (movimiento && cargarFigura) {
    const { montarFigura } = await cargarFigura();
    vivo = await montarFigura(sitio.querySelector<HTMLElement>('.figura')!, movimiento, f);
  } else {
    sitio.querySelector('.figura')!.remove();
  }
}

/* ----------------------------------------------------------------- común -- */

function cabecera(ruta: Ruta): string {
  return `
    <header class="barra">
      <a class="marca" href="${enlace({ vista: 'catalogo', filtros: {} })}">befit</a>
      <nav>
        <a href="${enlace({ vista: 'favoritos', filtros: {} })}" aria-current="${ruta.vista === 'favoritos'}">
          ${t('favoritos.titulo')} <span class="cuenta-favoritos">${favoritos().length}</span>
        </a>
        <button type="button" data-accion="idioma">${document.documentElement.lang === 'es' ? 'EN' : 'ES'}</button>
        <button type="button" data-accion="tema" aria-label="${t('ui.tema')}">◐</button>
      </nav>
    </header>`;
}

function pintar(): void {
  const ruta = rutaActual();
  vivo?.destruir();
  vivo = null;

  if (ruta.vista === 'ficha') {
    void pintarFicha(ruta);
  } else if (ruta.vista === 'favoritos') {
    if (ruta.ids?.length) recibirDeEnlace(ruta.ids, ids);
    const lista = FICHAS.filter((f) => esFavorito(f.id));
    pintarCatalogo(ruta, lista);
    if (!lista.length) sitio.querySelector('.vacio')!.textContent = t('favoritos.vacio');
    sitio.querySelector('.cuenta')?.insertAdjacentHTML('afterend', `
      <p class="compartir"><button type="button" data-accion="compartir">${t('favoritos.compartir')}</button></p>`);
  } else {
    pintarCatalogo(ruta, FICHAS.filter((f) => coincide(f, ruta)));
  }

}

async function alPulsar(e: MouseEvent): Promise<void> {
  const boton = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!boton) return;
  if (boton.dataset.favorito) {
    alternar(boton.dataset.favorito);
    pintar();
  }
  if (boton.dataset.accion === 'tema') cambiarTema();
  if (boton.dataset.accion === 'idioma') {
    // Recarga a propósito: las cadenas se resuelven una vez al arrancar, y repintar con el idioma
    // viejo a medias es peor que un parpadeo.
    localStorage.setItem('idioma', document.documentElement.lang === 'es' ? 'en' : 'es');
    location.reload();
  }
  if (boton.dataset.accion === 'compartir') {
    await navigator.clipboard?.writeText(enlaceCompartir());
    boton.textContent = t('favoritos.copiado');
  }
}

const escapar = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Modo hoja de revisión: `?hoja=<id>` pinta todas las vistas del movimiento en una sola imagen, para
 * revisarlo de un vistazo. Solo existe si el proyecto lleva el módulo `figura`, y no es una ruta
 * (`#/…`) a propósito: no es una pantalla del sitio, es una herramienta de trabajo.
 */
const revisar = new URLSearchParams(location.search).get('hoja');

if (revisar && cargarHoja) {
  // Envuelto en una función y no con await arriba del módulo: el objetivo de compilación no admite
  // await de primer nivel y el fallo aparece en `vite build`, no en desarrollo.
  void (async () => {
    const ficha = fichaPorId(revisar);
    const movimiento = ficha?.movimiento_id ? MOVIMIENTOS[ficha.movimiento_id] : undefined;
    if (!ficha || !movimiento) return;
    const { montarHoja } = await cargarHoja();
    await montarHoja(sitio, movimiento, `${ficha.nombre} — ${ficha.id}`);
  })();
} else {
  // Un solo oyente para toda la app: como el contenedor sobrevive a cada repintado, registrarlo
  // dentro de pintar() sumaría un oyente por navegación y acabaría alternando el favorito dos veces.
  sitio.addEventListener('click', alPulsar);
  alCambiarRuta(pintar);
  // Repintar al cambiar de tema: el acento del grupo se resuelve en JavaScript, así que un cambio de
  // tema sin repintado dejaría el mapa muscular con el color del tema anterior.
  alCambiarTema(pintar);
  pintar();
}
