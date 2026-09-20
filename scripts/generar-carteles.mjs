#!/usr/bin/env node
/**
 * Saca el cartel de cada ficha: una imagen fija que el catálogo enseña en la rejilla.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/generar-carteles.mjs
 *
 * POR QUÉ IMÁGENES Y NO EL MANIQUÍ EN CADA TARJETA. Un catálogo de cien fichas con cien lienzos 3D
 * no es cien veces más lento: es imposible. Los navegadores permiten del orden de ocho o dieciséis
 * contextos WebGL a la vez, así que a partir del noveno el navegador empieza a tirar los anteriores
 * y las tarjetas se quedan en blanco de forma aleatoria. La rejilla lleva imágenes; el 3D vive solo
 * en la ficha abierta, que es una a la vez.
 *
 * Los carteles SE VERSIONAN aunque sean generados: la compilación no puede regenerarlos —necesita
 * un navegador— y sin ellos el catálogo sale con huecos.
 */

import { chromium } from 'playwright';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:4173/';
const SALIDA = 'public/carteles';
const VISTA = process.env.VISTA ?? 'tres_cuartos';
const reglas = JSON.parse(readFileSync('content/reglas.json', 'utf8'));
const idioma = reglas.idiomas[0];
const fichas = readdirSync(`content/${idioma}/fichas`).map((f) => f.replace(/\.json$/, ''));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fichas;

mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
/*
 * 340 × 476 px reales, y ni uno más. La tarjeta mide 272 px de ancho como mucho, y en el móvil
 * —dos columnas en 400 px— unos 150.
 *
 * Esto se ha bajado dos veces y las dos por la misma razón: el catálogo entero se descarga de golpe
 * y el primer cartel es el elemento más grande de la portada, así que su peso ES el LCP del móvil
 * de gama baja. Con 960 px pesaban 120 kB cada uno; con 600 × 840, unos 50, y al llegar a catorce
 * ejercicios eran 700 kB de imágenes por una portada y el LCP se fue a 3,9 s. A 340 × 476 pesan
 * unos 20 kB, y el número de ejercicios puede seguir creciendo sin que la portada se resienta.
 */
const pagina = await navegador.newPage({ viewport: { width: 340, height: 476 }, deviceScaleFactor: 1 });

let hechos = 0;
const vacios = [];
for (const id of ids) {
  // `cartel` congela la primera pose y esconde los controles; `vista` fija el mismo ángulo para
  // todos, que es lo que hace que la rejilla se lea como una rejilla y no como un álbum.
  await pagina.goto(`${BASE}?cartel&vista=${VISTA}#/f/${id}`);
  const lienzo = pagina.locator('canvas.lienzo');
  // Se ESPERA al lienzo, no se pregunta si está: la pieza del maniquí se carga aparte, así que
  // preguntar nada más navegar dice que no hay maniquí en fichas que sí lo tienen.
  const hay = await lienzo.waitFor({ state: 'attached', timeout: 15_000 }).then(() => true).catch(() => false);
  if (!hay) {
    console.log(`· ${id}: sin maniquí (¿ficha sin movimiento_id, o proyecto sin el módulo figura?)`);
    continue;
  }
  /*
   * SE COMPRUEBA QUE EL CARTEL TENGA MANIQUÍ, NO SE SUPONE.
   *
   * Aquí había una espera fija de 1,5 s y una captura. Si el modelo no había terminado de cargar se
   * guardaba un PNG transparente —1 kB— y el guion escribía "✓" igual. Pasó: dos carteles salieron
   * en blanco y no se supo hasta verlos en la web.
   *
   * Ahora se mide cuánta imagen hay, decodificando el PNG en la propia página con un lienzo 2D y
   * contando el píxel opaco. Un cartel de verdad cubre del 10 al 40 % del cuadro; por debajo del
   * 3 % no hay maniquí: se reintenta con más espera, y si sigue vacío el guion FALLA.
   */
  let cubre = 0;
  let imagen = null;
  for (const espera of [1500, 3000, 6000]) {
    await pagina.waitForTimeout(espera);
    // `omitBackground` guarda el PNG con transparencia: el fondo lo pone la tarjeta, y así el mismo
    // cartel vale para el tema claro y para el oscuro.
    imagen = await lienzo.screenshot({ omitBackground: true });
    cubre = await pagina.evaluate(async (datos) => {
      const img = new Image();
      img.src = `data:image/png;base64,${datos}`;
      await img.decode();
      const c = document.createElement('canvas');
      [c.width, c.height] = [img.width, img.height];
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let opacos = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opacos += 1;
      return opacos / (c.width * c.height);
    }, imagen.toString('base64'));
    if (cubre >= 0.03) break;
    await pagina.reload();
    await lienzo.waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});
  }

  if (cubre < 0.03) {
    vacios.push(`${id} (${(cubre * 100).toFixed(1)} % de imagen)`);
    continue;
  }
  writeFileSync(`${SALIDA}/${id}.png`, imagen);
  hechos += 1;
}
await navegador.close();

console.log(`\n${hechos} cartel(es) en ${SALIDA}/`);
if (hechos && !existsSync('.git')) console.log('Recuerda versionarlos: la compilación no puede regenerarlos.');

// Carteles que sobran: quedan de fichas borradas y solo estorban en el repositorio.
const vivos = new Set(fichas.map((f) => `${f}.png`));
const huerfanos = readdirSync(SALIDA).filter((f) => f.endsWith('.png') && !vivos.has(f));
if (huerfanos.length) console.log(`Carteles sin ficha, se pueden borrar: ${huerfanos.join(', ')}`);

if (vacios.length) {
  console.error(`✗ Sin maniquí después de tres intentos: ${vacios.join(', ')}`);
  console.error('  El cartel se habría guardado en blanco. Revisa que la ficha cargue el maniquí.');
  process.exit(1);
}
