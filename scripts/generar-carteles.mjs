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
 * 400 × 560 con densidad 1,5 = 600 × 840 px reales. La tarjeta mide como mucho 272 px de ancho, así
 * que con eso sobra incluso en pantallas de densidad doble. Con 960 px de ancho, cada cartel pesaba
 * ~120 kB y el primero de la rejilla era el elemento más grande de la portada: el LCP en el móvil de
 * gama baja se iba por encima del presupuesto por culpa de una imagen que nadie ve a ese tamaño.
 */
const pagina = await navegador.newPage({ viewport: { width: 400, height: 560 }, deviceScaleFactor: 1.5 });

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
