#!/usr/bin/env node
/**
 * Saca el maniquí del paquete de animaciones de Quaternius y lo deja listo para servir.
 *
 *   node scripts/extraer-maniqui.mjs
 *
 * El paquete trae el maniquí CON 45 animaciones de videojuego (pistola, espada, nadar…) metidas en
 * el mismo GLB: 6,6 MB, casi todo curvas que nunca vamos a reproducir. Aquí nos quedamos con la
 * malla y el esqueleto; el movimiento lo ponen las poses de cada ejercicio.
 *
 * No se diezma: 13.7k triángulos ya es poco, y en un cuerpo que se dobla la simplificación se nota
 * justo en las articulaciones, que es lo que el usuario está mirando.
 */

import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { stat } from 'node:fs/promises';

const ORIGEN = 'assets-originales/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb';
const DESTINO = 'public/modelos/maniqui.glb';

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(ORIGEN);
// Los muestreadores y canales hay que tirarlos uno a uno: dispose() de la animación no los arrastra,
// y prune() no los ve como huérfanos. La primera versión de este guion "quitaba" las animaciones y
// dejaba 2,9 MB de curvas colgando.
for (const a of doc.getRoot().listAnimations()) {
  a.listChannels().forEach((c) => c.dispose());
  a.listSamplers().forEach((s) => { s.getInput()?.dispose(); s.getOutput()?.dispose(); s.dispose(); });
  a.dispose();
}

await doc.transform(
  dedup(),
  prune(),
  reorder({ encoder: MeshoptEncoder }),
  // Cuantizar huesos y pesos de piel funciona, pero la posición a 14 bits: con 12 el maniquí de
  // 1,83 m tiene escalones de 0,4 mm que en las uniones del codo se ven como costuras.
  quantize({ quantizePosition: 14 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
  method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
});

await io.write(DESTINO, doc);
const antes = (await stat(ORIGEN)).size;
const despues = (await stat(DESTINO)).size;
console.log(`${DESTINO}: ${(antes / 1024).toFixed(0)} kB → ${(despues / 1024).toFixed(0)} kB`);
