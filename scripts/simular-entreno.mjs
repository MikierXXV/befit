#!/usr/bin/env node
/**
 * Un entreno simulado en un móvil: ¿se VE el maniquí cada vez que se abre un ejercicio?
 *
 *   npm run simular      (con el sitio compilado y servido, como capturar)
 *
 * POR QUÉ EXISTE. El maniquí se pintaba bien las veinte veces que se abría un ejercicio, y aun así
 * solo se veía en la primera: la app repinta en el mismo documento y la página se quedaba con el
 * desplazamiento de la anterior —la ficha abierta desde media lista del catálogo salía 2 400 px por
 * debajo de su maniquí—, y en «Hoy» el maniquí quedaba bajo el plan y el formulario. Ninguna
 * comprobación lo veía: capturar abre cada ruta desde arriba, con la página recién cargada.
 *
 * Esto recorre la app como en el gimnasio —tocar tarjetas, anotar, pasar al vecino, empezar una
 * rutina, cambiar de ejercicio en «Hoy» con el descanso en marcha, diez fichas seguidas— y en cada
 * ejercicio abierto exige tres cosas: el lienzo entero dentro de la pantalla SIN desplazarse, algo
 * pintado en él (no un rectángulo liso) y un solo lienzo vivo. Bloquea, como las demás.
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.URL_BASE ?? 'http://localhost:4173/';
const S = 'capturas';
mkdirSync(`${S}/entreno`, { recursive: true });
const errores = [];
const informe = [];

const nav = await chromium.launch();
const ctx = await nav.newContext({ ...devices['iPhone 13'], locale: 'es-ES' });
await ctx.addInitScript(() => { if (!sessionStorage.getItem('x')) { localStorage.clear(); sessionStorage.setItem('x', '1'); } });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[textos]')) errores.push(m.text()); });
p.on('pageerror', (e) => errores.push(String(e)));

/**
 * ¿Se ve el maniquí? Espera a que haya lienzo, mira qué parte cae dentro de la pantalla SIN
 * desplazarse, y comprueba que lo pintado no es un rectángulo liso: se hace una captura del
 * lienzo y se mide cuántos píxeles se apartan del color de fondo.
 */
async function maniqui(paso) {
  const t0 = Date.now();
  const lienzo = await p.waitForSelector('.figura canvas', { timeout: 15000 }).catch(() => null);
  if (!lienzo) { informe.push({ paso, visible: 'NO HAY LIENZO' }); return; }
  await p.waitForTimeout(700);
  const caja = await lienzo.boundingBox();
  const alto = p.viewportSize().height;
  const dentro = caja ? Math.max(0, Math.min(caja.y + caja.height, alto) - Math.max(caja.y, 0)) : 0;
  const pct = caja ? Math.round((dentro / caja.height) * 100) : 0;
  let pintado = 0;
  if (caja && dentro > 20) {
    const png = await p.screenshot({ clip: { x: caja.x, y: Math.max(caja.y, 0), width: caja.width, height: Math.min(dentro, caja.height) } });
    pintado = await p.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const [r0, g0, b0] = [d[0], d[1], d[2]];
      let distintos = 0;
      for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 40) distintos++;
      return Math.round((distintos / (d.length / 16)) * 100);
    }, png.toString('base64'));
  }
  const contextos = await p.locator('canvas').count();
  informe.push({ paso, arriba: Math.round(caja?.y ?? -1), enPantalla: `${pct}%`, pintado: `${pintado}%`, lienzos: contextos, ms: Date.now() - t0 });
  await p.screenshot({ path: `${S}/entreno/${String(informe.length).padStart(2, '0')}-${paso.replace(/[^a-z0-9]+/gi, '-')}.png` });
}

// 1. Del catálogo a varias fichas, tocando la tarjeta como con el dedo.
await p.goto(BASE); await p.waitForSelector('.tarjeta');
for (const nombre of ['Sentadilla trasera con barra', 'Press de banca con barra', 'Plancha frontal']) {
  await p.goto(BASE); await p.waitForSelector('.tarjeta');
  await p.locator('.tarjeta a', { hasText: nombre }).first().tap();
  await maniqui(`ficha ${nombre}`);
}
// 2. En una ficha, anotar y pasar al siguiente del grupo con los vecinos.
await p.goto(`${BASE}#/f/sentadilla-barra`); await p.waitForSelector('.anotar');
await p.fill('input[name=peso]', '60'); await p.fill('input[name=reps]', '8'); await p.locator('.anotar button[type=submit]').tap();
await p.locator('.vecinos a').last().tap();
await maniqui('ficha vecina tras anotar');
// 3. Rutina: empezar un día y recorrer sus ejercicios en «Hoy».
await p.goto(`${BASE}#/rutina/cuerpo-completo`); await p.waitForSelector('[data-empezar="0"]');
await p.locator('[data-empezar="0"]').tap();
await p.waitForSelector('.plan');
await maniqui('hoy al empezar el plan');
for (let i = 1; i < 4; i++) {
  await p.locator('.ejercicios-hoy a').nth(i).tap();
  await p.waitForTimeout(300);
  await maniqui(`hoy ejercicio ${i + 1} de la lista`);
}
// 4. Anotar en «Hoy» y abrir el siguiente con el descanso en marcha.
const reps = p.locator('.registro input[name=reps]');
if (await reps.count()) { await reps.fill('10'); await p.locator('.registro .anotar button[type=submit]').tap(); }
await p.locator('.ejercicios-hoy a').nth(4).tap();
await maniqui('hoy siguiente con descanso en marcha');
// 5. Añadir uno desde el selector.
await p.selectOption('[data-anadir]', 'dominadas');
await maniqui('hoy añadido desde el selector');
// 6. Diez fichas seguidas: ¿aguanta el contexto WebGL?
for (const id of ['remo-barra', 'curl-martillo', 'sentadilla-bulgara', 'peso-muerto-rumano', 'elevaciones-laterales', 'jalon-pecho', 'plancha-lateral', 'press-militar', 'zancada-inversa', 'puente-gluteo']) {
  await p.goto(`${BASE}#/f/${id}`);
  await maniqui(`seguidas ${id}`);
}

await nav.close();
console.table(informe);

// Mínimos: el lienzo entero en pantalla, algo pintado en él y uno solo.
const fallos = [
  ...errores.map((e) => `error en la página: ${e}`),
  ...informe.flatMap((r) => {
    if (r.visible) return [`${r.paso}: ${r.visible}`];
    const f = [];
    if (parseInt(r.enPantalla, 10) < 90) f.push(`${r.paso}: solo el ${r.enPantalla} del maniquí cae en pantalla al abrirlo`);
    // En blanco solo se puede decir de uno que se ve: fuera de pantalla no se ha podido mirar.
    else if (parseInt(r.pintado, 10) < 5) f.push(`${r.paso}: el maniquí sale en blanco (${r.pintado} de píxeles pintados)`);
    if (r.lienzos > 1) f.push(`${r.paso}: ${r.lienzos} lienzos vivos a la vez`);
    return f;
  }),
];
if (fallos.length) {
  console.log(`
✗ ${fallos.length} fallo(s):`);
  fallos.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log(`
✓ El maniquí se ve al abrir cada ejercicio: ${informe.length} de ${informe.length}, con un solo lienzo.`);
