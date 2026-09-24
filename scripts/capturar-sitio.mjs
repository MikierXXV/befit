#!/usr/bin/env node
/**
 * Recorre el sitio compilado, guarda capturas y falla si algo se rompe en silencio.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npm run capturar
 *
 * LAS CAPTURAS SON EL SUBPRODUCTO, NO EL OBJETIVO. Lo que este guion busca es lo que no se ve
 * mirando el sitio: errores de consola, peticiones fallidas y huecos de visualización que se
 * quedaron vacíos. Un fallo al montar una pieza no rompe la página —el resto sigue funcionando—,
 * así que sin esto se descubre por casualidad, semanas después, si es que se descubre.
 *
 * Se recorre en los dos temas y en los dos anchos porque los defectos no son los mismos: el
 * contraste falla en oscuro y los rótulos se pisan en móvil.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.URL_BASE ?? 'http://localhost:4173/';
const SALIDA = join(RAIZ, 'capturas');

const VISTAS = [
  { nombre: 'escritorio', viewport: { width: 1280, height: 900 } },
  // 360×740: el móvil pequeño que sigue siendo mayoría fuera de las oficinas.
  { nombre: 'movil', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
];
const TEMAS = ['claro', 'oscuro'];

/*
 * Rutas que se recorren. Por defecto solo la portada, que en un sitio de contenido ES el sitio; una
 * app de catálogo declara las suyas en presupuestos.json (`rutas`), porque si no las cuatro capturas
 * son cuatro veces la misma pantalla y el informe dice "el sitio se recorre entero sin errores"
 * habiendo mirado una de cuatro vistas.
 */
const PRESUPUESTOS = JSON.parse(await readFile(join(RAIZ, 'presupuestos.json'), 'utf8'));
const RUTAS = PRESUPUESTOS.rutas?.length ? PRESUPUESTOS.rutas : [''];

await mkdir(SALIDA, { recursive: true });

const fallos = [];
const navegador = await chromium.launch();

for (const vista of VISTAS) {
  for (const tema of TEMAS) {
    const contexto = await navegador.newContext({
      viewport: vista.viewport,
      isMobile: vista.isMobile ?? false,
      hasTouch: vista.hasTouch ?? false,
      // Se fija la preferencia del sistema además de escribir el atributo: así se comprueba también
      // que el camino "sin elección guardada" funciona, que es el de todo visitante nuevo.
      colorScheme: tema === 'oscuro' ? 'dark' : 'light',
    });
    const pagina = await contexto.newPage();
    const etiqueta = `${vista.nombre}-${tema}`;

    pagina.on('console', (msg) => {
      if (msg.type() === 'error') fallos.push(`[${etiqueta}] error de consola: ${msg.text()}`);
      // t() no lanza si falta una clave: la enseña en crudo y avisa. Ese aviso ES el fallo —así se
      // coló «ninguno» sin traducir en ocho fichas—, así que aquí cuenta como error.
      if (msg.type() === 'warning' && msg.text().startsWith('[textos]')) fallos.push(`[${etiqueta}] ${msg.text()}`);
    });
    pagina.on('pageerror', (e) => fallos.push(`[${etiqueta}] excepción sin capturar: ${e.message}`));
    pagina.on('requestfailed', (p) => {
      fallos.push(`[${etiqueta}] petición fallida: ${p.url()} (${p.failure()?.errorText})`);
    });

    await pagina.goto(`${BASE}${RUTAS[0]}`, { waitUntil: 'networkidle', timeout: 60000 });

    /*
     * Recorrer entero: las visualizaciones se montan al entrar en pantalla, así que sin bajar hasta
     * el final la mitad del sitio no llega a ejecutarse y la comprobación no comprueba nada.
     *
     * Y SE MIRA CADA HUECO MIENTRAS ESTÁ EN PANTALLA, no al final del recorrido. Mirarlos todos
     * desde arriba marcaba como rotas las piezas que el sitio había desmontado correctamente al
     * salir de vista, que es justo el comportamiento que se quiere: la comprobación acusaba al
     * sitio de hacer bien su trabajo.
     */
    /*
     * En el mismo barrido se mide el ÍNDICE FIJO contra lo que tiene debajo en cada punto.
     *
     * Es el único texto de la página que no pertenece a ninguna parada, así que es el único cuyo
     * fondo cambia mientras se lee. check-contraste.mjs verifica los pares de tokens de cada tema y
     * todos pasan; lo que no puede ver es que el índice se pinte con los del sitio encima de una
     * parada de tono contrario. Así se coló la parada actual a 1,05:1: invisible, justo la que debe
     * destacar, y sin un solo aviso.
     *
     * Se toma el color de fondo del primer antepasado opaco de lo que queda debajo del enlace. Ignora
     * degradados e imágenes —el velo de una portada, el grano entre paradas—, que son decorado sobre
     * ese fondo y no lo sustituyen.
     */
    const barrido = await pagina.evaluate(async (minimo) => {
      const vistos = new Set();
      const indice = new Map();

      const canales = (c) => {
        const m = c.match(/^rgba?\(([^)]+)\)$/);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return { rgb: [r, g, b], a };
      };
      const luminancia = ([r, g, b]) => {
        const lineal = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
      };
      const fondoBajo = (x, y, nav) => {
        let el = document.elementsFromPoint(x, y).find((e) => !nav.contains(e));
        for (; el; el = el.parentElement) {
          const c = canales(getComputedStyle(el).backgroundColor);
          if (c && c.a === 1) return c.rgb;
        }
        return canales(getComputedStyle(document.documentElement).backgroundColor)?.rgb ?? [255, 255, 255];
      };

      const paso = window.innerHeight * 0.8;
      for (let y = 0; y < document.body.scrollHeight; y += paso) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 400));
        for (const h of document.querySelectorAll('.vis-hueco')) {
          const caja = h.getBoundingClientRect();
          const enPantalla = caja.top < window.innerHeight && caja.bottom > 0;
          if (enPantalla && h.childElementCount === 0) vistos.add(h.dataset.pieza ?? '(sin id)');
        }

        const nav = document.querySelector('nav.indice');
        if (!nav || nav.getBoundingClientRect().height === 0) continue;
        for (const a of nav.querySelectorAll('a')) {
          const caja = a.getBoundingClientRect();
          const texto = canales(getComputedStyle(a).color);
          if (!texto) continue;
          const [l1, l2] = [luminancia(texto.rgb), luminancia(fondoBajo(caja.left + 2, caja.top + caja.height / 2, nav))]
            .sort((p, q) => q - p);
          const ratio = (l1 + 0.05) / (l2 + 0.05);
          const nombre = a.querySelector('.indice-nombre')?.textContent ?? a.textContent;
          // Se guarda el peor valor de cada enlace en todo el recorrido: un fallo por enlace, no uno
          // por cada punto del barrido.
          if (ratio < minimo && ratio < (indice.get(nombre)?.ratio ?? Infinity)) {
            indice.set(nombre, { ratio, actual: a.getAttribute('aria-current') === 'true', y: Math.round(y) });
          }
        }
      }
      window.scrollTo(0, 0);
      return { sospechosos: [...vistos], indice: [...indice] };
    }, 4.5);

    const { sospechosos } = barrido;
    for (const [nombre, { ratio, actual, y }] of barrido.indice) {
      fallos.push(
        `[${etiqueta}] índice ilegible: "${nombre}"${actual ? ' (parada actual)' : ''} a ` +
        `${ratio.toFixed(2)}:1 sobre lo que tiene debajo, con scroll en ${y} px. Mínimo AA: 4.5:1.`,
      );
    }

    /*
     * Segunda vuelta sobre los sospechosos, con más margen. Una pieza puede estar todavía cargando
     * su módulo cuando pasa el barrido, sobre todo la primera vez que se pide una mecánica. Sin
     * esta confirmación, la comprobación falla de vez en cuando y por motivos que no se repiten,
     * que es la forma más rápida de que alguien la desactive.
     */
    for (const id of sospechosos) {
      const sigueVacio = await pagina.evaluate(async (pieza) => {
        const hueco = document.querySelector(`.vis-hueco[data-pieza="${pieza}"]`);
        if (!hueco) return true;
        hueco.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 1500));
        return hueco.childElementCount === 0;
      }, id);
      if (sigueVacio) fallos.push(`[${etiqueta}] hueco de visualización vacío: "${id}"`);
    }

    /*
     * Legibilidad y tacto, SOLO EN MÓVIL y sobre el render real.
     *
     * Es donde aparecen los defectos que ninguna otra comprobación ve. Una pieza se dibuja en
     * unidades de su viewBox, así que un rótulo de 15 unidades se ve perfecto en el portátil y se
     * queda en siete píxeles en un móvil de 360: legible en la pantalla de quien lo programó e
     * ilegible en la de quien lo lee. Lo mismo con los nodos que se tocan. Por eso se mide el
     * tamaño en píxeles de pantalla y no el declarado.
     */
    if (vista.isMobile) {
      const MINIMO_TEXTO = 10;   // px de pantalla. Por debajo, no se lee en la mano.
      const MINIMO_TACTIL = 24;  // px. Es el objetivo mínimo que pide la WCAG 2.1 (2.5.8).

      /*
       * Antes de medir, esperar a que las piezas montadas hayan ajustado su escala.
       *
       * crearSvg() calcula el tamaño de los rótulos en el primer requestAnimationFrame, así que una
       * pieza recién montada pasa un fotograma con el tamaño de respaldo. Midiendo sin esperar, la
       * comprobación acusaba de rótulo ilegible a una pieza correcta —y solo a veces, según lo que
       * hubiera montado en pantalla al volver arriba—, que es la peor clase de fallo que puede tener
       * una comprobación: el que enseña a desconfiar de ella.
       *
       * Si se agota el plazo se mide igual, a propósito: una pieza que NUNCA ajusta la escala sí es
       * un defecto, y tiene que seguir saliendo.
       *
       * La condición se escribe sobre los HUECOS marcados como visibles, no sobre los SVG que haya
       * en el DOM. Mirando los SVG, la espera terminaba cuando todavía no había ninguno —la lista
       * vacía cumple cualquier condición— y la pieza aparecía justo después, sin ajustar: el fallo
       * seguía saliendo, y ahora solo en uno de los cuatro recorridos, que es aún más difícil de
       * creerse. Un hueco visible sin montar sí mantiene la espera.
       */
      /*
       * PIEZA POR PIEZA, cada una llevada al centro de la pantalla. Antes se medía todo de una vez al
       * volver arriba, y como las piezas se desmontan al salir de vista, solo se medían las que se
       * ven sin hacer scroll: en la plantilla, una de dos. La otra no se había medido nunca.
       */
      const idsHuecos = await pagina.$$eval('.vis-hueco', (hs) => hs.map((h) => h.dataset.pieza));
      const medidas = [];
      for (const id of idsHuecos) {
        const selector = `.vis-hueco[data-pieza="${id}"]`;
        await pagina.$eval(selector, (h) => h.scrollIntoView({ block: 'center' }));
        await pagina
          .waitForFunction(
            (sel) => {
              const hueco = document.querySelector(sel);
              const svg = hueco?.querySelector('.vis-svg');
              // Las piezas de lienzo o 3D no tienen rótulos que escalar: basta con que estén montadas.
              if (!svg) return (hueco?.childElementCount ?? 0) > 0;
              return svg.style.getPropertyValue('--tam-rotulo') !== '';
            },
            selector,
            { timeout: 5000 },
          )
          .catch(() => {});
        // Un fotograma más: la pieza recoloca sus rótulos al recibir `vis:escala`, justo después de
        // que se escriba --tam-rotulo. Midiendo en ese mismo fotograma, el solape seguía ahí.
        await pagina.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        // Y a que acaben las animaciones de entrada: la marca del eje llega deslizándose desde un
        // extremo y, a medio camino, pasa por encima del rótulo de ese polo. Eso no es un solape.
        // Las infinitas se dejan fuera: su `finished` no se resuelve nunca y colgaría el recorrido.
        await pagina.$eval(selector, (h) => Promise.all(
          h.getAnimations({ subtree: true })
            .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
            .map((a) => a.finished.catch(() => {})),
        ));
        medidas.push(...await pagina.$eval(selector, medirPieza, { minTexto: MINIMO_TEXTO, minTactil: MINIMO_TACTIL }));
      }
      await pagina.evaluate(() => window.scrollTo(0, 0));

      /** Se ejecuta en la página, sobre un hueco ya montado y en pantalla. */
      function medirPieza(hueco, { minTexto, minTactil }) {
        const problemas = [];
        for (const t of hueco.querySelectorAll('.vis-lienzo text')) {
          const alto = t.getBoundingClientRect().height;
          if (alto > 0 && alto < minTexto) {
            problemas.push(`rótulo a ${alto.toFixed(1)} px: "${t.textContent?.slice(0, 40)}"`);
          }
        }
        for (const n of hueco.querySelectorAll('.vis-marca, .vis-lienzo [tabindex]')) {
          const caja = n.getBoundingClientRect();
          const lado = Math.min(caja.width, caja.height);
          if (lado > 0 && lado < minTactil) {
            problemas.push(`objetivo táctil de ${lado.toFixed(1)} px: "${n.getAttribute('aria-label') ?? n.tagName}"`);
          }
        }

        // Rótulos que se salen del lienzo. El lienzo recorta, así que un rótulo desbordado no rompe
        // nada: simplemente se lee a medias, «El otro extrem», y así se queda. Pasa siempre en
        // móvil, porque el largo del texto lo pone el contenido y la pieza no lo conoce al dibujar.
        for (const lienzo of hueco.querySelectorAll('.vis-lienzo')) {
          const marco = lienzo.getBoundingClientRect();
          for (const t of lienzo.querySelectorAll('text')) {
            const caja = t.getBoundingClientRect();
            if (caja.width === 0) continue;
            // Un píxel de tolerancia: el antialiasing hace que un texto pegado al borde mida una
            // fracción de más, y eso no es desbordar.
            if (caja.left < marco.left - 1 || caja.right > marco.right + 1) {
              problemas.push(`rótulo recortado por el borde: "${t.textContent?.slice(0, 40)}"`);
            }
          }

          /*
           * Rótulos que se pisan, entre sí o con una marca. Es el otro defecto que solo sale en móvil:
           * rótulos y marcas crecen en unidades del viewBox para seguir siendo legibles y tocables,
           * pero las distancias escritas a mano entre ellos no. En el eje, a 360 px, «Un extremo»
           * quedaba encima de la marca y las medidas de arriba pasaban todas: tamaño correcto, dentro
           * del lienzo, objetivo táctil de sobra.
           *
           * La marca se mide como círculo, no como su caja: la esquina de la caja de un círculo está
           * vacía, y un rótulo que solo roza esa esquina no se pisa con nada.
           */
          const rotulos = [...lienzo.querySelectorAll('text')]
            .map((t) => ({ t, c: t.getBoundingClientRect() }))
            .filter(({ c }) => c.width > 0);
          const cortan = (a, b) =>
            a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          const nombre = (t) => `"${t.textContent?.slice(0, 40)}"`;

          for (let i = 0; i < rotulos.length; i++) {
            for (let j = i + 1; j < rotulos.length; j++) {
              if (cortan(rotulos[i].c, rotulos[j].c)) {
                problemas.push(`rótulos que se pisan: ${nombre(rotulos[i].t)} y ${nombre(rotulos[j].t)}`);
              }
            }
          }

          for (const marca of lienzo.querySelectorAll('.vis-marca')) {
            const m = marca.getBoundingClientRect();
            const [cx, cy, r] = [m.left + m.width / 2, m.top + m.height / 2, Math.min(m.width, m.height) / 2];
            for (const { t, c } of rotulos) {
              const dx = Math.max(c.left - cx, 0, cx - c.right);
              const dy = Math.max(c.top - cy, 0, cy - c.bottom);
              if (Math.hypot(dx, dy) < r - 1) {
                problemas.push(`rótulo encima de una marca: ${nombre(t)} y "${marca.getAttribute('aria-label') ?? 'marca'}"`);
              }
            }
          }
        }

        return problemas;
      }

      for (const p of medidas) fallos.push(`[${etiqueta}] ${p}`);
    }

    /*
     * ESCENOGRAFÍA: nada puede quedarse invisible.
     *
     * Es el defecto propio de las entradas al hacer scroll y no se parece a ningún otro: el bloque
     * está en el DOM, ocupa su sitio, no hay ningún error en consola, y simplemente no se ve porque
     * su opacidad sigue a cero. No lo detecta ninguna otra comprobación —el hueco no está vacío, el
     * contenido valida, el contraste pasa— y quien lo sufre no tiene forma de saber que hay algo ahí.
     *
     * El recorrido de arriba ya ha pasado por todo, así que a estas alturas cada bloque debería
     * estar marcado. A los que no lo estén se les da una segunda oportunidad llevándolos al centro
     * de la pantalla: igual que con las visualizaciones, una comprobación que falla de vez en cuando
     * acaba desactivada.
     */
    const sinEntrar = await pagina.evaluate(async () => {
      const pendientes = [...document.querySelectorAll('[data-entrada]')]
        .filter((e) => e.dataset.entrada !== 'ninguna' && !e.dataset.visto);

      const sigueSinEntrar = [];
      for (const bloque of pendientes) {
        bloque.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 900));
        if (!bloque.dataset.visto) {
          sigueSinEntrar.push(bloque.id || bloque.className || bloque.tagName.toLowerCase());
        }
      }
      window.scrollTo(0, 0);
      return sigueSinEntrar;
    });

    for (const bloque of sinEntrar) {
      fallos.push(
        `[${etiqueta}] bloque que nunca entra: "${bloque}" sigue con su estado inicial después de ` +
        `pasar por el centro de la pantalla. Se está viendo en blanco.`,
      );
    }

    /*
     * El documento no puede desbordar a lo ancho. Una capa a sangre o una entrada lateral que se
     * pasa un píxel no rompen nada en el portátil y en móvil dejan la página moviéndose de lado.
     */
    const ancho = await pagina.evaluate(() => ({
      documento: document.documentElement.scrollWidth,
      ventana: window.innerWidth,
    }));
    if (ancho.documento > ancho.ventana + 1) {
      fallos.push(
        `[${etiqueta}] el documento mide ${ancho.documento} px de ancho en una ventana de ` +
        `${ancho.ventana}: hay desbordamiento horizontal.`,
      );
    }

    /*
     * CADA CONTROL DE LA CABECERA TIENE QUE HACER ALGO AL PULSARLO.
     *
     * Los botones de idioma y de tema estuvieron muertos sin que nadie se enterara: el oyente de
     * clics vivía en `#sitio` y la cabecera se sacó fuera para poder pintarla antes de ejecutar
     * JavaScript, así que los clics no llegaban a ninguna parte. Sin error en consola, sin fallo de
     * compilación, y ninguna comprobación los pulsaba. Se pulsan aquí: si tras el clic no cambia ni
     * el tema, ni el idioma, ni la ruta, ni lo guardado, ni el contenido, el botón es decorativo.
     */
    const huella = () => pagina.evaluate(() => {
      let guardado = '';
      try { guardado = JSON.stringify({ ...localStorage }); } catch { guardado = 'sin acceso'; }
      return [
        document.documentElement.dataset.tema,
        document.documentElement.lang,
        location.href,
        guardado,
        String(document.querySelector('#sitio')?.textContent?.length ?? 0),
      ].join('|');
    });
    /*
     * Los mandos que SE VEN, en la cabecera y en el pie. En el móvil, idioma y tema bajan al pie y se
     * esconden arriba: pulsar uno escondido esperaba 30 s a que fuera visible y reventaba el recorrido.
     */
    const SELECTOR_MANDOS = '#cabecera [data-accion]:visible, #cabecera button:visible, .pie [data-accion]:visible';
    const cuantos = (await pagina.$$(SELECTOR_MANDOS)).length;
    for (let i = 0; i < cuantos; i += 1) {
      /* Se vuelve a buscar por posición en cada vuelta: la cabecera se repinta entera y el idioma
         recarga la página, así que una referencia guardada apunta a un elemento que ya no existe
         —«Element is not attached to the DOM»— y la comprobación reventaba en el segundo botón. */
      const mando = (await pagina.$$(SELECTOR_MANDOS))[i];
      if (!mando) continue;
      const etq = (await mando.textContent())?.trim().slice(0, 20) || '(sin texto)';
      const antes = await huella();
      await mando.click();
      // El de idioma recarga la página a propósito; hay que esperar a que vuelva a estar en pie.
      await pagina.waitForLoadState('networkidle').catch(() => {});
      await pagina.waitForTimeout(500);
      if ((await huella()) === antes) {
        fallos.push(`[${etiqueta}] el control "${etq}" de la cabecera no hace nada al pulsarlo.`);
      }
      // Se vuelve al punto de partida: el siguiente control se prueba desde el mismo sitio.
      await pagina.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
      await pagina.evaluate(() => { try { localStorage.clear(); } catch {} });
      await pagina.reload({ waitUntil: 'networkidle' });
    }

    await pagina.screenshot({ path: join(SALIDA, `${etiqueta}.png`), fullPage: true });
    console.log(`  · capturas/${etiqueta}.png`);

    /*
     * Las rutas extra: se visitan por sus errores y su captura, no por el barrido completo. El
     * barrido de arriba está escrito para el recorrido con paradas, y lo que aquí interesa es que
     * ninguna pantalla de la app se rompa en silencio.
     */
    for (const ruta of RUTAS.slice(1)) {
      await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 60000 });
      await pagina.waitForTimeout(1200);
      const nombre = ruta.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'portada';
      await pagina.screenshot({ path: join(SALIDA, `${etiqueta}-${nombre}.png`), fullPage: true });
    }

    await contexto.close();
  }
}

/* ------------------------------------------------ movimiento reducido y maqueta -- */

/*
 * Dos comprobaciones que no dependen del tema ni del ancho, así que se hacen una vez.
 *
 *  1. CON MOVIMIENTO REDUCIDO, EL SITIO SE VE ENTERO Y SIN TOCAR NADA. No «se ve al hacer scroll»:
 *     se ve ya. Quien pide no moverse suele pedirlo porque el movimiento le marea o le impide leer,
 *     y contestarle con contenido que solo aparece si baja es exactamente lo contrario de atenderlo.
 *     Aquí no se hace scroll a propósito: si hiciera falta, la comprobación no comprobaría nada.
 *
 *  2. SOLO SE ANIMA LO QUE NO OBLIGA A MEDIR LA PÁGINA. Animar `height`, `top`, `margin` o
 *     `font-size` recalcula la maqueta en cada fotograma y además desplaza lo que haya debajo, que
 *     es lo que mide el CLS de auditar.mjs. El fallo llega siempre por la vía cómoda: alguien
 *     escribe `transition: all` para no pensar qué está animando, y se lleva la maqueta por delante.
 */
{
  const contexto = await navegador.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => fallos.push(`[reducido] excepción sin capturar: ${e.message}`));
  await pagina.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });

  const escondidos = await pagina.evaluate(() => {
    const problemas = [];
    for (const bloque of document.querySelectorAll('[data-entrada]')) {
      const estilo = getComputedStyle(bloque);
      const nombre = bloque.id || bloque.className || bloque.tagName.toLowerCase();
      if (Number(estilo.opacity) < 0.99) problemas.push(`"${nombre}" a opacidad ${estilo.opacity}`);
      // Un `corte` sin revertir deja el bloque enmascarado a cero con la opacidad intacta: se mide
      // aparte porque la opacidad, que es lo que mira todo el mundo, no lo delata.
      if (/(^|\s)0(px|%)/.test(estilo.maskSize)) problemas.push(`"${nombre}" enmascarado a cero`);
      if (/inset\(.*100%/.test(estilo.clipPath)) problemas.push(`"${nombre}" recortado por clip-path`);
    }
    return problemas;
  });

  for (const p of escondidos) {
    fallos.push(`[reducido] con prefers-reduced-motion, y sin hacer scroll, ${p}`);
  }

  const MAQUETA = /^(width|height|top|left|right|bottom|inset|margin|padding|font-size|flex|grid)/;

  const animaciones = await pagina.evaluate((patron) => {
    const malas = [];
    const esDeMaqueta = new RegExp(patron);

    for (const hoja of document.styleSheets) {
      let reglas;
      try { reglas = hoja.cssRules; } catch { continue; }
      for (const regla of recorrer(reglas)) {
        if (regla.type === CSSRule.KEYFRAMES_RULE) {
          for (const paso of regla.cssRules) {
            for (const prop of paso.style) {
              if (esDeMaqueta.test(prop)) malas.push(`@keyframes ${regla.name} anima "${prop}"`);
            }
          }
          continue;
        }
        const propiedades = regla.style?.transitionProperty;
        if (!propiedades) continue;
        for (const prop of propiedades.split(',').map((p) => p.trim())) {
          if (prop === 'all') malas.push(`"${regla.selectorText}" usa transition-property: all`);
          else if (esDeMaqueta.test(prop)) malas.push(`"${regla.selectorText}" anima "${prop}"`);
        }
      }
    }

    // Las reglas dentro de @media y @supports no están en el primer nivel, y son justo donde acaban
    // los ajustes de móvil: mirar solo el nivel de arriba deja fuera la mitad del CSS que importa.
    function* recorrer(reglas) {
      for (const regla of reglas) {
        yield regla;
        if (regla.cssRules && regla.type !== CSSRule.KEYFRAMES_RULE) yield* recorrer(regla.cssRules);
      }
    }

    return [...new Set(malas)];
  }, MAQUETA.source);

  for (const a of animaciones) fallos.push(`[maqueta] ${a}`);

  await contexto.close();
}

/*
 * TODAS LAS FICHAS, UNA VEZ.
 *
 * Arriba solo se recorren las rutas de `presupuestos.json`: cuatro, porque capturarlas en dos temas
 * y dos anchos ya es caro. El agujero es evidente en cuanto pasa: una ficha con un dato que hace
 * lanzar al maniquí —un músculo que no está en el mapa— no aparece en esas cuatro, así que nadie se
 * entera, y su cartel del catálogo sale en blanco.
 *
 * Esto es la otra mitad: se abren TODAS las fichas, en un solo tema y un solo ancho, sin capturar
 * nada. Solo se mira que no lancen y que el lienzo del maniquí exista. Cuesta un par de segundos
 * por ficha y cubre justo lo que las capturas no pueden.
 */
{
  const pagina = await navegador.newPage({ viewport: { width: 900, height: 700 } });
  const idioma = JSON.parse(await readFile(join(RAIZ, 'content/reglas.json'), 'utf8')).idiomas[0];
  const fichas = readdirSync(join(RAIZ, `content/${idioma}/fichas`)).map((f) => f.replace(/\.json$/, ''));

  for (const id of fichas) {
    const errores = [];
    const enConsola = (m) => (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[textos]'))) && errores.push(m.text());
    const enPagina = (e) => errores.push(e.message);
    pagina.on('console', enConsola);
    pagina.on('pageerror', enPagina);

    await pagina.goto(`${BASE}#/f/${id}`, { waitUntil: 'load' });
    await pagina.waitForTimeout(2000);
    const conManiqui = await pagina.evaluate(() => {
      const c = document.querySelector('canvas.lienzo');
      return c ? c.width * c.height > 0 : null;
    });

    for (const e of errores) fallos.push(`[ficha ${id}] ${e}`);
    if (conManiqui === false) fallos.push(`[ficha ${id}] el lienzo del maniquí está vacío`);

    pagina.off('console', enConsola);
    pagina.off('pageerror', enPagina);
  }

  await pagina.close();
}

await navegador.close();

if (fallos.length) {
  console.error(`\n${fallos.length} problema(s):\n`);
  for (const f of fallos) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log('\n✓ El sitio se recorre entero sin errores, en los dos temas y los dos anchos.\n');
