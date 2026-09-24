#!/usr/bin/env node
/**
 * Comprobación de alineaciones sobre el sitio compilado y servido.
 *
 *   npm run build && npx vite preview --port 4173
 *   npm run alineacion
 *
 * POR QUÉ EXISTE. «Está descuadrado» es de las pocas cosas que se ven a simple vista y no se
 * encuentran mirando el CSS: el rótulo de grupo de las tarjetas empezaba 11 px a la derecha del
 * nombre —se lo comían un filete de 3 px y su relleno—, y eso, repetido en nueve tarjetas, es lo
 * que hace que una página parezca hecha a ojo. Ningún validador de contenido ni de contraste lo ve.
 * Aquí se miden cajas reales con `getBoundingClientRect` en el navegador, en los dos temas y los dos
 * anchos, y se listan solo las que no cuadran.
 *
 * QUÉ **NO** MIDE. El gusto. Que dos bloques estén alineados no dice si la página está bien
 * compuesta; para eso están las capturas y mirarlas. Esto solo caza lo que es medible y objetivo:
 * desbordes, centrados, alturas dispares y textos que deberían compartir vertical y no la comparten.
 *
 * Se mide el BORDE DE CONTENIDO, no el del elemento: los bloques de primer nivel llevan su propio
 * relleno lateral, así que comparar los bordes exteriores daba dieciséis píxeles de diferencia
 * donde no había ninguna. Era un falso positivo, y un falso positivo acaba con que nadie mire la
 * salida.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { datosDeEjemplo } from './lib/datos-ejemplo.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.URL_BASE ?? 'http://localhost:4173/';
const P = JSON.parse(await readFile(join(RAIZ, 'presupuestos.json'), 'utf8'));
const RUTAS = P.rutas ?? [''];

/* Medio píxel es redondeo del navegador; a partir de uno y medio hay una decisión de CSS detrás. */
const TOLERANCIA = 1.5;
/*
 * El alto mínimo de un control, y depende del puntero.
 *
 * 44 px con el dedo: por debajo se falla el toque, y es la medida que dan las pautas táctiles. Con
 * ratón, 40 basta y de hecho conviene —una interfaz densa con todo a 44 se ve inflada—, porque el
 * cursor apunta a un píxel. Exigir 44 en las dos daba doce fallos sobre una interfaz correcta.
 */
const TACTIL = { escritorio: 40, movil: 44 };

const VISTAS = [
  { nombre: 'escritorio', viewport: { width: 1280, height: 900 } },
  { nombre: 'movil', viewport: { width: 400, height: 820 }, isMobile: true, hasTouch: true },
];

/**
 * Todo lo que se mide vive aquí dentro: se ejecuta EN LA PÁGINA, no en Node.
 *
 * Por eso los umbrales entran como argumento: la función se serializa y se evalúa en el navegador,
 * donde las constantes de este fichero no existen. La primera versión las usaba directamente y
 * reventaba con «TACTIL is not defined» en la primera ruta.
 */
function medir({ TOLERANCIA, TACTIL }) {
  const caja = (el) => {
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(2), y: +(b.y + scrollY).toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
  };

  /* La caja del TEXTO, no la del elemento: un rótulo con relleno propio alinea por su letra, que es
     lo que se ve, y no por su caja, que es invisible. */
  const cajaTexto = (el) => {
    if (!el) return null;
    const rango = document.createRange();
    let u = null;
    const andar = (n) => {
      for (const h of n.childNodes) {
        if (h.nodeType === 3 && h.textContent.trim()) {
          rango.selectNodeContents(h);
          const b = rango.getBoundingClientRect();
          if (b.width || b.height) {
            u = u
              ? { t: Math.min(u.t, b.top), i: Math.min(u.i, b.left), b: Math.max(u.b, b.bottom), d: Math.max(u.d, b.right) }
              : { t: b.top, i: b.left, b: b.bottom, d: b.right };
          }
        } else if (h.nodeType === 1) andar(h);
      }
    };
    andar(el);
    return u ? { x: +u.i.toFixed(2), y: +(u.t + scrollY).toFixed(2), w: +(u.d - u.i).toFixed(2), h: +(u.b - u.t).toFixed(2) } : null;
  };

  const fallos = [];
  const anota = (s) => fallos.push(s);
  const qa = (s, raiz) => [...(raiz ?? document).querySelectorAll(s)];

  /* 1. Nada se sale de la ventana. Un desborde lateral en el móvil es el fallo de maquetación más
        visible que existe: la página entera se desplaza y ya no se centra nada. */
  if (document.documentElement.scrollWidth > innerWidth + 0.5) {
    anota(`la página mide ${document.documentElement.scrollWidth} px de ancho en una ventana de ${innerWidth}`);
  }
  for (const el of qa('body *')) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && (b.right > innerWidth + 0.5 || b.left < -0.5)) {
      anota(`se sale de la ventana: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} (de ${Math.round(b.left)} a ${Math.round(b.right)})`);
      break; // El primero basta: los demás suelen ser sus padres o sus hijos.
    }
  }

  /* 2. Los controles. Alto mínimo, contenido centrado y alturas iguales entre los de la misma clase.
        El contenido se mide con TODOS los hijos dentro, no solo con el texto: un icono o un punto de
        color delante desplazan la letra a propósito, y marcarlo sería un falso positivo. */
  const SEL = '.boton, .chip, .favorito, .barra nav a, .barra nav button, .filtros summary, .vecinos a, .figura .controles button';
  const alturas = new Map();
  for (const c of qa(SEL)) {
    const r = c.getBoundingClientRect();
    const etq = (c.textContent || '').trim().slice(0, 18) || c.tagName.toLowerCase();
    /* Lo que no se pinta no se mide. El panel de filtros lleva la cabecera y el pie del cajón del
       móvil escondidos en escritorio, y el botón de abrir el cajón escondido también: medían cero y
       salían como «control de 0 px de alto», que no es un fallo, es un control que no está ahí. */
    if (r.width === 0 || r.height === 0) continue;
    if (r.height + 0.5 < TACTIL) anota(`control de ${Math.round(r.height)} px de alto: "${etq}"`);

    /*
     * El centrado se comprueba de dos maneras según lo que lleve dentro, y esto no es un capricho:
     * un `::before` —el punto de color del grupo, la flecha de "Más filtros"— ocupa sitio real pero
     * no aparece ni en `children` ni en la caja del texto, así que la primera versión medía solo la
     * letra, la veía 8,5 px a la derecha y cantaba las nueve píldoras del catálogo como
     * descuadradas cuando estaban perfectas. Cuando hay pseudoelemento se comprueba la simetría del
     * relleno, que es la regla de la que depende el centrado; cuando no lo hay, la geometría.
     */
    const e = getComputedStyle(c);
    const decorado = ['::before', '::after'].some((p) => {
      const cs = getComputedStyle(c, p).content;
      return cs && cs !== 'none' && cs !== 'normal';
    });
    if (decorado) {
      const izq = parseFloat(e.paddingLeft);
      const der = parseFloat(e.paddingRight);
      if (Math.abs(izq - der) > TOLERANCIA) anota(`relleno asimétrico (${izq} / ${der}) en el control "${etq}"`);
      if (e.display.includes('flex') && e.justifyContent !== 'center') {
        anota(`contenido sin centrar (justify-content: ${e.justifyContent}) en el control "${etq}"`);
      }
    } else {
      const hijos = [...c.children].map((h) => h.getBoundingClientRect()).filter((b) => b.width > 0);
      const txt = cajaTexto(c);
      const partes = [...hijos, ...(txt ? [{ left: txt.x, right: txt.x + txt.w }] : [])];
      if (partes.length) {
        const i = Math.min(...partes.map((p) => p.left));
        const d = Math.max(...partes.map((p) => p.right));
        const dx = (i + d) / 2 - (r.left + r.right) / 2;
        if (Math.abs(dx) > TOLERANCIA) anota(`contenido descentrado ${dx.toFixed(1)} px en el control "${etq}"`);
      }
    }
    const ico = c.querySelector('.icono');
    if (ico) {
      const b = ico.getBoundingClientRect();
      const dy = (b.top + b.bottom) / 2 - (r.top + r.bottom) / 2;
      if (Math.abs(dy) > TOLERANCIA) anota(`icono descentrado ${dy.toFixed(1)} px en el control "${etq}"`);
    }
    const clase = String(c.className).split(' ')[0] || c.tagName.toLowerCase();
    if (!alturas.has(clase)) alturas.set(clase, new Set());
    alturas.get(clase).add(Math.round(r.height));
  }
  for (const [clase, v] of alturas) {
    if (v.size > 1) anota(`alturas distintas en .${clase}: ${[...v].sort((a, b) => a - b).join(', ')} px`);
  }

  /* 3. El carril izquierdo. Todos los bloques de primer nivel tienen que empezar su CONTENIDO en la
        misma vertical: si el pie arranca a 96 y el texto de la ficha a 112, la página se lee torcida
        aunque cada bloque, por separado, esté centrado. */
  const carril = new Map();
  /* Solo bloques de PRIMER nivel. `.buscador` y `.rejilla` entraron aquí cuando colgaban del
     cuerpo; desde que viven dentro de la columna de resultados, exigirles el mismo margen que al
     pie era pedir que la columna no estuviera donde está. */
  for (const sel of ['.barra > *', '.portada', '.reparto', '.ficha', '.aviso', '.vacio']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    if (!b.width) continue;
    carril.set(sel, Math.round(b.left + parseFloat(getComputedStyle(el).paddingLeft)));
  }
  const bordes = [...new Set(carril.values())];
  if (bordes.length > 1) {
    anota(`bloques con distinto margen izquierdo: ${[...carril].map(([s, x]) => `${s}=${x}`).join('  ')}`);
  }

  /* 4. Textos que van uno debajo de otro dentro de una misma pieza. Es el fallo que más se nota y el
        que más cuesta ver en el CSS, porque lo provoca un borde o un relleno de tres píxeles. */
  const apilados = [
    ['.tarjeta', ['.nombre', '.etiqueta-grupo']],
    ['.ficha header', ['h1', '.grupo']],
    ['.portada', ['h1', 'p']],
  ];
  /*
   * Se compara el borde del CONTENIDO, no el de la primera letra.
   *
   * Midiendo la letra, cualquier marcador —el punto de color del grupo, una viñeta— contaba como
   * desalineación: el rótulo salía 14 px a la derecha del nombre estando exactamente donde debe,
   * porque el punto ocupa el principio de su propia caja. Lo que tiene que coincidir es dónde
   * empieza el contenido de cada uno.
   */
  const bordeContenido = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    // Escondido —la entradilla de la portada cuando no hay— mide cero y no está desalineado con
    // nada: compararlo daba «0 vs 16» en cada pantalla del catálogo.
    if (!b.width && !b.height) return null;
    const e = getComputedStyle(el);
    /*
     * Lo que tiene que coincidir depende de CÓMO esté alineado el bloque: dos textos centrados
     * comparten centro, no borde izquierdo. La frase de la portada va centrada y a ancho completo
     * y su entradilla centrada y estrecha: por la izquierda se llevan trescientos píxeles y están
     * perfectamente alineadas. Comparar siempre la izquierda daba ese falso positivo.
     */
    if (e.textAlign === 'center') return { eje: 'centro', x: b.left + b.width / 2 };
    return { eje: 'izquierda', x: b.left + parseFloat(e.paddingLeft) };
  };
  for (const [contenedor, dentro] of apilados) {
    for (const raiz of qa(contenedor)) {
      const medidas = dentro.map((s) => bordeContenido(raiz.querySelector(s))).filter((x) => x !== null);
      // Con alineaciones distintas no hay nada que comparar: un titular centrado sobre una lista a
      // la izquierda es una decisión, no un descuadre.
      if (medidas.length > 1 && new Set(medidas.map((m) => m.eje)).size > 1) continue;
      const xs = medidas.map((m) => m.x);
      if (xs.length > 1 && Math.max(...xs) - Math.min(...xs) > TOLERANCIA) {
        anota(`en ${contenedor}, ${dentro.join(' y ')} no arrancan en la misma vertical: ${xs.map((x) => x.toFixed(1)).join(' vs ')}`);
        break; // Un ejemplo por pieza: si falla una tarjeta, fallan las nueve.
      }
    }
  }

  /* 5. La rejilla: todas las tarjetas del mismo tamaño. Una fila más baja que la de arriba deja el
        catálogo con un escalón por el que no pasa ninguna otra comprobación. */
  const dims = new Set(qa('.rejilla > *').map((t) => `${Math.round(t.getBoundingClientRect().width)}×${Math.round(t.getBoundingClientRect().height)}`));
  if (dims.size > 1) anota(`tarjetas de tamaños distintos: ${[...dims].join('  ')}`);

  /* 6. Listas numeradas o con viñeta: todas las líneas arrancan igual. */
  for (const lista of qa('.pasos')) {
    const xs = [...lista.children].map((li) => cajaTexto(li)).filter(Boolean).map((t) => Math.round(t.x));
    if (new Set(xs).size > 1) anota(`los pasos no arrancan en la misma vertical: ${[...new Set(xs)].join(', ')}`);
  }

  return fallos;
}

const navegador = await chromium.launch();
let total = 0;

for (const vista of VISTAS) {
  for (const tema of ['claro', 'oscuro']) {
    const ctx = await navegador.newContext({
      viewport: vista.viewport,
      isMobile: vista.isMobile ?? false,
      hasTouch: vista.hasTouch ?? false,
      colorScheme: tema === 'oscuro' ? 'dark' : 'light',
    });
    /*
     * Un tema con registro de ejemplo y EN INGLÉS, y el otro vacío y en español: así se miran los dos
     * estados de la ficha y los dos idiomas sin doblar el tiempo de la comprobación. El inglés hace
     * falta: sus textos son más largos, y la cabecera del móvil cabía en español y en inglés no.
     */
    if (tema === 'oscuro') {
      await ctx.addInitScript((d) => {
        try { localStorage.setItem('befit.datos.v1', d); localStorage.setItem('idioma', 'en'); } catch {}
      }, JSON.stringify(datosDeEjemplo()));
    }
    const pagina = await ctx.newPage();
    for (const ruta of RUTAS) {
      await pagina.goto(BASE + ruta, { waitUntil: 'networkidle', timeout: 60000 });
      // El maniquí llega en un paquete aparte: medir antes es medir un hueco vacío.
      await pagina.waitForTimeout(900);
      const fallos = await pagina.evaluate(medir, { TOLERANCIA, TACTIL: TACTIL[vista.nombre] });
      if (fallos.length) {
        console.log(`\n── ${vista.nombre} · ${tema} · ${ruta || '/'} ─────────────`);
        for (const f of fallos) console.log(`  ✗ ${f}`);
        total += fallos.length;
      }
    }
    await ctx.close();
  }
}

await navegador.close();

if (total) {
  console.log(`\n✗ ${total} alineaciones que no cuadran.`);
  process.exit(1);
}
console.log('\n✓ Alineaciones, centrados y alturas cuadran en los dos temas y los dos anchos.');
