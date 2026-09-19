#!/usr/bin/env node
/**
 * Valida el sistema de color contra WCAG 2.1 AA, en tema claro y oscuro.
 *
 *   node scripts/check-contraste.mjs             # informe, y salida 1 si algo falla
 *   node scripts/check-contraste.mjs --sugerir   # además propone el color más cercano que sí pasa
 *
 * POR QUÉ EXISTE. "El modo oscuro no es invertir colores" es fácil de decir y difícil de creerse
 * hasta que se mide: una paleta calibrada sobre papel, puesta sobre un fondo casi negro, falla
 * rutinariamente la mitad de las comprobaciones. Por eso cada familia declara DOS acentos y no uno,
 * el schema lo exige, y esto lo verifica antes de cada despliegue.
 *
 * La sugerencia mantiene tono y saturación y mueve solo la luminosidad hasta pasar con margen: un
 * acento corregido a ojo deja de parecerse a los demás de la paleta, y entonces el color ya no
 * orienta, solo decora.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const sugerir = process.argv.includes('--sugerir');
/** Margen deliberado sobre el mínimo, para que un retoque posterior no rompa el cumplimiento. */
const MARGEN = 0.3;

/* ------------------------------------------------------------------- color -- */

const hexARgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

const rgbAHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0').toUpperCase()).join('');

/** Luminancia relativa según WCAG 2.1. La linealización no es opcional: sin ella, el número miente. */
function luminancia(hex) {
  const [r, g, b] = hexARgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/* --- conversión a HSL, solo para sugerir moviendo la luminosidad y nada más --- */

function rgbAHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0))
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslARgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * El color más cercano que pasa, moviendo SOLO la luminosidad.
 *
 * Se busca en las dos direcciones y gana la que menos se aleje del original: sobre fondo claro
 * habrá que oscurecer y sobre fondo oscuro aclarar, pero eso depende del par y no conviene
 * suponerlo.
 */
function sugerencia(color, fondo, objetivo) {
  const [h, s, l0] = rgbAHsl(hexARgb(color));
  let mejor = null;
  for (const paso of [-0.005, 0.005]) {
    for (let i = 1; i <= 200; i++) {
      const l = l0 + paso * i;
      if (l < 0 || l > 1) break;
      const candidato = rgbAHex(hslARgb([h, s, l]));
      if (contraste(candidato, fondo) >= objetivo + MARGEN) {
        const distancia = Math.abs(l - l0);
        if (!mejor || distancia < mejor.distancia) mejor = { candidato, distancia };
        break;
      }
    }
  }
  return mejor?.candidato ?? null;
}

/* ------------------------------------------------------------ comprobaciones -- */

const tokens = JSON.parse(await readFile(join(RAIZ, 'design', 'tokens.json'), 'utf8'));
const reglas = JSON.parse(await readFile(join(RAIZ, 'content', 'reglas.json'), 'utf8'));

/*
 * De dónde salen los acentos. Por defecto, las familias del recorrido; una variante que agrupe de
 * otra forma —la app, por grupos— lo dice en reglas.json. Con el nombre escrito a fuego aquí, la
 * comprobación no fallaba en un proyecto sin familias.json: simplemente no comprobaba nada, que es
 * peor, porque el sitio se publicaba con acentos que no pasan AA y nadie se enteraba.
 */
const ACENTOS = reglas.acentos ?? { fichero: 'familias.json', lista: 'familias' };
const umbrales = tokens.umbrales_contraste;

const fallos = [];
let comprobadas = 0;

function comprobar(nombre, color, fondo, objetivo) {
  comprobadas += 1;
  const ratio = contraste(color, fondo);
  const pasa = ratio >= objetivo;
  const linea = `${pasa ? '✓' : '✗'} ${nombre.padEnd(46)} ${ratio.toFixed(2)}:1  (min ${objetivo})`;
  if (pasa) { console.log(`  ${linea}`); return; }

  let extra = '';
  if (sugerir) {
    const propuesta = sugerencia(color, fondo, objetivo);
    extra = propuesta ? `  → prueba ${propuesta} (${contraste(propuesta, fondo).toFixed(2)}:1)` : '  → sin salida moviendo solo la luminosidad';
  }
  console.log(`  ${linea}${extra}`);
  fallos.push(`${nombre}: ${ratio.toFixed(2)}:1, mínimo ${objetivo}`);
}

for (const [nombreTema, tema] of Object.entries(tokens.temas)) {
  if (nombreTema.startsWith('$')) continue;
  console.log(`\nTema ${nombreTema}`);

  const fondos = {
    fondo: tema.fondo,
    elevado: tema.fondo_elevado,
    hundido: tema.fondo_hundido,
  };

  // Texto sobre los tres fondos. `separador` queda fuera a propósito: es una línea decorativa, y
  // WCAG 1.4.11 solo exige 3:1 cuando el borde es el ÚNICO indicador del componente.
  for (const [nf, fondo] of Object.entries(fondos)) {
    comprobar(`texto sobre ${nf}`, tema.texto, fondo, umbrales.texto_normal);
    comprobar(`texto_secundario sobre ${nf}`, tema.texto_secundario, fondo, umbrales.texto_normal);
    // El enlace también como texto normal: es texto que se lee, no un adorno, y suele salir en
    // párrafos y en listas de fuentes donde el tamaño es pequeño.
    if (tema.enlace) comprobar(`enlace sobre ${nf}`, tema.enlace, fondo, umbrales.texto_normal);
  }
  comprobar('borde_interactivo sobre fondo', tema.borde_interactivo, tema.fondo, umbrales.elemento_ui);
  comprobar('borde_interactivo sobre elevado', tema.borde_interactivo, tema.fondo_elevado, umbrales.elemento_ui);
  comprobar('foco sobre fondo', tema.foco, tema.fondo, umbrales.elemento_ui);

  // Los acentos de cada familia, en los tres fondos. Se les exige contraste de texto normal aunque
  // se usen como etiqueta: en la práctica acaban en texto pequeño, y ahí 3:1 no basta.
  for (const idioma of reglas.idiomas ?? ['es']) {
    const ruta = join(RAIZ, 'content', idioma, ACENTOS.fichero);
    if (!existsSync(ruta)) continue;
    const { [ACENTOS.lista]: familias } = JSON.parse(await readFile(ruta, 'utf8'));
    for (const familia of familias) {
      const acento = familia.color_acento?.[nombreTema];
      if (!acento) continue;
      for (const [nf, fondo] of Object.entries(fondos)) {
        comprobar(`acento "${familia.id}" sobre ${nf}`, acento, fondo, umbrales.texto_normal);
      }
    }
    break; // Los colores no dependen del idioma; con el primero basta.
  }
}

/* ---------------------------------------------- separación de tono entre familias -- */

// Dos familias con acentos casi iguales no se distinguen, y un color que no orienta solo decora.
const SEPARACION_MINIMA = 15;
for (const idioma of reglas.idiomas ?? ['es']) {
  const ruta = join(RAIZ, 'content', idioma, ACENTOS.fichero);
  if (!existsSync(ruta)) break;
  const { [ACENTOS.lista]: familias } = JSON.parse(await readFile(ruta, 'utf8'));
  const tonos = familias.map((f) => ({ id: f.id, tono: rgbAHsl(hexARgb(f.color_acento.claro))[0] }));
  for (let i = 0; i < tonos.length; i++) {
    for (let j = i + 1; j < tonos.length; j++) {
      const d = Math.abs(tonos[i].tono - tonos[j].tono);
      const separacion = Math.min(d, 360 - d);
      if (separacion < SEPARACION_MINIMA) {
        fallos.push(
          `acentos de "${tonos[i].id}" y "${tonos[j].id}" separados ${separacion.toFixed(0)}° ` +
          `(mínimo ${SEPARACION_MINIMA}°): no se distinguen`,
        );
      }
    }
  }
  break;
}

/* ------------------------------------------------------------------ informe -- */

if (fallos.length) {
  console.error(`\n${fallos.length} de ${comprobadas} comprobaciones no pasan:\n`);
  for (const f of fallos) console.error(`  ✗ ${f}`);
  console.error(sugerir ? '' : '\nEjecuta con --sugerir para ver colores que sí pasan.\n');
  process.exit(1);
}

console.log(`\n✓ ${comprobadas}/${comprobadas} en WCAG AA, en los dos temas.\n`);
