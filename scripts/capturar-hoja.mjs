#!/usr/bin/env node
/**
 * Saca la hoja de revisión de cada ejercicio: 3 vistas × fases clave, en capturas/<id>.png.
 *
 *   npx vite preview --port 4173 &   (con el sitio compilado)
 *   node scripts/capturar-hoja.mjs [id…]
 *
 * Es lo que se mira después de validar. El validador sabe si una rodilla pasa de 155°; no sabe si
 * la sentadilla PARECE una sentadilla. Eso solo lo dice alguien mirando, y esta hoja es lo más
 * barato de mirar.
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:4173/';

/*
 * Se listan las FICHAS y no los movimientos: la hoja se abre por el id de la ficha, que es lo que la
 * página sabe resolver. Y el idioma es el primero de reglas.json, porque la hoja revisa el
 * movimiento, que es común a todos: sacarla dos veces sería la misma imagen con otro título.
 */
const reglas = JSON.parse(readFileSync('content/reglas.json', 'utf8'));
const DIRECTORIO = `content/${reglas.idiomas[0]}/${reglas.colecciones?.fichas?.directorio ?? 'fichas'}`;
const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(DIRECTORIO).map((f) => f.replace(/\.json$/, ''));

mkdirSync('capturas', { recursive: true });
/*
 * Con la GPU de verdad. La hoja es para MIRARLA: con SwiftShader tarda minutos y, sobre todo, pinta
 * el suavizado de otra manera, así que un borde dentado de la hoja no diría nada del sitio real.
 */
const navegador = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pagina = await navegador.newPage({ viewport: { width: 1600, height: 1200 } });
const errores = [];
pagina.on('pageerror', (e) => errores.push(e.message));
pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

for (const id of ids) {
  await pagina.goto(`${BASE}?hoja=${id}`);
  await pagina.waitForFunction(() => window.__hoja?.lista, null, { timeout: 60_000 }).catch(() => {});
  if (errores.length) {
    console.log(`✗ ${id}: ${errores.join(' | ')}`);
    errores.length = 0;
    continue;
  }
  await pagina.locator('canvas.hoja').screenshot({ path: `capturas/${id}.png` });
  console.log(`✓ capturas/${id}.png`);
}
await navegador.close();
