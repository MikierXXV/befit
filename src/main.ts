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
import { reloj } from './app/calculos.js';
import { FICHAS, GRUPOS, MOVIMIENTOS, descansoDe, etiqueta, fichaPorId, grupoPorId, valoresDe, type Ficha } from './app/contenido';
import { suscribir } from './app/almacen';
import { alternar, enlaceCompartir, esFavorito, favoritos, recibirDeEnlace } from './app/favoritos';
import { alCambiarRuta, enlace, irA, rutaActual, type Ruta } from './app/rutas';
import { alCambiarTema, cambiarTema, temaActual } from './app/tema';
import { t } from './app/textos';
import { montarDatos } from './app/vistas/datos';
import { fechaDeHoy, montarHoy } from './app/vistas/hoy';
import { montarCompartida, montarEditor, montarListaRutinas, montarRutina } from './app/vistas/rutinas';
import { montarRegistro } from './app/vistas/registro';

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

/*
 * Cómo se saca de una ficha el valor de cada faceta. En un solo sitio: estaba repartido entre el
 * filtrado, el recuento y el pintado, y añadir una faceta obligaba a acordarse de los tres.
 */
const VALORES: Record<string, (f: Ficha) => string[]> = {
  grupo: (f) => [f.grupo_id],
  nivel: (f) => (f.nivel ? [f.nivel] : []),
  material: (f) => f.material ?? [],
  musculo: (f) => Object.values(f.musculos ?? {}).flat(),
};

/*
 * Qué facetas hay y en qué orden. El grupo primero: es el filtro que de verdad se usa, y en la
 * versión anterior quedaba a la misma altura que veintidós músculos.
 */
const FACETAS = [
  { campo: 'grupo', valores: () => GRUPOS.map((g) => g.id), nombre: (v: string) => grupoPorId(v)?.nombre ?? v, punto: true, buscable: false },
  { campo: 'nivel', valores: () => valoresDe('nivel'), nombre: (v: string) => etiqueta('nivel', v), punto: false, buscable: false },
  { campo: 'material', valores: () => valoresDe('material'), nombre: (v: string) => etiqueta('material', v), punto: false, buscable: false },
  { campo: 'musculo', valores: () => valoresDe('musculos'), nombre: (v: string) => etiqueta('musculos', v), punto: false, buscable: true },
];

/*
 * Qué facetas están desplegadas y si el cajón del móvil está abierto.
 *
 * Vive FUERA de pintar(): marcar una casilla cambia la ruta y repinta el catálogo entero, y sin
 * guardarlo aquí el panel volvía a su estado inicial a cada clic —en el móvil, el cajón se cerraba
 * en la cara justo al marcar el primer filtro—.
 */
const desplegadas = new Set<string>(['grupo']);
let panelAbierto = false;

function pintarCatalogo(ruta: Ruta, lista: Ficha[]): void {
  const puestos = Object.entries(ruta.filtros).flatMap(([campo, vs]) => (vs ?? []).map((v) => [campo, v] as [string, string]));
  const sinGuardados = ruta.vista === 'favoritos' && favoritos().length === 0;
  const universo = ruta.vista === 'favoritos' ? FICHAS.filter((f) => esFavorito(f.id)) : FICHAS;

  /*
   * Cuántos resultados daría cada valor contando los demás filtros pero NO los de su propia faceta.
   * Es lo que convierte una lista de casillas en algo utilizable: se ve de antemano que "avanzado"
   * no lleva a ninguna parte, en vez de descubrirlo marcándolo y quedándose con la pantalla vacía.
   */
  const cuantasCon = (campo: string, valor: string): number => {
    const otros = { ...ruta.filtros };
    delete otros[campo];
    return universo.filter((f) => coincide(f, { ...ruta, filtros: otros }) && (VALORES[campo]?.(f) ?? []).includes(valor)).length;
  };

  const faceta = (f: (typeof FACETAS)[number]): string => {
    const valores = f.valores();
    if (!valores.length) return '';
    const marcados = ruta.filtros[f.campo] ?? [];
    const opciones = valores.map((v) => {
      const n = cuantasCon(f.campo, v);
      const nombre = f.nombre(v);
      const acento = f.punto ? acentoDe(v) : undefined;
      return `<li><label data-vacia="${n ? 'no' : 'si'}" data-texto="${escapar(nombre.toLowerCase())}">
        <input type="checkbox" data-campo="${f.campo}" data-valor="${escapar(v)}" ${marcados.includes(v) ? 'checked' : ''} />
        ${acento ? `<span class="punto" style="--acento-chip: ${acento}"></span>` : ''}
        <span class="nombre">${escapar(nombre)}</span>
        <span class="cuantas">${n}</span>
      </label></li>`;
    }).join('');
    return `
      <details class="faceta" data-faceta="${f.campo}" ${desplegadas.has(f.campo) ? 'open' : ''}>
        <summary>${t(`catalogo.campo.${f.campo}`)}${marcados.length ? `<span class="insignia">${marcados.length}</span>` : ''}</summary>
        ${f.buscable ? `<input class="buscar-faceta" type="search" data-filtra="${f.campo}" placeholder="${t('catalogo.buscar_en')}" aria-label="${t('catalogo.buscar_en')}" />` : ''}
        <ul class="opciones${valores.length > 8 ? ' larga' : ''}">${opciones}</ul>
      </details>`;
  };

  ponerPortada(
    ruta.vista === 'favoritos' ? t('favoritos.titulo') : t('sitio.titular'),
    ruta.vista === 'favoritos' ? t('favoritos.entradilla') : '',
  );

  /*
   * Sin nada guardado, no se pinta ni buscador ni filtros ni cuenta. Estaban: un buscador, cuatro
   * facetas y un "0 resultados" encima de un mensaje que dice que no hay nada. Filtrar una lista
   * vacía no lleva a ninguna parte, y toda esa maquinaria delante hace que la pantalla parezca rota
   * en vez de recién empezada.
   */
  sitio.innerHTML = `
    <a class="saltar boton" href="#catalogo">${t('catalogo.saltar')}</a>
    ${sinGuardados ? '' : `
    <div class="reparto">
      <dialog class="panel" id="panel-filtros" aria-label="${t('catalogo.filtros')}">
        <div class="panel-cabeza">
          <h2>${t('catalogo.filtros')}</h2>
          <button type="button" class="boton plano" data-accion="cerrar-filtros" aria-label="${t('catalogo.cerrar')}">
            <span class="icono" aria-hidden="true">✕</span>
          </button>
        </div>
        <div class="panel-grupos">${FACETAS.map(faceta).join('')}</div>
        <div class="panel-pie">
          <button type="button" class="boton principal" data-accion="cerrar-filtros">
            ${t('catalogo.ver_resultados').replace('{n}', String(lista.length))}
          </button>
        </div>
      </dialog>
      <div class="resultados">
        <form class="buscador" role="search">
          <label class="oculto" for="q">${t('catalogo.buscar')}</label>
          <input id="q" type="search" name="q" value="${escapar(ruta.busqueda ?? '')}" placeholder="${t('catalogo.buscar')}" />
        </form>
        <div class="barra-resultados">
          <button type="button" class="boton abrir-filtros" data-accion="abrir-filtros">
            <span class="icono" aria-hidden="true">≡</span>${t('catalogo.filtrar')}
            ${puestos.length ? `<span class="insignia">${puestos.length}</span>` : ''}
          </button>
          <p class="cuenta" role="status">${t('catalogo.resultados').replace('{n}', String(lista.length))}</p>
        </div>
        <div class="activos">
          ${puestos.map(([campo, valor]) => {
            const cual = FACETAS.find((x) => x.campo === campo);
            const nombre = cual ? cual.nombre(valor) : valor;
            return `<button type="button" class="quitar" data-campo="${campo}" data-valor="${escapar(valor)}"
                      aria-label="${t('catalogo.quitar').replace('{valor}', escapar(nombre))}">
              ${escapar(nombre)}<span class="icono" aria-hidden="true">✕</span>
            </button>`;
          }).join('')}
          ${puestos.length || ruta.busqueda ? `<button type="button" class="boton plano" data-accion="limpiar">${t('catalogo.limpiar')}</button>` : ''}
        </div>
        ${lista.length
          ? `<ul class="rejilla" id="catalogo" tabindex="-1">${lista.map((f, n) => tarjeta(f, n)).join('')}</ul>`
          : `<div class="vacio" id="catalogo" tabindex="-1"><p>${t('catalogo.sin_resultados')}</p>
               <a class="boton" href="${enlace({ vista: ruta.vista, filtros: {} })}">${t('catalogo.limpiar')}</a></div>`}
      </div>
    </div>`}
    ${sinGuardados ? `<div class="vacio" id="catalogo" tabindex="-1"><p>${t('favoritos.vacio')}</p>
         <a class="boton principal" href="${enlace({ vista: 'catalogo', filtros: {} })}">${t('catalogo.ver_todos')}</a></div>` : ''}
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

  // Marcar o desmarcar una casilla es cambiar de ruta: así el filtro se comparte con un enlace y el
  // botón de atrás lo deshace, que es lo que espera cualquiera que haya usado un navegador.
  sitio.querySelectorAll<HTMLInputElement>('.opciones input').forEach((casilla) => {
    casilla.addEventListener('change', () => {
      const { campo, valor } = casilla.dataset as { campo: string; valor: string };
      const actuales = ruta.filtros[campo] ?? [];
      const siguientes = casilla.checked ? [...actuales, valor] : actuales.filter((v) => v !== valor);
      irA({ ...ruta, filtros: { ...ruta.filtros, [campo]: siguientes } });
    });
  });

  // Recordar qué facetas quedan desplegadas, para que el repintado no las cierre todas.
  sitio.querySelectorAll<HTMLDetailsElement>('.faceta').forEach((det) => {
    det.addEventListener('toggle', () => {
      const campo = det.dataset.faceta!;
      if (det.open) desplegadas.add(campo);
      else desplegadas.delete(campo);
    });
  });

  /*
   * Buscar dentro de una faceta esconde opciones SIN repintar: si esto cambiara la ruta, cada letra
   * volvería a pintar el panel entero y el campo perdería el foco a la primera.
   */
  sitio.querySelectorAll<HTMLInputElement>('.buscar-faceta').forEach((campo) => {
    campo.addEventListener('input', () => {
      const q = campo.value.trim().toLowerCase();
      campo.closest('.faceta')!.querySelectorAll<HTMLElement>('.opciones label').forEach((op) => {
        (op.parentElement as HTMLElement).hidden = q !== '' && !(op.dataset.texto ?? '').includes(q);
      });
    });
  });

  // El cajón del móvil se vuelve a abrir tras el repintado si estaba abierto.
  if (panelAbierto) abrirPanel();
}

/** El panel de filtros: columna fija en escritorio, cajón modal en móvil. */
const panelEl = (): HTMLDialogElement | null => sitio.querySelector<HTMLDialogElement>('#panel-filtros');

function abrirPanel(): void {
  const el = panelEl();
  // `showModal` sobre un diálogo ya abierto lanza una excepción. Tras un repintado el elemento es
  // otro y no lo está, pero esta comprobación es la diferencia entre eso y un error por cada filtro.
  if (el && !el.open) el.showModal();
  panelAbierto = true;
}

function cerrarPanel(): void {
  panelEl()?.close();
  panelAbierto = false;
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
               width="340" height="476" onerror="this.hidden = true" />
          ${f.movimiento_id ? '' : `<span class="pendiente">${t('catalogo.sin_maniqui')}</span>`}
        </span>
        <span class="nombre">${escapar(f.nombre)}</span>
        <span class="etiqueta-grupo" ${acentoDe(f.grupo_id) ? `style="--acento-chip: ${acentoDe(f.grupo_id)}"` : ''}>${escapar(grupoPorId(f.grupo_id)?.nombre ?? '')}</span>
      </a>
      ${botonFavorito(f)}
    </li>`;
}

/*
 * El favorito. En la tarjeta es un icono en una esquina; en la ficha, un botón con su palabra.
 *
 * El mismo icono suelto en los dos sitios era el problema: en la ficha, una estrella hueca sin
 * texto al lado del título no dice qué hace, y era el control que más se pulsaba sin querer.
 * La etiqueta accesible describe la ACCIÓN, no el estado, que es lo que un lector de pantalla
 * necesita anunciar al llegar al botón.
 */
/*
 * El favorito: SOLO la estrella, en la tarjeta y en la ficha.
 *
 * Llevó la palabra «Guardar» al lado en la ficha, y sobraba: la estrella es el símbolo universal de
 * esto y el botón acababa midiendo lo que una frase. Lo que sí hace falta es que se vea y que se
 * acierte con el dedo, así que es más grande que el resto de controles —de los pocos sitios donde
 * romper la retícula de alturas está justificado— y tiene fondo propio, no medio transparente.
 *
 * La palabra sigue existiendo para quien no ve el icono: va en la etiqueta accesible y describe la
 * ACCIÓN —guardar o quitar—, que es lo que un lector de pantalla necesita anunciar.
 */
const botonFavorito = (f: Ficha): string => {
  const guardado = esFavorito(f.id);
  return `
  <button type="button" class="favorito" data-favorito="${f.id}" aria-pressed="${guardado}"
          aria-label="${t(guardado ? 'favoritos.quitar' : 'favoritos.guardar').replace('{nombre}', f.nombre)}">
    <span class="icono" aria-hidden="true">${guardado ? '★' : '☆'}</span>
  </button>`;
};

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
      <!--
        Volver y guardar, la misma fila y en los dos extremos: son las dos acciones de la pantalla
        y estaban a alturas distintas, una arriba del todo y la otra flotando junto al título.
      -->
      <div class="acciones">
        <a class="boton" href="${enlace({ vista: 'catalogo', filtros: ruta.filtros })}">
          <span class="icono" aria-hidden="true">←</span>${t('ficha.volver')}
        </a>
        ${botonFavorito(f)}
      </div>
      <!--
        EL MANIQUÍ VA PRIMERO, antes que el título.

        Es a lo que se entra: quien abre un ejercicio viene a ver cómo se hace, no a leer cómo se
        llama. Con el encabezado delante, en un móvil había que bajar para encontrar el movimiento,
        y el nombre ya venía leído desde la tarjeta del catálogo.
      -->
      <div class="figura" ${proporcion ? `style="--proporcion-lienzo: ${proporcion}"` : ''}></div>
      <header>
        <p class="grupo" ${acentoDe(f.grupo_id) ? `style="--acento-chip: ${acentoDe(f.grupo_id)}"` : ''}>${escapar(grupo?.nombre ?? '')}</p>
        <h1>${escapar(f.nombre)}</h1>
      </header>
      <div class="cuerpo">
      <p class="resumen">${escapar(f.resumen)}</p>
      <!--
        ORDEN DE LECTURA: qué necesitas, cómo se hace, qué no está cerrado, de dónde sale.

        Material y nivel van ANTES de los pasos porque son lo que decide si el ejercicio te sirve
        hoy: enterarte de que hace falta un rack después de leerte siete pasos es tarde. Y matices y
        fuentes van después, que es cuando importan: primero se aprende el gesto y luego se
        pregunta qué hay detrás. Estaban los tres en una columna lateral, leyéndose en paralelo a
        los pasos y sin orden ninguno.
      -->
      <dl class="datos">
        ${f.material?.length ? `<div class="dato"><dt>${t('ficha.material')}</dt><dd>${f.material.map((m) => escapar(etiqueta('material', m))).join(', ')}</dd></div>` : ''}
        ${f.nivel ? `<div class="dato"><dt>${t('ficha.nivel')}</dt><dd>${escapar(etiqueta('nivel', f.nivel))}</dd></div>` : ''}
        <div class="dato"><dt>${t('ficha.descanso')}</dt><dd>${t('ficha.descanso_valor').replace('{v}', reloj(descansoDe(f)))}</dd></div>
      </dl>
      <!--
        El registro, después de material y nivel y antes de los pasos: en el gimnasio es a lo que se
        viene entre serie y serie, y tener que bajar por siete pasos y las fuentes para anotar cada
        una lo convertía en algo que nadie usaría dos veces. Quien viene a aprender el ejercicio lo
        pasa de largo en un gesto.
      -->
      <section class="registro"></section>
      ${f.ejecucion?.length ? `<section><h2>${t('ficha.ejecucion')}</h2>
        <ol class="pasos">${f.ejecucion.map((p) => `<li>${escapar(p)}</li>`).join('')}</ol></section>` : ''}
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

  montarRegistro(sitio.querySelector<HTMLElement>('.registro')!, f);

  vivo = await montarManiqui(sitio.querySelector<HTMLElement>('.figura')!, f);
}

/**
 * Monta el maniquí de una ficha en su hueco, o quita el hueco si no hay maniquí que poner.
 *
 * Si al terminar de cargar el hueco ya no está en la página —se cambió de ruta mientras llegaban
 * Three.js y el modelo—, se desmonta en el acto: ese maniquí se quedaba con su contexto WebGL vivo
 * y sin nadie que lo liberara, porque `pintar()` ya había pasado por `vivo?.destruir()`.
 */
async function montarManiqui(hueco: HTMLElement, f: Ficha): Promise<{ destruir(): void } | null> {
  const movimiento = f.movimiento_id ? MOVIMIENTOS[f.movimiento_id] : undefined;
  if (!movimiento || !cargarFigura) { hueco.remove(); return null; }
  const { montarFigura } = await cargarFigura();
  if (!hueco.isConnected) return null;
  const montado = await montarFigura(hueco, movimiento, f);
  if (!hueco.isConnected) { montado.destruir(); return null; }
  return montado;
}

/* ----------------------------------------------------------------- común -- */

/*
 * El pie, en TODAS las pantallas. No solo en el catálogo: a una ficha se llega por enlace directo
 * —es lo que hace el botón de compartir— y quien entra así no pasa por ninguna portada.
 *
 * Lleva tres cosas y las tres tienen que estar: el aviso de salud, de quién es esto, y de quién es
 * lo que no es nuestro. Lo último no es cortesía: el maniquí es CC0, el mapa muscular Apache 2.0 y
 * las tipografías OFL, y las tres licencias piden que se diga.
 *
 * El año se calcula, no se escribe: un pie que dice 2026 en 2028 es la señal más barata de que un
 * sitio está abandonado.
 */
const aviso = (): string => `
  <footer class="pie">
    <p class="salud">${t('aviso.salud')}</p>
    <p class="legal">
      <span>${t('pie.derechos').replace('{anio}', String(new Date().getFullYear()))}</span>
      <a href="${enlace({ vista: 'datos', filtros: {} })}">${t('datos.titulo')}</a>
      <span class="creditos">${t('pie.creditos')}</span>
    </p>
  </footer>`;

function cabecera(ruta: Ruta): string {
  return `
    <header class="barra">
      <div>
      <a class="marca" href="${enlace({ vista: 'catalogo', filtros: {} })}">befit</a>
      <nav>
        <a href="${enlace({ vista: 'hoy', filtros: {} })}" ${ruta.vista === 'hoy' ? 'aria-current="page"' : ''}>${t('hoy.titulo')}</a>
        <a href="${enlace({ vista: 'rutinas', filtros: {} })}" ${ruta.vista === 'rutinas' || ruta.vista === 'rutina' ? 'aria-current="page"' : ''}>${t('rutinas.titulo')}</a>
        <!--
          En el móvil, favoritos se queda en la estrella: con «Hoy» y «Rutinas» ya no cabían las cinco
          piezas en 390 px. El nombre va en aria-label, con la cuenta, y la palabra se quita del todo
          en vez de esconderla recortada: recortada seguía ocupando su sitio a la derecha de la
          estrella y la dejaba 27 px descentrada en su botón.
        -->
        <a href="${enlace({ vista: 'favoritos', filtros: {} })}" ${ruta.vista === 'favoritos' ? 'aria-current="page"' : ''}
           aria-label="${t('favoritos.titulo')}${favoritos().length ? ` (${favoritos().length})` : ''}">
          <span class="icono" aria-hidden="true">★</span><span class="texto-nav">${t('favoritos.titulo')}</span>
          ${favoritos().length ? `<span class="insignia">${favoritos().length}</span>` : ''}
        </a>
        <button type="button" data-accion="idioma">${document.documentElement.lang === 'es' ? 'EN' : 'ES'}</button>
        <button type="button" data-accion="tema" aria-label="${t('ui.tema')}">
          <span class="icono" aria-hidden="true">${temaActual() === 'oscuro' ? '☀' : '☾'}</span>
        </button>
      </nav>
      </div>
    </header>`;
}

/*
 * Cambia el texto de la portada sin reemplazar el elemento, que es lo que arruinaba el LCP.
 *
 * La entradilla puede venir vacía, y entonces el párrafo se esconde: en el catálogo, el titular ya
 * dice de qué va el sitio y debajo iba una frase que repetía lo mismo con otras palabras.
 */
function ponerPortada(titulo: string, entradilla: string): void {
  portadaEl.hidden = false;
  const h1 = portadaEl.querySelector('h1')!;
  const p = portadaEl.querySelector('p')!;
  if (h1.textContent !== titulo) h1.textContent = titulo;
  if (p.textContent !== entradilla) p.textContent = entradilla;
  p.hidden = entradilla === '';
}

function pintar(): void {
  const ruta = rutaActual();
  cabeceraEl.innerHTML = cabecera(ruta);
  vivo?.destruir();
  vivo = null;

  if (ruta.vista === 'ficha') {
    void pintarFicha(ruta);
  } else if (ruta.vista === 'hoy') {
    ponerPortada(t('hoy.titulo'), fechaDeHoy());
    sitio.innerHTML = `<div class="hoy"></div>${aviso()}`;
    vivo = montarHoy(sitio.querySelector<HTMLElement>('.hoy')!, { activo: ruta.id, montarManiqui });
  } else if (ruta.vista === 'rutinas') {
    ponerPortada(t('rutinas.titulo'), t('rutinas.entradilla'));
    sitio.innerHTML = `<div class="rutinas"></div>${aviso()}`;
    montarListaRutinas(sitio.querySelector<HTMLElement>('.rutinas')!);
  } else if (ruta.vista === 'rutina') {
    sitio.innerHTML = `<div class="rutinas"></div>${aviso()}`;
    const el = sitio.querySelector<HTMLElement>('.rutinas')!;
    const montada = ruta.compartida !== undefined ? montarCompartida(el, ruta.compartida)
      : ruta.editar ? montarEditor(el, ruta.id ?? '')
      : montarRutina(el, ruta.id ?? '');
    // Una rutina que no existe —borrada, o un enlace roto— lleva a la lista, no a una página vacía.
    if (!montada) { irA({ vista: 'rutinas', filtros: {} }); return; }
    ponerPortada(
      ruta.editar ? t('rutinas.editando').replace('{nombre}', montada.titulo) : montada.titulo,
      'entradilla' in montada && typeof montada.entradilla === 'string' ? montada.entradilla
        : ruta.compartida !== undefined ? t('rutinas.compartida_entradilla') : '',
    );
  } else if (ruta.vista === 'datos') {
    ponerPortada(t('datos.titulo'), t('datos.entradilla'));
    sitio.innerHTML = `<div class="tus-datos"></div>${aviso()}`;
    montarDatos(sitio.querySelector<HTMLElement>('.tus-datos')!);
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
  if (boton.dataset.accion === 'abrir-filtros') abrirPanel();
  if (boton.dataset.accion === 'cerrar-filtros') cerrarPanel();
  if (boton.classList.contains('quitar')) {
    const { campo, valor } = boton.dataset as { campo: string; valor: string };
    const ruta = rutaActual();
    irA({ ...ruta, filtros: { ...ruta.filtros, [campo]: (ruta.filtros[campo] ?? []).filter((v) => v !== valor) } });
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
  /*
   * La cabecera se refresca cuando cambian los datos, sin repintar la página: la insignia de
   * favoritos seguía diciendo 3 después de borrarlo todo en «Tus datos», porque esa pantalla no
   * repinta la cabecera y hasta cambiar de ruta nadie lo hacía.
   */
  suscribir(() => { cabeceraEl.innerHTML = cabecera(rutaActual()); });
  pintar();
}

/*
 * APP INSTALABLE Y SIN CONEXIÓN. En el gimnasio no siempre hay cobertura, y una app que se queda en
 * blanco en el sótano no sirve para lo que se abre allí. El service worker (public/sw.js) guarda lo
 * que se va pidiendo.
 *
 * Se registra DESPUÉS de cargar la página y solo en producción: registrarlo antes compite con la
 * primera pintura por la red —y eso es el LCP que vigila auditar.mjs—, y en desarrollo cachearía
 * los módulos de Vite y taparía cada cambio con la versión anterior.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator && !revisar) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Sin service worker la app funciona igual, solo que no sin conexión.
    });

    /*
     * Instalada, se trae YA lo que hace falta para abrir cualquier ficha: el visor, Three.js y el
     * modelo. Si no, una ficha nunca abierta con red no abriría sin ella, y eso es justo lo que se
     * descubre en el sótano. En una pestaña normal NO se hace: serían 150 kB de Three.js para
     * alguien que quizá solo mira el catálogo.
     */
    if (matchMedia('(display-mode: standalone)').matches) {
      const precargar = (): void => {
        void cargarFigura?.();
        void fetch(`${import.meta.env.BASE_URL}modelos/maniqui.glb`).catch(() => undefined);
      };
      if ('requestIdleCallback' in window) requestIdleCallback(precargar);
      else setTimeout(precargar, 2000);
    }
  });
}
