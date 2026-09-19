/**
 * Carga el maniquí en Node, sin navegador, para validar y medir poses.
 *
 * Se usa el mismo GLTFLoader y el mismo decodificador meshopt que en el visor. Un validador que
 * cargase el modelo por otro camino podría dar por buena una pose que en pantalla se ve distinta.
 */
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { prepararEsqueleto } from '../../src/figura/cinematica.js';

export async function cargarManiqui(ruta = 'public/modelos/maniqui.glb') {
  const b = readFileSync(ruta);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const esq = prepararEsqueleto(gltf.scene);
  const mallas = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) mallas.push(o); });
  return { esq, mallas, escena: gltf.scene };
}

/**
 * Vértices de la piel YA POSADA, en coordenadas de mundo. Cada `paso` vértices, para ir rápido.
 *
 * Cada vértice lleva `mano`: si el hueso que más lo mueve es de la mano o un dedo. Las colisiones
 * lo usan para no contar el agarre como choque: en el press de banca, los únicos vértices "dentro"
 * de la barra eran los pulgares cerrados sobre ella.
 */
export function verticesPosados({ mallas, escena }, paso = 1) {
  escena.updateMatrixWorld(true);
  const salida = [];
  for (const m of mallas) {
    const pos = m.geometry.getAttribute('position');
    const manos = esDeMano(m);
    for (let n = 0; n < pos.count; n += paso) {
      const v = m.getVertexPosition(n, new Vector3()).applyMatrix4(m.matrixWorld);
      v.mano = manos[n];
      salida.push(v);
    }
  }
  return salida;
}

const cacheManos = new WeakMap();
function esDeMano(malla) {
  if (cacheManos.has(malla)) return cacheManos.get(malla);
  const indices = malla.geometry.getAttribute('skinIndex');
  const pesos = malla.geometry.getAttribute('skinWeight');
  const resultado = [];
  for (let n = 0; n < indices.count; n += 1) {
    let mejor = 0;
    for (let k = 1; k < 4; k += 1) if (pesos.getComponent(n, k) > pesos.getComponent(n, mejor)) mejor = k;
    const nombre = malla.skeleton.bones[indices.getComponent(n, mejor)].name;
    resultado.push(/DEF-(hand|f_|thumb)/.test(nombre));
  }
  cacheManos.set(malla, resultado);
  return resultado;
}
