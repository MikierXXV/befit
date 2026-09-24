#!/usr/bin/env node
/**
 * Saca los PNG del icono de la app a partir de public/icono.svg.
 *
 *   node scripts/generar-iconos.mjs
 *
 * Hacen falta PNG además del SVG: Chrome acepta el SVG en el manifiesto, pero iOS solo lee un PNG en
 * `apple-touch-icon`, y algunos Android piden tamaños concretos para la pantalla de arranque. Se
 * rasterizan con el mismo Playwright que ya usan el resto de comprobaciones, para no añadir una
 * dependencia solo por esto. Como los carteles, se generan una vez y SE VERSIONAN.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icono.svg', 'utf8');
const navegador = await chromium.launch();
for (const lado of [180, 192, 512]) {
  const pagina = await navegador.newPage({ viewport: { width: lado, height: lado } });
  await pagina.setContent(`<style>html,body{margin:0}svg{display:block;width:${lado}px;height:${lado}px}</style>${svg}`);
  await pagina.screenshot({ path: `public/icono-${lado}.png` });
  await pagina.close();
  console.log(`✓ public/icono-${lado}.png`);
}
await navegador.close();
