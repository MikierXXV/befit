#!/usr/bin/env node
/**
 * Validación de la capa de contenido. Sin dependencias, pensado para correr en CI antes del build.
 *
 *   node scripts/validar-contenido.mjs             # avisa de lo incompleto, falla por lo inválido
 *   node scripts/validar-contenido.mjs --completo  # además exige que no falte nada. Es lo que corre CI.
 *
 * ESTE GUION ES GENÉRICO: no sabe nada del tema del sitio. Todo lo que comprueba lo lee de
 * content/reglas.json y de los schemas. Adaptarlo a un proyecto nuevo es editar aquel fichero, no
 * este. Lo que comprueba:
 *
 *   1. Forma de cada ficha contra su schema.
 *   2. Unicidad de ids dentro de cada colección.
 *   3. Integridad referencial en LOS DOS SENTIDOS (huérfanos y familias vacías).
 *   4. Orden contiguo dentro de cada grupo: 1..n, sin huecos ni repetidos.
 *   5. Límites de longitud editoriales.
 *   6. Citas breves con atribución declarada.
 *   7. Que toda mecánica declarada exista en src/vis/registro.ts, y el presupuesto de escenas 3D.
 *   8. Que todo efecto de escenografía exista en src/app/efectos.ts, y su presupuesto.
 *   9. Paridad entre idiomas: mismos ids y mismas claves de interfaz.
 *
 * La distinción entre error y aviso importa: durante la redacción, una ficha a medias es un aviso.
 * Si fuera un error, cada ejecución escupiría decenas de líneas idénticas y el guion dejaría de
 * servir para encontrar los problemas de verdad. En CI se pasa --completo y entonces sí falla.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENIDO = join(RAIZ, 'content');
const EXIGIR_COMPLETO = process.argv.includes('--completo');

const errores = [];
const avisos = [];
const error = (msg) => errores.push(msg);
const aviso = (msg) => (EXIGIR_COMPLETO ? errores : avisos).push(msg);

/**
 * Lee una ficha.
 *
 * Se quita la marca de orden de bytes y se atrapa el error de sintaxis a propósito. Los dos casos
 * son el mismo defecto visto de dos formas: un editor de Windows guarda el JSON con BOM —o alguien
 * se deja una coma—, `JSON.parse` revienta con un volcado de pila, y lo que el autor del contenido
 * lee es un error de Node que no menciona su fichero por ningún sitio. Con el nombre delante se
 * arregla en diez segundos; sin él, parece que se ha roto la plantilla.
 */
const leerJson = async (ruta) => {
  const bruto = (await readFile(ruta, 'utf8')).replace(/^﻿/, '');
  try {
    return JSON.parse(bruto);
  } catch (e) {
    throw new Error(`${relative(RAIZ, ruta)} no es JSON válido: ${e.message}`);
  }
};

/* ------------------------------------------------------- validador de schema -- */

/**
 * Subconjunto de JSON Schema: type, required, properties, additionalProperties, enum, minLength,
 * maxLength, minimum, maximum, pattern, items.
 *
 * Es a propósito un subconjunto y no una biblioteca. Estas son las restricciones que de verdad se
 * usan en una capa de contenido, caben en sesenta líneas, y mantienen la promesa de que las
 * comprobaciones corren sin instalar nada. El día que haga falta `allOf` o `$ref`, ese día se trae
 * ajv; no antes.
 */
function validarSchema(dato, schema, ruta = '') {
  const fallos = [];
  const donde = ruta || '(raíz)';

  if (schema.type) {
    const tipos = {
      string: (v) => typeof v === 'string',
      number: (v) => typeof v === 'number',
      integer: (v) => Number.isInteger(v),
      boolean: (v) => typeof v === 'boolean',
      array: (v) => Array.isArray(v),
      object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    };
    if (!tipos[schema.type]?.(dato)) {
      fallos.push(`${donde}: se esperaba ${schema.type}`);
      return fallos; // Sin el tipo correcto, el resto de comprobaciones no dice nada útil.
    }
  }

  if (schema.enum && !schema.enum.includes(dato)) {
    fallos.push(`${donde}: "${dato}" no está entre ${schema.enum.join(', ')}`);
  }
  if (typeof dato === 'string') {
    if (schema.minLength !== undefined && dato.length < schema.minLength) {
      fallos.push(`${donde}: ${dato.length} caracteres, mínimo ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && dato.length > schema.maxLength) {
      fallos.push(`${donde}: ${dato.length} caracteres, máximo ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(dato)) {
      fallos.push(`${donde}: "${dato}" no cumple el patrón ${schema.pattern}`);
    }
  }
  if (typeof dato === 'number') {
    if (schema.minimum !== undefined && dato < schema.minimum) fallos.push(`${donde}: mínimo ${schema.minimum}`);
    if (schema.maximum !== undefined && dato > schema.maximum) fallos.push(`${donde}: máximo ${schema.maximum}`);
  }

  if (schema.type === 'object' || schema.properties) {
    for (const req of schema.required ?? []) {
      if (dato[req] === undefined) fallos.push(`${donde}: falta el campo obligatorio "${req}"`);
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const clave of Object.keys(dato)) {
        // Las claves que empiezan por $ son notas para quien lee el fichero, nunca datos.
        if (clave.startsWith('$')) continue;
        if (!(clave in schema.properties)) fallos.push(`${donde}: campo no reconocido "${clave}"`);
      }
    }
    for (const [clave, sub] of Object.entries(schema.properties ?? {})) {
      if (dato[clave] !== undefined) {
        fallos.push(...validarSchema(dato[clave], sub, ruta ? `${ruta}.${clave}` : clave));
      }
    }
  }

  if (Array.isArray(dato) && schema.items) {
    dato.forEach((v, i) => fallos.push(...validarSchema(v, schema.items, `${donde}[${i}]`)));
  }

  return fallos;
}

/* -------------------------------------------------------------- carga de datos -- */

const reglas = await leerJson(join(CONTENIDO, 'reglas.json'));
const IDIOMAS = reglas.idiomas ?? ['es'];

async function cargarColeccion(idioma, nombre, def) {
  const base = join(CONTENIDO, idioma);
  if (def.fichero) {
    const ruta = join(base, def.fichero);
    if (!existsSync(ruta)) {
      error(`[${idioma}] falta content/${idioma}/${def.fichero}`);
      return [];
    }
    const doc = await leerJson(ruta);
    const lista = def.lista ? doc[def.lista] : doc;
    if (!Array.isArray(lista)) {
      error(`[${idioma}] ${def.fichero}: se esperaba una lista en "${def.lista ?? '(raíz)'}"`);
      return [];
    }
    return lista.map((datos, i) => ({ datos, origen: `${def.fichero}[${i}]` }));
  }

  const dir = join(base, def.directorio);
  if (!existsSync(dir)) {
    error(`[${idioma}] falta el directorio content/${idioma}/${def.directorio}/`);
    return [];
  }
  const ficheros = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(
    ficheros.map(async (f) => ({ datos: await leerJson(join(dir, f)), origen: `${def.directorio}/${f}` })),
  );
}

/**
 * Fichas de una colección, o un error que se entiende.
 *
 * Existe porque una regla puede nombrar una colección que no existe —al adaptar reglas.json a un
 * proyecto nuevo, o al aplicar una variante de la plantilla— y sin esto el guion reventaba con
 * "datos[idioma][coleccion] is not iterable", que no dice ni qué regla ni qué colección.
 */
function fichasDe(idioma, coleccion, regla) {
  const lista = datos[idioma]?.[coleccion];
  if (!lista) {
    error(`reglas.json → ${regla} nombra la colección "${coleccion}", que no está en "colecciones"`);
    return [];
  }
  return lista;
}

/** { idioma: { coleccion: [{datos, origen}] } } */
const datos = {};
for (const idioma of IDIOMAS) {
  datos[idioma] = {};
  for (const [nombre, def] of Object.entries(reglas.colecciones)) {
    datos[idioma][nombre] = await cargarColeccion(idioma, nombre, def);
  }
}

/* --------------------------------------------------------- 1. forma y unicidad -- */

for (const [nombre, def] of Object.entries(reglas.colecciones)) {
  const schema = def.schema ? await leerJson(join(CONTENIDO, 'schema', def.schema)) : null;

  for (const idioma of IDIOMAS) {
    const vistos = new Map();

    for (const { datos: d, origen } of datos[idioma][nombre]) {
      if (schema) {
        for (const fallo of validarSchema(d, schema)) error(`[${idioma}] ${origen} → ${fallo}`);
      }
      if (d.id === undefined) continue; // Ya lo ha dicho el schema; no repetirlo.
      if (vistos.has(d.id)) {
        error(`[${idioma}] id duplicado "${d.id}": ${vistos.get(d.id)} y ${origen}`);
      }
      vistos.set(d.id, origen);
    }
  }
}

const idsDe = (idioma, coleccion) => new Set(fichasDe(idioma, coleccion, 'referencias').map((e) => e.datos.id));

/* ---------------------------------------------- 2. integridad referencial (x2) -- */

for (const ref of reglas.referencias ?? []) {
  for (const idioma of IDIOMAS) {
    const destino = idsDe(idioma, ref.a);
    const usados = new Set();

    for (const { datos: d, origen } of fichasDe(idioma, ref.de, 'referencias')) {
      const valor = d[ref.campo];
      if (valor === undefined) continue;
      if (!destino.has(valor)) {
        error(`[${idioma}] ${origen} → ${ref.campo}: "${valor}" no existe en ${ref.a}`);
      }
      usados.add(valor);
    }

    // El otro sentido. Una familia sin piezas no rompe nada visible, y por eso pasa: sale en el
    // recorrido como una parada en blanco que nadie se explica.
    if (ref.exigir_uso) {
      for (const id of destino) {
        if (!usados.has(id)) aviso(`[${idioma}] ${ref.a}/"${id}" no lo usa ninguna ${ref.de}`);
      }
    }
  }
}

/* -------------------------------------------------------------- 3. orden sin huecos -- */

for (const regla of reglas.orden ?? []) {
  for (const idioma of IDIOMAS) {
    const grupos = new Map();
    for (const { datos: d, origen } of fichasDe(idioma, regla.coleccion, 'orden')) {
      const grupo = regla.agrupado_por ? d[regla.agrupado_por] : '(único)';
      if (!grupos.has(grupo)) grupos.set(grupo, []);
      grupos.get(grupo).push({ valor: d[regla.campo], origen });
    }

    for (const [grupo, entradas] of grupos) {
      const valores = entradas.map((e) => e.valor).sort((a, b) => a - b);
      valores.forEach((v, i) => {
        if (v !== i + 1) {
          error(
            `[${idioma}] ${regla.coleccion} de "${grupo}": ${regla.campo} debería ser 1..${valores.length}` +
            ` y es ${valores.join(', ')}`,
          );
        }
      });
    }
  }
}

/* ------------------------------------------------------------- 4. longitudes -- */

for (const [coleccion, campos] of Object.entries(reglas.longitudes ?? {})) {
  for (const idioma of IDIOMAS) {
    for (const { datos: d, origen } of fichasDe(idioma, coleccion, 'longitudes')) {
      for (const [campo, [min, max]] of Object.entries(campos)) {
        const texto = d[campo];
        if (texto === undefined) continue;
        const n = texto.length;
        if (n < min || n > max) {
          error(`[${idioma}] ${origen} → ${campo}: ${n} caracteres, se esperaban entre ${min} y ${max}`);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ 5. citas -- */

if (reglas.citas) {
  const { coleccion, campo, max_palabras, atribuciones } = reglas.citas;
  for (const idioma of IDIOMAS) {
    for (const { datos: d, origen } of fichasDe(idioma, coleccion, 'citas')) {
      const cita = d[campo];
      if (!cita) continue;
      const palabras = String(cita.texto ?? '').trim().split(/\s+/).filter(Boolean).length;
      if (palabras > max_palabras) {
        error(`[${idioma}] ${origen} → cita de ${palabras} palabras, máximo ${max_palabras}`);
      }
      if (atribuciones && !atribuciones.includes(cita.atribucion)) {
        error(`[${idioma}] ${origen} → atribución "${cita.atribucion}" no reconocida`);
      }
    }
  }
}

/* ---------------------------------------------------- 6. visualización y 3D -- */

if (reglas.visualizacion) {
  const v = reglas.visualizacion;

  // Las mecánicas se LEEN del registro en vez de duplicar la lista aquí. Duplicarla es exactamente
  // cómo se desincroniza: se añade una mecánica, se olvida el validador, y este da un falso error.
  let mecanicasDisponibles = null;
  let propias = null;
  const rutaRegistro = join(RAIZ, v.registro);
  if (existsSync(rutaRegistro)) {
    const fuente = await readFile(rutaRegistro, 'utf8');
    const bloque = (nombre) => {
      const i = fuente.indexOf(`const ${nombre}`);
      if (i === -1) return new Set();
      const fin = fuente.indexOf('\n};', i);
      const trozo = fuente.slice(i, fin === -1 ? undefined : fin);
      return new Set([...trozo.matchAll(/^\s{2}'?([a-z0-9-]+)'?:\s*async/gm)].map((m) => m[1]));
    };
    mecanicasDisponibles = bloque('MECANICAS');
    propias = bloque('PROPIAS');
  } else {
    error(`no encuentro ${v.registro}, declarado en reglas.json`);
  }

  for (const idioma of IDIOMAS) {
    let escenas3d = 0;

    for (const { datos: d, origen } of fichasDe(idioma, v.coleccion, 'visualizacion')) {
      const vis = d[v.campo];
      if (!vis) {
        aviso(`[${idioma}] ${origen} → todavía sin visualización`);
        continue;
      }

      if (v.tecnicas && !v.tecnicas.includes(vis.tecnica)) {
        error(`[${idioma}] ${origen} → técnica "${vis.tecnica}" no reconocida`);
      }

      const tienePropia = propias?.has(d.id);
      if (!tienePropia) {
        if (!vis.mecanica) {
          error(`[${idioma}] ${origen} → sin mecánica y sin pieza propia en el registro`);
        } else if (mecanicasDisponibles && !mecanicasDisponibles.has(vis.mecanica)) {
          error(`[${idioma}] ${origen} → mecánica "${vis.mecanica}" no existe en ${v.registro}`);
        }
      }

      if (vis.tecnica === '3d') {
        escenas3d += 1;
        if (v.exige_justificacion_3d && !vis.justificacion_3d) {
          error(
            `[${idioma}] ${origen} → escena 3D sin justificacion_3d. Hay que decir por qué NO se ` +
            `entiende en 2D; si no se sabe decir, la pieza no necesita 3D.`,
          );
        }
      }
    }

    if (v.presupuesto_3d !== undefined && escenas3d > v.presupuesto_3d) {
      error(`[${idioma}] ${escenas3d} escenas 3D, presupuesto ${v.presupuesto_3d}`);
    }
  }
}

/* --------------------------------------------------------- 7. escenografía -- */

if (reglas.escenografia) {
  const e = reglas.escenografia;

  /*
   * Los efectos válidos se LEEN del registro, igual que las mecánicas. Copiar la lista aquí —o
   * ponerla como `enum` en el schema— es tener dos verdades: se añade un efecto, se olvida una de
   * las copias, y el validador rechaza contenido correcto. Un validador que se equivoca se acaba
   * desactivando, y entonces ya no valida nada.
   */
  const listas = {};
  const rutaEfectos = join(RAIZ, e.registro);
  if (existsSync(rutaEfectos)) {
    const fuente = await readFile(rutaEfectos, 'utf8');
    // La anotación de tipo es opcional en la captura porque algunas listas la llevan
    // (`: readonly Escena[]`) y otras no. Sin contemplarla, esas listas no se leían y la
    // comprobación pasaba en vacío sin decir nada.
    for (const m of fuente.matchAll(/export const ([A-Z_]+)\s*(?::[^=]+)?=\s*\[([^\]]*)\]/g)) {
      listas[m[1]] = new Set([...m[2].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]));
    }
  } else {
    error(`no encuentro ${e.registro}, declarado en reglas.json`);
  }

  // Si el registro existe pero no se le ha podido sacar ninguna lista, algo ha cambiado de forma y
  // la comprobación estaría pasando en vacío, que es peor que fallar: hay que enterarse.
  if (existsSync(rutaEfectos) && Object.keys(listas).length === 0) {
    error(`${e.registro} no expone ninguna lista de efectos con la forma "export const X = [...]"`);
  }

  const comprobar = (lista, valor, campo, origen, idioma) => {
    if (valor === undefined) return;
    const validos = listas[lista];
    if (!validos) return;
    if (!validos.has(valor)) {
      error(
        `[${idioma}] ${origen} → ${campo}: "${valor}" no está en ${lista} de ${e.registro}. ` +
        `Disponibles: ${[...validos].join(', ')}`,
      );
    }
  };

  for (const idioma of IDIOMAS) {
    let conAvance = 0;
    const escenaDe = new Map();

    for (const { datos: d, origen } of datos[idioma].familias ?? []) {
      const escena = d.escena;
      if (!escena) continue;

      comprobar('ESCENAS', escena.tipo, 'escena.tipo', origen, idioma);
      comprobar('TONOS', escena.tono, 'escena.tono', origen, idioma);
      comprobar('VELOS', escena.velo, 'escena.velo', origen, idioma);
      comprobar('ENTRADAS', escena.entrada, 'escena.entrada', origen, idioma);

      escenaDe.set(d.id, escena.tipo ?? 'normal');
      if (listas.ESCENAS_CON_AVANCE?.has(escena.tipo)) conAvance += 1;

      // Capas fuera de una portada: no es un error del navegador, es una decoración que se pinta y
      // no se mueve nunca, porque solo las escenas con avance publican el número que las desplaza.
      if (escena.capas?.length && escena.tipo !== 'cubierta') {
        error(`[${idioma}] ${origen} → declara capas con escena.tipo "${escena.tipo ?? 'normal'}"; las capas solo se mueven en "cubierta"`);
      }
    }

    for (const { datos: d, origen } of datos[idioma].piezas ?? []) {
      comprobar('ENTRADAS', d.entrada, 'entrada', origen, idioma);

      if (e.franja_sin_3d && d.visualizacion?.tecnica === '3d' && escenaDe.get(d.familia_id) === 'franja') {
        error(
          `[${idioma}] ${origen} → escena 3D dentro de una familia con escena "franja". Las piezas ` +
          `de una franja entran y salen de pantalla al deslizarla, así que la escena se montaría y ` +
          `se destruiría en bucle. O la familia no es una franja, o la pieza no es 3D.`,
        );
      }
    }

    if (e.presupuesto_avance !== undefined && conAvance > e.presupuesto_avance) {
      error(`[${idioma}] ${conAvance} paradas con escena que trabaja en cada fotograma, presupuesto ${e.presupuesto_avance}`);
    }
  }
}

/* --------------------------------------------------- 8. paridad entre idiomas -- */

if (reglas.paridad_idiomas && IDIOMAS.length > 1) {
  const [base, ...resto] = IDIOMAS;

  for (const nombre of Object.keys(reglas.colecciones)) {
    const idsBase = idsDe(base, nombre);
    for (const idioma of resto) {
      const otros = idsDe(idioma, nombre);
      for (const id of idsBase) if (!otros.has(id)) error(`[${idioma}] falta ${nombre}/"${id}" (está en ${base})`);
      for (const id of otros) if (!idsBase.has(id)) error(`[${base}] falta ${nombre}/"${id}" (está en ${idioma})`);
    }
  }

  // Y las claves de interfaz, que es donde una traducción incompleta se nota en pantalla.
  const clavesDe = (obj, prefijo = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      k.startsWith('$') ? [] : typeof v === 'object' && v !== null
        ? clavesDe(v, `${prefijo}${k}.`)
        : [`${prefijo}${k}`]);

  const uiBase = clavesDe(await leerJson(join(CONTENIDO, base, 'ui.json')));
  for (const idioma of resto) {
    const ruta = join(CONTENIDO, idioma, 'ui.json');
    if (!existsSync(ruta)) { error(`[${idioma}] falta ui.json`); continue; }
    const otras = clavesDe(await leerJson(ruta));
    for (const c of uiBase) if (!otras.includes(c)) error(`[${idioma}] ui.json: falta la clave "${c}"`);
    for (const c of otras) if (!uiBase.includes(c)) error(`[${base}] ui.json: falta la clave "${c}"`);
  }
}

/* ------------------------------------------------------------------ informe -- */

const total = Object.values(datos[IDIOMAS[0]]).reduce((n, c) => n + c.length, 0);

if (avisos.length) {
  console.log(`\nAvisos (${avisos.length}):`);
  for (const a of avisos) console.log(`  · ${a}`);
}

if (errores.length) {
  console.error(`\nErrores (${errores.length}):`);
  for (const e of errores) console.error(`  ✗ ${e}`);
  console.error(`\nContenido NO válido. ${total} fichas revisadas en ${IDIOMAS.length} idioma(s).\n`);
  process.exit(1);
}

console.log(`\n✓ Contenido válido: ${total} fichas en ${IDIOMAS.length} idioma(s).\n`);
