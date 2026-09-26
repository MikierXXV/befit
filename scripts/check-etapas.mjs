/**
 * Los rótulos de la línea de tiempo del maniquí, que no se pisen.
 *
 * POR QUÉ HAY UN GUION PARA ESTO. Cada rótulo se coloca en el punto del ciclo de su pose, y dos
 * poses cercanas —«abajo» en t=0,88 y otra vez al cerrar el ciclo, o cinco etapas en un movimiento
 * alterno— dejan las palabras encima unas de otras en el móvil. Pasó en el hollow hold, el bicho
 * muerto y la elevación de piernas colgado, y no lo vio ninguna comprobación: capturar solo abre
 * cuatro fichas, y el barrido de todas mira errores, no el texto. Depende del ancho y del idioma
 * («EXTENDIDO» y «EXTENDED» no miden lo mismo), así que se mide en el navegador, en los dos.
 *
 * Uso: con el sitio servido (`npx vite preview --port 4173`), `node scripts/check-etapas.mjs`.
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
const BASE = process.env.URL_BASE ?? 'http://localhost:4173/';
const reglas = JSON.parse(readFileSync(join(RAIZ, 'content/reglas.json'), 'utf8'));
const fichas = readdirSync(join(RAIZ, `content/${reglas.idiomas[0]}/fichas`))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((id) => JSON.parse(readFileSync(join(RAIZ, `content/${reglas.idiomas[0]}/fichas/${id}.json`), 'utf8')).movimiento_id);

// El móvil más estrecho que se revisa en el resto de comprobaciones, y el escritorio.
const ANCHOS = [360, 1280];
// Menos de esto entre dos palabras se lee como una sola.
const HUECO_MINIMO = 6;

const navegador = await chromium.launch();
const fallos = [];

for (const idioma of reglas.idiomas) {
  for (const ancho of ANCHOS) {
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: 800 } });
    await contexto.addInitScript((i) => { try { localStorage.setItem('idioma', i); } catch {} }, idioma);
    const pagina = await contexto.newPage();
    for (const id of fichas) {
      await pagina.goto(`${BASE}#/f/${id}`, { waitUntil: 'load' });
      await pagina.waitForSelector('.figura .etapas span', { timeout: 20000 }).catch(() => {});
      const medida = await pagina.evaluate(() => {
        const caja = document.querySelector('.figura .etapas')?.getBoundingClientRect();
        const rotulos = [...document.querySelectorAll('.figura .etapas span')].map((s) => {
          const r = s.getBoundingClientRect();
          return { texto: s.textContent, izq: r.left, der: r.right, arriba: r.top, abajo: r.bottom };
        });
        return { caja: caja && { izq: caja.left, der: caja.right }, rotulos };
      });
      if (!medida.caja) continue;
      const orden = [...medida.rotulos].sort((a, b) => a.izq - b.izq);
      // Se comparan todos con todos: con dos filas, los que se pisan ya no son siempre vecinos.
      for (let i = 0; i < orden.length; i++) {
        for (let j = i + 1; j < orden.length; j++) {
          const a = orden[i], b = orden[j];
          const mismaAltura = a.arriba < b.abajo - 1 && b.arriba < a.abajo - 1;
          const hueco = b.izq - a.der;
          if (mismaAltura && hueco < HUECO_MINIMO) {
            fallos.push(`[${idioma} · ${ancho}px] ${id}: «${a.texto}» y «${b.texto}» se pisan (hueco ${Math.round(hueco)} px)`);
          }
        }
      }
      for (const r of orden) {
        if (r.izq < medida.caja.izq - 1 || r.der > medida.caja.der + 1) {
          fallos.push(`[${idioma} · ${ancho}px] ${id}: «${r.texto}» se sale de la línea de tiempo`);
        }
      }
    }
    await contexto.close();
  }
}

await navegador.close();

if (fallos.length) {
  console.error(`\n${fallos.length} rótulo(s) de la línea de tiempo que se pisan o se salen:\n`);
  for (const f of fallos) console.error(`  ✗ ${f}`);
  console.error('\nJunta o quita etiquetas de poses en content/movimientos/<id>.json, o acorta la etapa en ui.json.\n');
  process.exit(1);
}
console.log(`\n✓ Los rótulos de la línea de tiempo no se pisan: ${fichas.length} fichas, ${reglas.idiomas.length} idiomas, ${ANCHOS.length} anchos.\n`);
