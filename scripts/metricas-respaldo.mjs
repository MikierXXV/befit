#!/usr/bin/env node
/**
 * Calcula las métricas de la tipografía de respaldo para que el cambio de fuente NO mueva la página.
 *
 *   npm run build && npx vite preview --port 4173
 *   node scripts/metricas-respaldo.mjs
 *
 * EL PROBLEMA QUE RESUELVE. Al servir las tipografías propias con `font-display: swap`, el texto se
 * pinta primero con la del sistema y luego cambia. Si las dos no ocupan lo mismo, todo lo que hay
 * debajo salta: en este proyecto el CLS del móvil pasó de 0,000 a 0,071 el día que se cargaron las
 * fuentes. Es el salto que el visitante vive como «se me ha movido el botón al ir a tocarlo».
 *
 * CÓMO SE MIDE. Se pregunta al navegador, no a una tabla copiada de internet: `measureText` da el
 * ancho medio y la caja vertical real de cada familia, y de ahí salen los tres números que igualan
 * la de respaldo con la buena. Una tabla de métricas envejece con la fuente; esto no.
 *
 * `size-adjust` escala también los `*-override`, por eso se dividen por él: el ascenso final es
 * `tamaño × size-adjust × ascent-override`, y lo que se quiere es que dé el ascenso de la real.
 *
 * Las métricas del respaldo se miden en ESTA máquina. Arial, Liberation Sans y Helvetica son
 * compatibles entre sí, y Times New Roman con Liberation Serif, así que el ajuste vale en los tres
 * sistemas; con una familia de respaldo distinta habría que volver a medirlo donde toque.
 */

import { chromium } from 'playwright';

const BASE = process.env.URL_BASE ?? 'http://localhost:4173/';

/** Las dos familias del sistema de diseño, cada una con la del sistema a la que debe parecerse. */
const FAMILIAS = [
  { propia: 'Inter', respaldo: 'Arial', locales: ['Arial', 'Helvetica', 'Liberation Sans'] },
  {
    propia: 'Newsreader',
    respaldo: 'Times New Roman',
    locales: ['Times New Roman', 'Times', 'Liberation Serif'],
  },
];

/* Mezcla de mayúsculas, minúsculas con astas y descendentes, y acentos: un ancho medio sacado solo
 * de minúsculas cortas miente en cuanto el texto lleva títulos. */
const MUESTRA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz áéíóúñü 0123456789';

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
await pagina.goto(BASE, { waitUntil: 'networkidle' });
await pagina.evaluate(() => document.fonts.ready);

const medidas = await pagina.evaluate(
  ({ familias, muestra }) => {
    const lienzo = document.createElement('canvas').getContext('2d');

    /* 1000px y no 100: el ancho vuelve con decimales y a tamaño pequeño el redondeo del navegador
     * se come la tercera cifra, que es justo la que ajusta. */
    const medir = (familia) => {
      lienzo.font = `1000px "${familia}"`;
      const m = lienzo.measureText(muestra);
      return {
        ancho: m.width / 1000,
        ascenso: m.fontBoundingBoxAscent / 1000,
        descenso: m.fontBoundingBoxDescent / 1000,
      };
    };

    return familias.map((f) => ({ ...f, propiaM: medir(f.propia), respaldoM: medir(f.respaldo) }));
  },
  { familias: FAMILIAS, muestra: MUESTRA },
);

await navegador.close();

const pct = (n) => `${(n * 100).toFixed(2)}%`;

for (const m of medidas) {
  /* Si el navegador no encontró la propia, devuelve las métricas de la de respaldo y saldría un
   * ajuste de 100% que no ajusta nada. Mejor cantarlo que escribir un bloque inútil. */
  if (Math.abs(m.propiaM.ancho - m.respaldoM.ancho) < 1e-6) {
    console.error(`⚠ ${m.propia}: mide igual que ${m.respaldo}. ¿Está cargada la fuente?`);
    continue;
  }

  const ajuste = m.propiaM.ancho / m.respaldoM.ancho;
  console.log(`
@font-face {
  font-family: '${m.propia} respaldo';
  src: ${m.locales.map((l) => `local('${l}')`).join(', ')};
  size-adjust: ${pct(ajuste)};
  ascent-override: ${pct(m.propiaM.ascenso / ajuste)};
  descent-override: ${pct(m.propiaM.descenso / ajuste)};
  line-gap-override: 0%;
}`);
}
