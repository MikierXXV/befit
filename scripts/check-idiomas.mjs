#!/usr/bin/env node
/**
 * Ningún texto visible escrito dentro del código.
 *
 * POR QUÉ EXISTE ESTA COMPROBACIÓN. Es el fallo que más veces se cuela y el que más tarde se
 * descubre: el sitio se desarrolla en español, así que un literal en español no le llama la
 * atención a nadie. Se descubre el día que alguien abre la versión inglesa y encuentra media
 * docena de piezas hablando en castellano. No es un descuido que se corrija recordándolo —quien
 * está arreglando los literales de ayer escribe otros nuevos el mismo día—: es una regla que
 * necesita quien la vigile, y por eso bloquea el despliegue.
 *
 * QUÉ BUSCA. Literales con pinta de frase en español dentro de src/. Se saltan a propósito:
 *   · los comentarios, que están en español adrede y son para quien lee el código;
 *   · `throw new Error(...)`, que lo ve quien desarrolla y nunca el visitante;
 *   · `console.*(...)`, por lo mismo.
 *
 * NO ENUMERA CONTEXTOS. La primera versión de esto miraba dónde podía acabar un texto en pantalla
 * —textContent, aria-label, los rótulos— y se le escapó un Record<Estado, string> que llegaba a la
 * pantalla por un camino que no estaba en la lista. Enumerar caminos es perder: siempre queda uno.
 * Lo que sí se puede acotar es el idioma.
 *
 * Se ejecuta sin dependencias, como el resto de comprobaciones.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTORIO = join(RAIZ, 'src');

/** Caracteres que no aparecen en inglés y delatan una cadena redactada en español. */
const DELATORES = /[áéíóúñÁÉÍÓÚÑ¿¡«»]/;

/** Palabras españolas frecuentes sin acento. Sin esto se escapan cadenas como «Poner en». */
const PALABRAS = /\b(el|la|los|las|un|una|de|del|que|con|sin|por|para|se|su|sus|al|en|es|no|mas|como|desde|hasta|entre|sobre|cada|todo|toda|todos|todas|nada|algo|poner|retirar|quitar|volver|mostrar|cerrar|abrir|pulsar|seguir|siguiente|paso|pasos|vez|veces|ver|hacer|dejar|queda|quedan|mismo|misma|otro|otra|hay|son|esta|este|esto|sigue|falta|faltan)\b/i;

/**
 * Morfología española: participios, gerundios y sufijos que el inglés no tiene.
 *
 * Hace falta porque una lista de palabras es una carrera perdida. El caso real fue un rótulo
 * `${nombre}: aplicado` que llevaba meses saliendo en castellano en la versión inglesa: no tiene
 * acentos y «aplicado» no estaba en ninguna lista. Enumerar cada palabra que a alguien se le pueda
 * ocurrir no funciona; reconocer la terminación sí.
 */
const MORFOLOGIA = /\b\w{4,}(ados?|adas?|idos?|idas?|ando|endo|cion|ciones|mente|isimo)\b/i;

const LITERALES = /([`'"])((?:\\.|(?!\1).)*)\1/g;

/** Quita `${…}` contando llaves, para que una interpolación con llaves dentro no deje restos. */
function sinInterpolaciones(texto) {
  let salida = '';
  for (let n = 0; n < texto.length; n += 1) {
    if (texto[n] === '$' && texto[n + 1] === '{') {
      let profundidad = 1;
      n += 2;
      while (n < texto.length && profundidad > 0) {
        if (texto[n] === '{') profundidad += 1;
        if (texto[n] === '}') profundidad -= 1;
        n += 1;
      }
      n -= 1;
      salida += ' ';
    } else {
      salida += texto[n];
    }
  }
  return salida;
}

/**
 * Quita lo que sí puede estar en español. Ver la cabecera.
 *
 * Se sustituye por espacios y no se borra, para que los números de línea no se desplacen: un aviso
 * que apunta a la línea equivocada obliga a buscar a mano y acaba ignorándose.
 */
function limpiar(fuente) {
  const enBlanco = (t) => t.replace(/[^\n]/g, ' ');
  return fuente
    /*
     * El valor de `class="…"` nunca es texto visible: son nombres de clase, y varios están en
     * español porque el proyecto entero lo está. Sin esto, `class="volver boton"` se marcaba como
     * una frase, y la única salida era renombrar clases para contentar al guion.
     */
    .replace(/\bclass(Name)?="[^"]*"/g, enBlanco)
    .replace(/\/\*[\s\S]*?\*\//g, enBlanco)
    .replace(/^[ \t]*\/\/.*$/gm, enBlanco)
    .replace(/throw new Error\((?:[^()]|\([^()]*\))*\)/g, enBlanco)
    .replace(/console\.\w+\((?:[^()]|\([^()]*\))*\)/g, enBlanco);
}

/**
 * Decide si un literal parece una frase en español.
 *
 * El umbral de dos palabras evita los falsos positivos que hacen que una comprobación se acabe
 * desactivando: `'es'` como código de idioma, `'claro'` como nombre de tema, `'middle'` como valor
 * de un atributo SVG. Una palabra suelta solo se marca si su terminación la delata sin ambigüedad.
 */
function pareceEspanol(bruto) {
  // Lo interpolado es una expresión, no texto. Se quita CONTANDO LLAVES: con un `[^}]*` se corta en
  // la primera llave que aparezca, y una interpolación con una función dentro —`${xs.map((x) => …)}`—
  // deja medio trozo de código suelto que después se marca como si fuera una frase en español.
  const texto = sinInterpolaciones(bruto).trim();
  if (texto.length < 4) return false;
  if (DELATORES.test(texto)) return true;

  // Identificadores —clases CSS, claves, nombres de atributo— no son texto visible. Se reconocen
  // por lo que ninguna frase tiene: sin espacios y con guion, guion bajo o mayúscula interior.
  // Sin esta línea, `"vis-resolucion"` y `"descripcion-familia"` salen marcados, y una comprobación
  // que marca lo que no debe acaba desactivada, que es peor que no tenerla.
  if (!/\s/.test(texto) && /[-_.]|[a-z][A-Z]/.test(texto)) return false;

  // Trozos de marcado o de CSS: un atributo a medias (`style="--proporcion-lienzo: `) o una
  // propiedad personalizada no son texto visible, y sus nombres en español disparaban la morfología.
  if (/="/.test(texto) || texto.trimStart().startsWith('--')) return false;

  // Una palabra suelta, toda en minúsculas y sin acentos, es un identificador: una clave de objeto o
  // un valor de unión ("rotacion", "abduccion"). El texto visible en español lleva acentos, empieza
  // por mayúscula o tiene más de una palabra; marcar lo demás es ruido, y una comprobación ruidosa
  // se acaba desactivando entera, con lo que deja de vigilar también lo que sí importa.
  if (!/\s/.test(texto) && texto === texto.toLowerCase()) return false;

  const palabras = texto.split(/\s+/).filter(Boolean);
  if (palabras.length >= 2 && (PALABRAS.test(texto) || MORFOLOGIA.test(texto))) return true;
  if (palabras.length === 1 && MORFOLOGIA.test(texto)) return true;
  return false;
}

async function ficheros(dir) {
  const salida = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...(await ficheros(ruta)));
    else if (/\.(ts|tsx|js|mjs)$/.test(entrada.name)) salida.push(ruta);
  }
  return salida;
}

const hallazgos = [];

for (const ruta of await ficheros(DIRECTORIO)) {
  const fuente = limpiar(await readFile(ruta, 'utf8'));

  for (const linea of fuente.split('\n').entries()) {
    const [n, contenido] = linea;
    // Los import traen rutas, no texto.
    if (/^\s*(import|export)\s/.test(contenido)) continue;

    for (const m of contenido.matchAll(LITERALES)) {
      const texto = m[2];
      if (pareceEspanol(texto)) {
        hallazgos.push({ fichero: relative(RAIZ, ruta), linea: n + 1, texto });
      }
    }
  }
}

/*
 * LAS ETAPAS DEL MOVIMIENTO, TRADUCIDAS EN LOS DOS IDIOMAS.
 *
 * Los movimientos son comunes a todos los idiomas, así que sus etiquetas son CLAVES, y la ficha las
 * pinta con `t('figura.etapas.<etiqueta>')`. Una etiqueta sin traducir no rompe nada: `t()` devuelve
 * la clave, y en la línea de tiempo aparece "FIGURA.ETAPAS.PECHO A LA BARRA" pisando al rótulo de al
 * lado. Solo avisa por `console.warn`, que ninguna comprobación miraba.
 *
 * El comentario de ui.json ya prometía que "el validador de idiomas lo caza". No lo cazaba: cinco
 * etiquetas llevaban sin traducir hasta que se vieron en pantalla. Ahora sí.
 */
const faltantes = [];
{
  const dirMov = join(RAIZ, 'content/movimientos');
  const etiquetas = new Set();
  for (const f of await readdir(dirMov)) {
    if (!f.endsWith('.json')) continue;
    const mov = JSON.parse(await readFile(join(dirMov, f), 'utf8'));
    for (const pose of mov.poses ?? []) if (pose.etiqueta) etiquetas.add(pose.etiqueta);
  }

  const idiomas = JSON.parse(await readFile(join(RAIZ, 'content/reglas.json'), 'utf8')).idiomas ?? ['es'];
  for (const idioma of idiomas) {
    const ui = JSON.parse(await readFile(join(RAIZ, `content/${idioma}/ui.json`), 'utf8'));
    const traducidas = ui.figura?.etapas ?? {};
    for (const etiqueta of etiquetas) {
      if (typeof traducidas[etiqueta] !== 'string') faltantes.push(`[${idioma}] figura.etapas.${etiqueta}`);
    }
  }
}

/*
 * LOS VALORES DEL CATÁLOGO, TRADUCIDOS: material, nivel y músculos.
 *
 * Las fichas guardan valores cortos (`mancuerna`, `ninguno`) y la pantalla los nombra con
 * `catalogo.<campo>.<valor>` de ui.json. Si falta la clave, `etiqueta()` enseña el valor en crudo:
 * pasó con `ninguno`, que ocho ejercicios nuevos usaban sin traducción, y en el filtro y en la
 * ficha salía «ninguno» en minúscula, también en la versión inglesa. Ninguna comprobación lo vio,
 * porque solo quedaba un `console.warn`.
 */
{
  const idiomas = JSON.parse(await readFile(join(RAIZ, 'content/reglas.json'), 'utf8')).idiomas ?? ['es'];
  for (const idioma of idiomas) {
    const ui = JSON.parse(await readFile(join(RAIZ, `content/${idioma}/ui.json`), 'utf8'));
    const dirFichas = join(RAIZ, `content/${idioma}/fichas`);
    const usados = { material: new Set(), nivel: new Set(), musculos: new Set() };
    for (const f of await readdir(dirFichas)) {
      if (!f.endsWith('.json')) continue;
      const ficha = JSON.parse(await readFile(join(dirFichas, f), 'utf8'));
      (ficha.material ?? []).forEach((v) => usados.material.add(v));
      if (ficha.nivel) usados.nivel.add(ficha.nivel);
      Object.values(ficha.musculos ?? {}).flat().forEach((v) => usados.musculos.add(v));
    }
    for (const [campo, valores] of Object.entries(usados)) {
      for (const valor of valores) {
        if (typeof ui.catalogo?.[campo]?.[valor] !== 'string') faltantes.push(`[${idioma}] catalogo.${campo}.${valor}`);
      }
    }
  }
}

if (faltantes.length) {
  console.error(`\n${faltantes.length} texto(s) de interfaz sin traducir:\n`);
  for (const f of faltantes) console.error(`  ✗ ${f}`);
  console.error('\nSin traducción, la pantalla enseña la clave o el valor en crudo.');
  console.error('Añádelas en content/<idioma>/ui.json con la ruta indicada. Las etapas, cortas: el rótulo va sobre la línea.\n');
  process.exit(1);
}

if (hallazgos.length) {
  console.error(`\n${hallazgos.length} literal(es) con texto visible dentro del código:\n`);
  for (const h of hallazgos) {
    console.error(`  ✗ ${h.fichero}:${h.linea}`);
    console.error(`      "${h.texto}"`);
  }
  console.error(
    '\nEl texto visible pertenece al contenido. Muévelo a content/<idioma>/ui.json y léelo con t(),' +
    '\no pásalo desde la ficha en `parametros` / `textos` si es de una visualización.\n',
  );
  process.exit(1);
}

console.log('\n✓ Ningún texto visible escrito dentro del código.\n');
