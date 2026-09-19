#!/usr/bin/env node
/**
 * Convierte un modelo 3D descargado en el GLB que el sitio puede servir.
 *
 *   node scripts/optimizar-modelo.mjs assets-originales/x.glb public/modelos/x.glb [--triangulos 25000]
 *
 * POR QUÉ ES UN GUION Y NO UNA SERIE DE COMANDOS SUELTOS. Casi todos estos modelos vienen con
 * licencia CC BY, que obliga a declarar las modificaciones hechas sobre el original. Una lista de
 * comandos escrita en un README se desincroniza del fichero real en cuanto alguien repite el
 * proceso con otros parámetros. Aquí el procedimiento ES la documentación: lo que dice este
 * fichero es exactamente lo que se hizo. Anota la autoría en assets-originales/CREDITOS.md.
 *
 * LAS CUATRO OPERACIONES, Y POR QUÉ:
 *
 *  1. FUERA LAS TEXTURAS (--sin-texturas). En los modelos de fotogrametría son color y sombras del
 *     objeto real capturados con la luz de aquel día. Si la escena ilumina la figura con luz propia,
 *     esas texturas no solo sobran: pelean con ella. Y suelen ser el 80-90 % del peso del fichero.
 *  2. LIMPIAR: dedup, prune y weld. Quita geometría repetida, nodos que no llegan a usarse y
 *     vértices duplicados que impiden simplificar bien.
 *  3. DIEZMAR. 50k triángulos no son un problema para renderizar, pero sí para descargar. Se baja
 *     con métrica de error, que preserva la silueta: en una figura vista a 400 px lo único que de
 *     verdad importa es el contorno.
 *  4. CUANTIZAR Y COMPRIMIR con meshopt. Posiciones y normales pasan de float32 a enteros, y el
 *     resultado se comprime. El decodificador son ~25 kB frente a los más de 100 kB de Draco, y en
 *     un sitio que carga un modelo esa diferencia es la mitad del presupuesto.
 *
 * El GLB de salida SÍ se versiona, aunque sea generado: su entrada no está en el repositorio y la
 * compilación no puede regenerarlo.
 */

import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const [origen, destino] = args.filter((a) => !a.startsWith('--'));
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  return i === -1 ? porDefecto : Number(args[i + 1]);
};

if (!origen || !destino) {
  console.error('\nUso: node scripts/optimizar-modelo.mjs <origen.glb> <destino.glb> [opciones]\n');
  console.error('  --triangulos <n>   objetivo de triángulos (por defecto 25000)');
  console.error('  --error <n>        error máximo al simplificar, relativo (por defecto 0.002)');
  console.error('  --sin-texturas     descarta las texturas: la escena ilumina con luz propia\n');
  process.exit(1);
}

if (!existsSync(origen)) {
  console.error(`\nNo encuentro ${origen}.`);
  console.error('Descarga el modelo en GLB y déjalo ahí. Anota autoría y licencia en assets-originales/CREDITOS.md.\n');
  process.exit(1);
}

const OBJETIVO = opcion('triangulos', 25000);
const ERROR = opcion('error', 0.002);
const SIN_TEXTURAS = args.includes('--sin-texturas');

const kB = (n) => `${(n / 1024).toFixed(0)} kB`;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

/*
 * El codificador va como DEPENDENCIA del I/O, no basta con registrar la extensión: gltf-transform
 * separa «este documento usa meshopt» de «con qué implementación se codifica», y sin la segunda
 * parte el escritor revienta al llegar a los búferes, con un error que no menciona ninguna de las
 * dos cosas.
 */
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const documento = await io.read(origen);

const trianguloTotal = () =>
  documento.getRoot().listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0);

const antes = (await stat(origen)).size;
const trianglesAntes = trianguloTotal();

const pasos = [
  dedup(),
  // `prune` sin argumentos deja los atributos que nadie usa; aquí se quitan a conciencia.
  prune({ keepAttributes: false, keepLeaves: false }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, OBJETIVO / Math.max(1, trianglesAntes)), error: ERROR }),
  // `reorder` antes de cuantizar: ordena los vértices para que la compresión encuentre más
  // repetición y para que la GPU aproveche su caché al dibujar. Es gratis y se olvida siempre.
  reorder({ encoder: MeshoptEncoder }),
  quantize(),
];

if (SIN_TEXTURAS) {
  for (const textura of documento.getRoot().listTextures()) textura.dispose();
} else {
  // Si se conservan, al menos que vayan en webp y a un tamaño razonable para web.
  pasos.push(textureCompress({ targetFormat: 'webp', resize: [1024, 1024] }));
}

await documento.transform(...pasos);
documento.createExtension(EXTMeshoptCompression).setRequired(true);

await mkdir(dirname(destino), { recursive: true });
await io.write(destino, documento);

const despues = (await stat(destino)).size;

console.log(`
  origen      ${origen}
  destino     ${destino}

  triángulos  ${Math.round(trianglesAntes).toLocaleString('es')} → ${Math.round(trianguloTotal()).toLocaleString('es')}
  texturas    ${SIN_TEXTURAS ? 'descartadas' : `${documento.getRoot().listTextures().length} en webp`}
  tamaño      ${kB(antes)} → ${kB(despues)}  (${(100 - (despues / antes) * 100).toFixed(0)} % menos)

  Cárgalo con cargarModelo() de src/vis/escena3d.ts: registra el decodificador de meshopt, que sin
  él da un error de carga que no dice lo que pasa.
`);
