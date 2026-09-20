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
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';

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
  // Un respiro más para que el modelo cargue y el primer fotograma esté pintado; si no, sale el hueco.
  await pagina.waitForTimeout(1500);
  // `omitBackground` guarda el PNG con transparencia: el fondo lo pone la tarjeta, y así el mismo
  // cartel vale para el tema claro y para el oscuro.
  await lienzo.screenshot({ path: `${SALIDA}/${id}.png`, omitBackground: true });
  hechos += 1;
}
await navegador.close();

console.log(`\n${hechos} cartel(es) en ${SALIDA}/`);
if (hechos && !existsSync('.git')) console.log('Recuerda versionarlos: la compilación no puede regenerarlos.');
