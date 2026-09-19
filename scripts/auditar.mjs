#!/usr/bin/env node
/**
 * Auditoría de rendimiento sobre el build de producción.
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npm run auditar
 *
 * MIDE LO QUE ESTE PROYECTO SE COMPROMETIÓ A VIGILAR —presupuestos.json—, no una puntuación
 * genérica. Un 92 en una herramienta de terceros no dice si el sitio sigue siendo usable en el
 * móvil de gama baja al que va dirigido; un presupuesto de 200 kB, sí.
 *
 * Dos cosas que es fácil medir mal, y que aquí están medidas a propósito de esta forma:
 *
 *  1. LOS TAMAÑOS SE LEEN DE `request.sizes()`, no de la cabecera `content-length`. Esa cabecera no
 *     viene en respuestas con codificación por bloques, que son la mayoría, y entonces todos los
 *     tamaños salen a cero y la auditoría pasa siempre.
 *  2. «Three.js no debe entrar en la carga inicial» es un criterio incorrecto si la portada tiene
 *     una escena: entonces se pide, y con razón. Lo que se exige es que NO BLOQUEE el primer
 *     pintado, que es lo que de verdad se prometió.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.URL_BASE ?? 'http://localhost:4173/';
const P = JSON.parse(await readFile(join(RAIZ, 'presupuestos.json'), 'utf8'));

const fallos = [];
const kb = (bytes) => (bytes / 1024).toFixed(1);

/**
 * Cuenta contextos WebGL vivos desde dentro de la página.
 *
 * Se instrumenta getContext y loseContext antes de que cargue nada. Contar canvas en el DOM no
 * vale: el problema es justo el contexto que sigue vivo después de que su canvas se haya quitado.
 */
const INSTRUMENTAR = `
  window.__webgl = { creados: 0, perdidos: 0 };
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (tipo, ...resto) {
    const ctx = original.call(this, tipo, ...resto);
    // La sonda que pregunta con qué GPU se está pintando no cuenta: es de la auditoría, no del sitio.
    if (ctx && /webgl/i.test(tipo) && !this.dataset.sonda) {
      window.__webgl.creados++;
      const ext = ctx.getExtension('WEBGL_lose_context');
      if (ext && !ext.__parcheado) {
        const perder = ext.loseContext.bind(ext);
        ext.loseContext = () => { window.__webgl.perdidos++; perder(); };
        ext.__parcheado = true;
      }
    }
    return ctx;
  };
`;

async function medir({ nombre, cpu = 1, red = null }) {
  /*
   * Con la GPU de verdad si la hay. Sin estos argumentos, Chromium headless pinta con SwiftShader
   * —la CPU haciendo de tarjeta gráfica— y la fluidez del 3D sale en el 95 % de fotogramas lentos
   * midiendo algo que ningún visitante verá. En CI no hay GPU y SwiftShader es lo que habrá; por eso
   * ese presupuesto solo se exige cuando se ha pintado con hardware (ver más abajo).
   */
  const navegador = await chromium.launch({
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const pagina = await contexto.newPage();
  await pagina.addInitScript(INSTRUMENTAR);

  const cdp = await contexto.newCDPSession(pagina);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (red) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: red.latencia,
      downloadThroughput: red.bajada,
      uploadThroughput: red.subida,
    });
  }

  let jsCritico = 0;
  let jsThree = 0;
  let primerPintado = null;

  pagina.on('requestfinished', async (peticion) => {
    try {
      const respuesta = await peticion.response();
      if (!respuesta) return;
      const tipo = peticion.resourceType();
      if (tipo !== 'script') return;
      const { requestBodySize, responseBodySize, responseHeadersSize } = await peticion.sizes();
      const bytes = responseBodySize + responseHeadersSize + requestBodySize;
      // El chunk de Three va aparte: no lo descarga quien no abre una escena.
      if (/three/i.test(peticion.url())) jsThree += bytes;
      else jsCritico += bytes;
    } catch {
      // Una petición cancelada al cerrar la página no es un dato: se ignora.
    }
  });

  await pagina.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });

  const metricas = await pagina.evaluate(async () => {
    const pintado = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;

    const lcp = await new Promise((resolver) => {
      let ultimo = 0;
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries()) ultimo = e.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => resolver(ultimo), 600);
    });

    const cls = await new Promise((resolver) => {
      let total = 0;
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries()) if (!e.hadRecentInput) total += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
      setTimeout(() => resolver(total), 600);
    });

    const three = performance.getEntriesByType('resource').find((r) => /three/i.test(r.name));
    return { pintado, lcp, cls, threeFin: three?.responseEnd ?? null, webgl: window.__webgl };
  });

  /*
   * Fluidez al recorrer el sitio.
   *
   * Se mide DESPLAZÁNDOSE DE VERDAD, fotograma a fotograma, porque el coste de la escenografía no
   * aparece en ninguna métrica de carga: el sitio puede pintar en 800 ms y luego ir a tirones en
   * cuanto alguien baja. La causa casi siempre es la misma —medir cajas dentro del propio evento de
   * scroll, en vez de dentro de un requestAnimationFrame—, y entonces el navegador recalcula la
   * maqueta varias veces por fotograma.
   *
   * Se descartan los dos primeros fotogramas: el primero incluye el arranque del bucle y sale
   * siempre alto, y uno solo ya bastaba para pasarse del presupuesto en un sitio impecable.
   */
  const fluidez = await pagina.evaluate(async () => {
    const deltas = [];
    let anterior = performance.now();
    const paso = Math.max(8, Math.round(window.innerHeight / 50));

    await new Promise((fin) => {
      const fotograma = (ahora) => {
        deltas.push(ahora - anterior);
        anterior = ahora;
        window.scrollBy(0, paso);
        const fondo = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        if (deltas.length >= 150 || fondo) fin();
        else requestAnimationFrame(fotograma);
      };
      requestAnimationFrame(fotograma);
    });

    window.scrollTo(0, 0);
    const utiles = deltas.slice(2);
    const lentos = utiles.filter((d) => d > 50).length;
    return {
      fotogramas: utiles.length,
      lentos,
      porcentaje: utiles.length ? (lentos / utiles.length) * 100 : 0,
      peor: utiles.length ? Math.max(...utiles) : 0,
    };
  });

  /*
   * Segunda parada: las rutas donde vive el 3D.
   *
   * Sin esto, en una app de catálogo la auditoría medía la portada y se iba: el maniquí no llega a
   * montarse en ninguna de las medidas, así que el presupuesto de contextos WebGL —el que existe
   * justamente por el 3D— no comprobaba nada. Y se vuelve a la portada para comprobar lo que de
   * verdad importa: que al salir se libere el contexto.
   */
  const paradas = [];
  const renderer = await pagina.evaluate(() => {
    const lienzo = document.createElement('canvas');
    lienzo.dataset.sonda = '1';
    const gl = lienzo.getContext('webgl2') ?? lienzo.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'desconocido';
  });
  const porSoftware = /swiftshader|llvmpipe|software/i.test(renderer);

  for (const ruta of P.rutas_3d ?? []) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 60000 });
    await pagina.waitForTimeout(1500);

    const marcha = await pagina.evaluate(async () => {
      const deltas = [];
      let anterior = performance.now();
      await new Promise((fin) => {
        const fotograma = (ahora) => {
          deltas.push(ahora - anterior);
          anterior = ahora;
          if (deltas.length >= 120) fin();
          else requestAnimationFrame(fotograma);
        };
        requestAnimationFrame(fotograma);
      });
      const utiles = deltas.slice(2);
      const lentos = utiles.filter((d) => d > 50).length;
      return {
        fotogramas: utiles.length,
        lentos,
        porcentaje: utiles.length ? (lentos / utiles.length) * 100 : 0,
        peor: utiles.length ? Math.max(...utiles) : 0,
        webgl: window.__webgl,
      };
    });

    await pagina.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
    await pagina.waitForTimeout(500);
    const alSalir = await pagina.evaluate(() => window.__webgl);
    paradas.push({ ruta, ...marcha, alSalir, renderer, porSoftware });
  }

  primerPintado = metricas.pintado;
  await navegador.close();

  return { nombre, jsCritico, jsThree, ...metricas, fluidez, primerPintado, paradas };
}

/* ------------------------------------------------------------------ informe -- */

for (const escenario of P.escenarios) {
  const r = await medir(escenario);

  console.log(`\n── ${r.nombre} ─────────────────────────────`);
  console.log(`  JS crítico          ${kb(r.jsCritico).padStart(8)} kB   (presupuesto ${P.js_critico_kb} kB)`);
  console.log(`  JS de Three.js      ${kb(r.jsThree).padStart(8)} kB   (aparte, a propósito)`);
  console.log(`  Primer pintado      ${(r.primerPintado ?? 0).toFixed(0).padStart(8)} ms`);
  console.log(`  LCP                 ${(r.lcp ?? 0).toFixed(0).padStart(8)} ms   (presupuesto ${P.lcp_ms} ms)`);
  console.log(`  CLS                 ${(r.cls ?? 0).toFixed(3).padStart(8)}      (presupuesto ${P.cls})`);
  console.log(`  Contextos WebGL     ${String(r.webgl.creados - r.webgl.perdidos).padStart(8)}      (creados ${r.webgl.creados}, liberados ${r.webgl.perdidos})`);
  console.log(`  Fotogramas lentos   ${r.fluidez.porcentaje.toFixed(1).padStart(8)} %    (presupuesto ${P.scroll_fotogramas_lentos_pct} %, peor ${r.fluidez.peor.toFixed(0)} ms sobre ${r.fluidez.fotogramas})`);
  for (const p of r.paradas ?? []) {
    const vivos = p.webgl.creados - p.webgl.perdidos;
    const tras = p.alSalir.creados - p.alSalir.perdidos;
    console.log(`  ${p.ruta.padEnd(19).slice(0, 19)} ${p.porcentaje.toFixed(1).padStart(8)} %    (fotogramas lentos con el 3D en marcha, peor ${p.peor.toFixed(0)} ms; contextos ${vivos} ahí y ${tras} al volver)`);
    if (p.porSoftware) console.log(`                      ${' '.repeat(8)}      pintado por software (${p.renderer.slice(0, 40)}): el dato no cuenta`);
  }

  const kbCritico = r.jsCritico / 1024;
  if (kbCritico > P.js_critico_kb) {
    fallos.push(`[${r.nombre}] JS crítico ${kbCritico.toFixed(1)} kB > ${P.js_critico_kb} kB`);
  }
  if (r.lcp > P.lcp_ms) fallos.push(`[${r.nombre}] LCP ${r.lcp.toFixed(0)} ms > ${P.lcp_ms} ms`);
  if (r.cls > P.cls) {
    fallos.push(
      `[${r.nombre}] CLS ${r.cls.toFixed(3)} > ${P.cls}. Casi siempre es un hueco sin reservar: ` +
      `comprueba que todo contenedor de visualización lleve aspect-ratio.`,
    );
  }

  if (
    P.scroll_fotogramas_lentos_pct !== undefined &&
    r.fluidez.fotogramas >= 20 &&
    r.fluidez.porcentaje > P.scroll_fotogramas_lentos_pct
  ) {
    fallos.push(
      `[${r.nombre}] ${r.fluidez.porcentaje.toFixed(1)} % de fotogramas por encima de 50 ms al ` +
      `recorrer el sitio, presupuesto ${P.scroll_fotogramas_lentos_pct} %. Mira quién trabaja en ` +
      `el scroll: lo que mide cajas debe hacerlo dentro de un requestAnimationFrame, no en el evento.`,
    );
  }

  const vivos = r.webgl.creados - r.webgl.perdidos;
  if (vivos > P.contextos_webgl_vivos) {
    fallos.push(
      `[${r.nombre}] ${vivos} contextos WebGL vivos, máximo ${P.contextos_webgl_vivos}. ` +
      `Alguna escena no llama a destruir(), o lo llama sin forceContextLoss().`,
    );
  }

  for (const p of r.paradas ?? []) {
    const enLaParada = p.webgl.creados - p.webgl.perdidos;
    if (enLaParada > P.contextos_webgl_vivos) {
      fallos.push(
        `[${r.nombre}] ${enLaParada} contextos WebGL vivos en ${p.ruta}, máximo ` +
        `${P.contextos_webgl_vivos}.`,
      );
    }
    const alVolver = p.alSalir.creados - p.alSalir.perdidos;
    if (alVolver > 0) {
      fallos.push(
        `[${r.nombre}] al salir de ${p.ruta} quedan ${alVolver} contextos WebGL vivos: la pieza no ` +
        `se está liberando al cambiar de pantalla. Es el fallo que no se nota hasta la novena ficha, ` +
        `cuando el navegador empieza a tirar contextos y las escenas se quedan en blanco.`,
      );
    }
    // Solo se exige si lo pintó una GPU: con SwiftShader el número mide la CPU, no el sitio.
    if (!p.porSoftware && P.fotogramas_lentos_3d_pct !== undefined && p.fotogramas >= 20 && p.porcentaje > P.fotogramas_lentos_3d_pct) {
      fallos.push(
        `[${r.nombre}] ${p.porcentaje.toFixed(1)} % de fotogramas por encima de 50 ms en ${p.ruta} ` +
        `con el 3D en marcha, presupuesto ${P.fotogramas_lentos_3d_pct} %.`,
      );
    }
  }

  if (P.three_no_bloquea_pintado && r.threeFin !== null && r.primerPintado !== null) {
    if (r.threeFin < r.primerPintado) {
      fallos.push(
        `[${r.nombre}] Three.js terminó de cargar (${r.threeFin.toFixed(0)} ms) ANTES del primer ` +
        `pintado (${r.primerPintado.toFixed(0)} ms): está bloqueándolo.`,
      );
    }
  }
}

if (fallos.length) {
  console.error(`\n${fallos.length} presupuesto(s) incumplido(s):\n`);
  for (const f of fallos) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log('\n✓ Todos los presupuestos de rendimiento se cumplen.\n');
