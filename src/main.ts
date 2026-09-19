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

/*
 * Tres contenedores, y la diferencia importa para el LCP: la cabecera y el contenido los repinta la
 * app en cada navegación; la portada NO se toca, solo se le cambia el texto. Ver index.html.
 */
const cabeceraEl = document.querySelector<HTMLElement>('#cabecera')!;
const portadaEl = document.querySelector<HTMLElement>('.portada')!;
const sitio = document.querySelector<HTMLElement>('#app')!;
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
    ['material', valoresDe('material'), (v: string) => etiqueta('material', v)],
    ['nivel', valoresDe('nivel'), (v: string) => etiqueta('nivel', v)],
    ['musculo', valoresDe('musculos'), (v: string) => etiqueta('musculos', v)],
  ] as const;

  const activos = Object.values(ruta.filtros).flat().length;
  const chip = (campo: string, valor: string, nombre: string, acento?: string) => `
    <button type="button" class="chip" data-campo="${campo}" data-valor="${valor}"
            ${acento ? `style="--acento-chip: ${acento}"` : ''}
            aria-pressed="${(ruta.filtros[campo] ?? []).includes(valor)}">${escapar(nombre)}</button>`;

  /*
   * El grupo siempre a la vista; lo demás, plegado. Con los cuatro campos desplegados había que
   * pasar dos pantallas de píldoras en móvil antes de ver una sola ficha, y el filtro más usado
   * —el patrón de movimiento— quedaba a la misma altura que veintidós músculos.
   */
  const porGrupo = GRUPOS.map((g) => chip('grupo', g.id, g.nombre, acentoDe(g.id))).join('');
  const resto = filtros.map(([campo, valores, nombrar]) => valores.length ? `
    <div class="grupo-filtros">
      <h2>${t(`catalogo.campo.${campo}`)}</h2>
      ${valores.map((v) => chip(campo, v, nombrar(v))).join('')}
    </div>` : '').join('');
  const otrosActivos = activos - (ruta.filtros.grupo?.length ?? 0);

  ponerPortada(
    ruta.vista === 'favoritos' ? t('favoritos.titulo') : t('sitio.titulo'),
    ruta.vista === 'favoritos' ? t('favoritos.entradilla') : t('sitio.entradilla'),
  );

  /*
   * Sin nada guardado, no se pinta ni buscador ni filtros ni cuenta.
   *
   * Estaban: un buscador, veinticinco píldoras de filtro y un "0 resultados" encima de un mensaje
   * que dice que no hay nada. Filtrar una lista vacía no lleva a ninguna parte, y toda esa
   * maquinaria delante hace que la pantalla parezca rota en vez de recién empezada.
   */
  const sinGuardados = ruta.vista === 'favoritos' && favoritos().length === 0;

  sitio.innerHTML = `
    <a class="saltar" href="#catalogo">${t('catalogo.saltar')}</a>
    ${sinGuardados ? '' : `
    <form class="buscador" role="search">
      <label class="oculto" for="q">${t('catalogo.buscar')}</label>
      <input id="q" type="search" name="q" value="${escapar(ruta.busqueda ?? '')}" placeholder="${t('catalogo.buscar')}" />
    </form>
    <div class="filtros">
      <div class="grupo-filtros"><h2>${t('catalogo.campo.grupo')}</h2>${porGrupo}</div>
      ${resto ? `
        <details ${otrosActivos ? 'open' : ''}>
          <summary>${t('catalogo.mas_filtros')}${otrosActivos ? ` <span class="insignia">${otrosActivos}</span>` : ''}</summary>
          ${resto}
        </details>` : ''}
    </div>
    <div class="acciones-filtro">
      <p class="cuenta" role="status">${t('catalogo.resultados').replace('{n}', String(lista.length))}</p>
      ${activos || ruta.busqueda ? `<button type="button" class="boton" data-accion="limpiar">${t('catalogo.limpiar')}</button>` : ''}
    </div>`}
    ${lista.length
      ? `<ul class="rejilla" id="catalogo" tabindex="-1">${lista.map((f, n) => tarjeta(f, n)).join('')}</ul>`
      : `<div class="vacio" id="catalogo" tabindex="-1"><p>${t(ruta.vista === 'favoritos' ? 'favoritos.vacio' : 'catalogo.sin_resultados')}</p>
           <a class="boton" href="${enlace({ vista: 'catalogo', filtros: {} })}">${t('catalogo.ver_todos')}</a></div>`}
    ${aviso()}`;

  // Puede no haber buscador: en favoritos vacío no se pinta. Lo que sigue solo tiene sentido si lo hay.
  const buscador = sitio.querySelector<HTMLInputElement>('#q');
  let temporizador = 0;
  buscador?.addEventListener('input', () => {
    // Se espera a que pare de teclear: cada pulsación cambia la ruta, y sin esto el historial se
    // llena de una entrada por letra y el botón de atrás deja de servir para nada.
    clearTimeout(temporizador);
    temporizador = window.setTimeout(() => {
      const anterior = rutaActual();
      const donde = buscador.selectionStart;
      history.replaceState(null, '', enlace({ ...anterior, busqueda: buscador.value }));
      pintar();
      // Y se devuelve el foco con el cursor donde estaba: repintar la lista no puede echar de la
      // caja a quien está escribiendo.
      const nuevo = sitio.querySelector<HTMLInputElement>('#q')!;
      nuevo.focus();
      nuevo.setSelectionRange(donde ?? nuevo.value.length, donde ?? nuevo.value.length);
    }, 250);
  });

  sitio.querySelectorAll<HTMLButtonElement>('.chip').forEach((boton) => {
    boton.addEventListener('click', () => {
      const { campo, valor } = boton.dataset as { campo: string; valor: string };
      const actuales = ruta.filtros[campo] ?? [];
      const siguientes = actuales.includes(valor) ? actuales.filter((v) => v !== valor) : [...actuales, valor];
      irA({ ...ruta, vista: ruta.vista, filtros: { ...ruta.filtros, [campo]: siguientes } });
    });
  });
}

/**
 * Ir al anterior y al siguiente del mismo grupo.
 *
 * Un catálogo no solo se busca: se recorre. Sin esto, ver el segundo ejercicio de un patrón obliga
 * a volver atrás, encontrar la tarjeta y entrar otra vez, y con el catálogo filtrado además hay que
 * acordarse de por dónde iba uno.
 */
function vecinos(f: Ficha, ruta: Ruta): string {
  const hermanas = FICHAS.filter((x) => x.grupo_id === f.grupo_id);
  const n = hermanas.findIndex((x) => x.id === f.id);
  const anterior = hermanas[n - 1];
  const siguiente = hermanas[n + 1];
  if (!anterior && !siguiente) return '';
  const enlaceA = (x: Ficha, flecha: string) =>
    `<a class="boton" href="${enlace({ vista: 'ficha', id: x.id, filtros: ruta.filtros })}">
       <span class="icono" aria-hidden="true">${flecha}</span>${escapar(x.nombre)}</a>`;
  return `<nav class="vecinos" aria-label="${escapar(grupoPorId(f.grupo_id)?.nombre ?? '')}">
    ${anterior ? enlaceA(anterior, '←') : '<span></span>'}
    ${siguiente ? enlaceA(siguiente, '→') : ''}
  </nav>`;
}

/** El acento del grupo en el tema activo, para atar el color del catálogo al de la ficha. */
function acentoDe(grupoId: string): string | undefined {
  return grupoPorId(grupoId)?.color_acento?.[temaActual()];
}

/*
 * El cartel puede no existir: el contenido va por delante de la animación a propósito, y una ficha
 * sin maniquí se publica igual. El hueco se reserva siempre —si no, la rejilla salta al cargar— y la
 * imagen rota se esconde en vez de dejar el icono de imagen rota del navegador.
 */
function tarjeta(f: Ficha, n: number): string {
  /*
   * Los primeros carteles no van en carga diferida. `loading="lazy"` retrasa la petición hasta que
   * el navegador sabe dónde cae la imagen, o sea hasta después de pintar la rejilla: el primer
   * cartel era el elemento más grande de la portada y marcaba un LCP de 2,8 s en el móvil de gama
   * baja, cuando el texto llevaba en pantalla desde los 0,8 s.
   */
  const primeros = n < 4;
  return `
    <li class="tarjeta">
      <a href="${enlace({ vista: 'ficha', id: f.id, filtros: {} })}">
        <span class="cartel">
          <img src="${import.meta.env.BASE_URL}carteles/${f.id}.png" alt="" decoding="async"
               loading="${primeros ? 'eager' : 'lazy'}" ${primeros ? 'fetchpriority="high"' : ''}
               width="400" height="500" onerror="this.hidden = true" />
          ${f.movimiento_id ? '' : `<span class="pendiente">${t('catalogo.sin_maniqui')}</span>`}
        </span>
        <span class="nombre">${escapar(f.nombre)}</span>
        <span class="etiqueta-grupo" ${acentoDe(f.grupo_id) ? `style="--acento-chip: ${acentoDe(f.grupo_id)}"` : ''}>${escapar(grupoPorId(f.grupo_id)?.nombre ?? '')}</span>
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
  // La proporción del lienzo se lee del movimiento y se pone en el hueco ANTES de montar la pieza:
  // así el sitio reservado y el lienzo miden lo mismo, y el maniquí no empuja el texto al aparecer.
  const proporcion = (movimiento as { camara?: { proporcion?: string } } | undefined)?.camara?.proporcion;

  portadaEl.hidden = true;
  sitio.innerHTML = `
    <article class="ficha">
      <a class="volver boton" href="${enlace({ vista: 'catalogo', filtros: ruta.filtros })}">
        <span class="icono" aria-hidden="true">←</span>${t('ficha.volver')}
      </a>
      <header>
        <p class="grupo" ${acentoDe(f.grupo_id) ? `style="--acento-chip: ${acentoDe(f.grupo_id)}"` : ''}>${escapar(grupo?.nombre ?? '')}</p>
        <h1>${escapar(f.nombre)}</h1>
        ${botonFavorito(f)}
      </header>
      <div class="figura" ${proporcion ? `style="--proporcion-lienzo: ${proporcion}"` : ''}></div>
      <div class="cuerpo">
      <p class="resumen">${escapar(f.resumen)}</p>
      ${f.ejecucion?.length ? `<section><h2>${t('ficha.ejecucion')}</h2>
        <ol class="pasos">${f.ejecucion.map((p) => `<li>${escapar(p)}</li>`).join('')}</ol></section>` : ''}
      <dl class="datos">
        ${f.material?.length ? `<div class="dato"><dt>${t('ficha.material')}</dt><dd>${f.material.map((m) => escapar(etiqueta('material', m))).join(', ')}</dd></div>` : ''}
        ${f.nivel ? `<div class="dato"><dt>${t('ficha.nivel')}</dt><dd>${escapar(etiqueta('nivel', f.nivel))}</dd></div>` : ''}
      </dl>
      ${f.matices ? `<section class="matices"><h2>${t('ficha.matices')}</h2><p>${escapar(f.matices)}</p></section>` : ''}
      ${f.fuentes?.length ? `<section class="fuentes"><h2>${t('ficha.fuentes')}</h2><ul>${f.fuentes.map(
        // Con el autor y el año a la vista: una fuente sin ellos obliga a abrir el enlace para saber
        // si es de este año o de hace veinte, y una fuente que hay que abrir para valorarla no se abre.
        (s) => `<li>${s.url ? `<a href="${escapar(s.url)}" rel="noreferrer">${escapar(s.titulo)}</a>` : escapar(s.titulo)}${s.autor ? ` · ${escapar(s.autor)}` : ''}</li>`,
      ).join('')}</ul></section>` : ''}
      ${vecinos(f, ruta)}
      </div>
    </article>
    ${aviso()}`;

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

/*
 * El aviso va en TODAS las pantallas, no solo en el catálogo: a una ficha se llega por enlace
 * directo —es lo que hace el botón de compartir— y quien entra así no pasa por ninguna portada.
 */
const aviso = (): string => `<p class="aviso">${t('aviso.salud')}</p>`;

function cabecera(ruta: Ruta): string {
  return `
    <header class="barra">
      <div>
      <a class="marca" href="${enlace({ vista: 'catalogo', filtros: {} })}">befit</a>
      <nav>
        <a href="${enlace({ vista: 'favoritos', filtros: {} })}" ${ruta.vista === 'favoritos' ? 'aria-current="page"' : ''}>
          ${t('favoritos.titulo')} <span class="insignia">${favoritos().length}</span>
        </a>
        <button type="button" data-accion="idioma">${document.documentElement.lang === 'es' ? 'EN' : 'ES'}</button>
        <button type="button" data-accion="tema" aria-label="${t('ui.tema')}">◐</button>
      </nav>
      </div>
    </header>`;
}

/** Cambia el texto de la portada sin reemplazar el elemento, que es lo que arruinaba el LCP. */
function ponerPortada(titulo: string, entradilla: string): void {
  portadaEl.hidden = false;
  const h1 = portadaEl.querySelector('h1')!;
  const p = portadaEl.querySelector('p')!;
  if (h1.textContent !== titulo) h1.textContent = titulo;
  if (p.textContent !== entradilla) p.textContent = entradilla;
}

function pintar(): void {
  const ruta = rutaActual();
  cabeceraEl.innerHTML = cabecera(ruta);
  vivo?.destruir();
  vivo = null;

  if (ruta.vista === 'ficha') {
    void pintarFicha(ruta);
  } else if (ruta.vista === 'favoritos') {
    if (ruta.ids?.length) recibirDeEnlace(ruta.ids, ids);
    const lista = FICHAS.filter((f) => esFavorito(f.id));
    pintarCatalogo(ruta, lista);
    // El botón de compartir se añade aquí y no dentro del catálogo porque solo existe en favoritos.
    if (lista.length) {
      sitio.querySelector('.acciones-filtro')?.insertAdjacentHTML('beforeend', `
        <button type="button" class="boton" data-accion="compartir">${t('favoritos.compartir')}</button>`);
    }
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
  if (boton.dataset.accion === 'limpiar') irA({ vista: rutaActual().vista, filtros: {} });
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
  /*
   * Un solo oyente por contenedor que sobrevive al repintado. Registrarlo dentro de pintar() sumaría
   * uno por navegación y acabaría alternando el favorito dos veces.
   *
   * Y SON DOS, no uno: la cabecera es hermana de `#sitio`, no hija. Estuvo dentro, se sacó fuera
   * para que el navegador pudiera pintarla antes de ejecutar nada, y el oyente se quedó atrás: los
   * botones de idioma y de tema dejaron de hacer absolutamente nada. Sin error en consola, sin
   * fallo de compilación y sin que lo viera ninguna comprobación, porque ninguna los pulsaba.
   */
  sitio.addEventListener('click', alPulsar);
  cabeceraEl.addEventListener('click', alPulsar);
  alCambiarRuta(pintar);
  // Repintar al cambiar de tema: el acento del grupo se resuelve en JavaScript, así que un cambio de
  // tema sin repintado dejaría el mapa muscular con el color del tema anterior.
  alCambiarTema(pintar);
  pintar();
}
