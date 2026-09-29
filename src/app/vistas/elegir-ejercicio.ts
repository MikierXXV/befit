/**
 * Elegir un ejercicio viendo los carteles, no leyendo una lista.
 *
 * Fue un <select> agrupado por patrón, y con cincuenta ejercicios valía. Con más de cien la rueda
 * del móvil era una columna de nombres que había que leer entera, y nombres como «Swing con
 * kettlebell a una mano» o «Turkish get-up» no dicen nada a quien aún no se los sabe: el cartel sí.
 * Migue lo vio pobre en la sesión de «Hoy», que es justo donde se elige con prisa entre series.
 *
 * Es un <dialog> modal: foco atrapado, cierre con Escape y fondo inerte gratis. Los carteles van en
 * carga diferida y el diálogo cerrado no se pinta, así que no se piden hasta abrirlo.
 *
 * El marcado se repinta con la cabeza de «Hoy» tras cada serie, así que los oyentes van DELEGADOS
 * en el contenedor: atarlos a los botones los perdía en el primer repintado.
 */

import { FICHAS, GRUPOS, grupoPorId, type Ficha } from '../contenido';
import { favoritos } from '../favoritos';
import { temaActual } from '../tema';
import { t } from '../textos';

const escapar = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Sin tildes ni mayúsculas: «press arnold» encuentra «Press Arnold» y «zancada» a «Zancada». */
const normal = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const acentoDe = (grupoId: string): string | undefined => grupoPorId(grupoId)?.color_acento?.[temaActual()];

function carta(f: Ficha, href: string): string {
  const acento = acentoDe(f.grupo_id);
  return `
    <li class="tarjeta" data-texto="${escapar(normal(f.nombre))}">
      <a href="${href}" data-elegir-ejercicio="${f.id}">
        <span class="cartel">
          <img src="${import.meta.env.BASE_URL}carteles/${f.id}.png" alt="" decoding="async" loading="lazy"
               width="340" height="476" onerror="this.hidden = true" />
          ${f.movimiento_id ? '' : `<span class="pendiente">${t('catalogo.sin_maniqui')}</span>`}
        </span>
        <span class="nombre">${escapar(f.nombre)}</span>
        <span class="etiqueta-grupo" ${acento ? `style="--acento-chip: ${acento}"` : ''}>${escapar(grupoPorId(f.grupo_id)?.nombre ?? '')}</span>
      </a>
    </li>`;
}

/**
 * El botón que abre el selector y el propio diálogo. `enlaceA` da el destino de cada cartel: elegir
 * es navegar, igual que tocar un ejercicio de la lista de «Hoy», y así el botón de atrás lo deshace.
 */
export function elegirEjercicio(enlaceA: (id: string) => string): string {
  const guardados = favoritos().map((id) => FICHAS.find((f) => f.id === id)).filter((f): f is Ficha => !!f);
  const seccion = (clave: string, titulo: string, lista: Ficha[]): string => `
    <section class="elegir-seccion" data-seccion="${clave}">
      <h3>${escapar(titulo)}</h3>
      <ul class="rejilla">${lista.map((f) => carta(f, enlaceA(f.id))).join('')}</ul>
    </section>`;
  const chip = (clave: string, texto: string, puesto = false): string =>
    `<button type="button" class="chip" data-filtro-elegir="${clave}" aria-pressed="${puesto}">${escapar(texto)}</button>`;
  return `
    <button type="button" class="boton principal abrir-elegir" data-abrir-elegir>
      <span class="icono" aria-hidden="true">+</span>${t('hoy.anadir')}
    </button>
    <dialog class="elegir" aria-labelledby="elegir-titulo">
      <div class="elegir-cabeza">
        <h2 id="elegir-titulo">${t('hoy.anadir')}</h2>
        <button type="button" class="boton plano" data-cerrar-elegir aria-label="${t('catalogo.cerrar')}">
          <span class="icono" aria-hidden="true">✕</span>
        </button>
        <label class="oculto" for="elegir-q">${t('hoy.buscar')}</label>
        <input id="elegir-q" type="search" placeholder="${t('hoy.buscar')}" autocomplete="off" data-buscar-elegir />
        <div class="elegir-chips" role="group" aria-label="${t('hoy.filtrar')}">
          ${chip('todos', t('hoy.todos'), true)}
          ${guardados.length ? chip('favoritos', t('hoy.favoritos')) : ''}
          ${GRUPOS.map((g) => chip(g.id, g.nombre)).join('')}
        </div>
      </div>
      <div class="elegir-cuerpo">
        ${guardados.length ? seccion('favoritos', t('hoy.favoritos'), guardados) : ''}
        ${GRUPOS.map((g) => seccion(g.id, g.nombre, FICHAS.filter((f) => f.grupo_id === g.id))).join('')}
        <p class="elegir-vacio" hidden>${t('hoy.sin_resultados')}</p>
      </div>
    </dialog>`;
}

/**
 * Los oyentes, una vez por contenedor. Filtrar y buscar esconden cartas SIN repintar: repintar
 * volvería a pedir las imágenes y sacaría el foco de la caja de búsqueda a la primera letra.
 */
export function conectarElegir(raiz: HTMLElement): void {
  const dialogo = (): HTMLDialogElement | null => raiz.querySelector<HTMLDialogElement>('dialog.elegir');

  function aplicar(): void {
    const d = dialogo();
    if (!d) return;
    const q = normal(d.querySelector<HTMLInputElement>('[data-buscar-elegir]')?.value.trim() ?? '');
    const filtro = d.querySelector<HTMLElement>('[data-filtro-elegir][aria-pressed="true"]')?.dataset.filtroElegir ?? 'todos';
    let visibles = 0;
    d.querySelectorAll<HTMLElement>('.elegir-seccion').forEach((s) => {
      // Con búsqueda, los favoritos se esconden: repetirían cartas que ya salen en su grupo.
      const cabe = filtro === 'todos' ? !(q && s.dataset.seccion === 'favoritos') : s.dataset.seccion === filtro;
      let enSeccion = 0;
      s.querySelectorAll<HTMLElement>('.tarjeta').forEach((c) => {
        const ve = cabe && (!q || (c.dataset.texto ?? '').includes(q));
        c.hidden = !ve;
        if (ve) enSeccion += 1;
      });
      s.hidden = enSeccion === 0;
      visibles += enSeccion;
    });
    d.querySelector<HTMLElement>('.elegir-vacio')!.hidden = visibles > 0;
  }

  raiz.addEventListener('click', (e) => {
    const objetivo = e.target as HTMLElement;
    const d = dialogo();
    if (!d) return;
    if (objetivo.closest('[data-abrir-elegir]')) {
      if (!d.open) d.showModal();
      return;
    }
    if (objetivo.closest('[data-cerrar-elegir]')) { d.close(); return; }
    // Tocar el fondo, fuera de la caja del diálogo, lo cierra: es lo que se espera de una hoja modal.
    if (objetivo === d) { d.close(); return; }
    const chip = objetivo.closest<HTMLElement>('[data-filtro-elegir]');
    if (chip) {
      d.querySelectorAll('[data-filtro-elegir]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      d.querySelector('.elegir-cuerpo')!.scrollTop = 0;
      aplicar();
      return;
    }
    // Elegir navega por el enlace; se cierra antes para no dejar el fondo inerte si la vista tarda.
    if (objetivo.closest('[data-elegir-ejercicio]')) d.close();
  });

  raiz.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).matches('[data-buscar-elegir]')) aplicar();
  });
}
