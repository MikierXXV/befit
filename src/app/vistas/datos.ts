/**
 * «Tus datos»: qué hay guardado, hacer una copia, recuperarla y empezar de cero.
 *
 * Es la otra mitad de la regla 5. Sin cuentas, lo guardado vive en un solo navegador, y eso solo es
 * aceptable si llevárselo es fácil: esta pantalla es lo que evita que cambiar de móvil sea perder
 * meses de registro.
 */

import { datos, exportar, importar, vaciar } from '../almacen';
import { hoy } from '../calculos.js';
import { t } from '../textos';

const numero = (n: number): string => new Intl.NumberFormat(document.documentElement.lang || 'es').format(n);

export function montarDatos(el: HTMLElement): void {
  let estado = '';
  let confirmando = false;

  function pintar(): void {
    const { favoritos, series } = datos();
    const dias = new Set(series.map((s) => s.fecha)).size;
    el.innerHTML = `
      <dl class="datos">
        <div class="dato"><dt>${t('datos.favoritos')}</dt><dd>${numero(favoritos.length)}</dd></div>
        <div class="dato"><dt>${t('datos.series')}</dt><dd>${numero(series.length)}</dd></div>
        <div class="dato"><dt>${t('datos.dias')}</dt><dd>${numero(dias)}</dd></div>
      </dl>
      <p class="estado" role="status">${estado}</p>

      <section>
        <h2>${t('datos.exportar_titulo')}</h2>
        <p>${t('datos.exportar_texto')}</p>
        <button type="button" class="boton principal" data-exportar>${t('datos.exportar')}</button>
      </section>

      <section>
        <h2>${t('datos.importar_titulo')}</h2>
        <p>${t('datos.importar_texto')}</p>
        <!--
          El selector de ficheros nativo, escondido y disparado desde un botón de los nuestros: el
          del navegador no se deja dar estilo, y en el tema oscuro salía como un rectángulo gris con
          «Ningún archivo seleccionado» en el idioma del sistema, no en el de la página.
        -->
        <input type="file" accept="application/json,.json" hidden data-fichero />
        <button type="button" class="boton" data-importar>${t('datos.importar')}</button>
      </section>

      <section>
        <h2>${t('datos.borrar_titulo')}</h2>
        <p>${t('datos.borrar_texto')}</p>
        <!--
          La confirmación va en la página y no en un confirm(): dentro de una app instalada en iOS
          los diálogos del sistema a veces no salen, y entonces el botón no hacía nada visible.
        -->
        ${confirmando
          ? `<div class="fila">
               <button type="button" class="boton peligro" data-borrar-si>${t('datos.borrar_si')}</button>
               <button type="button" class="boton" data-borrar-no>${t('datos.cancelar')}</button>
             </div>`
          : `<button type="button" class="boton" data-borrar>${t('datos.borrar')}</button>`}
      </section>`;
  }

  el.addEventListener('click', (e) => {
    const boton = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!boton) return;
    const d = boton.dataset;

    if ('exportar' in d) {
      /*
       * Un enlace con `download` sobre un Blob, que funciona sin conexión y sin servidor. El nombre
       * lleva la fecha: quien haga copias a menudo necesita saber cuál es la última sin abrirlas.
       */
      const url = URL.createObjectURL(new Blob([exportar()], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `befit-${hoy()}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      estado = t('datos.exportado');
      pintar();
    }
    if ('importar' in d) el.querySelector<HTMLInputElement>('[data-fichero]')?.click();
    if ('borrar' in d) { confirmando = true; estado = ''; pintar(); el.querySelector<HTMLButtonElement>('[data-borrar-no]')?.focus(); }
    if ('borrarNo' in d) { confirmando = false; pintar(); el.querySelector<HTMLButtonElement>('[data-borrar]')?.focus(); }
    if ('borrarSi' in d) {
      vaciar();
      confirmando = false;
      estado = t('datos.borrado');
      pintar();
    }
  });

  el.addEventListener('change', async (e) => {
    const campo = e.target as HTMLInputElement;
    const fichero = campo.files?.[0];
    if (!fichero) return;
    try {
      const { nuevosFavoritos, nuevasSeries } = importar(await fichero.text());
      estado = t('datos.importado').replace('{favoritos}', numero(nuevosFavoritos)).replace('{series}', numero(nuevasSeries));
    } catch (error) {
      // `leerExportado` lanza con una clave de ui.json; cualquier otra cosa es un fichero ilegible.
      const clave = error instanceof Error && error.message.startsWith('datos.') ? error.message : 'datos.error_formato';
      estado = t(clave);
    }
    pintar();
  });

  pintar();
}
