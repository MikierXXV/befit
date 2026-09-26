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
 *
 * Y lleva `hueso`: el nombre del hueso que más lo mueve. Sirve para medir el grosor de cada miembro
 * posado, que es lo que necesita la comprobación de la barra que atraviesa un muslo por dentro.
 */
export function verticesPosados({ mallas, escena }, paso = 1) {
  escena.updateMatrixWorld(true);
  const salida = [];
  for (const m of mallas) {
    const pos = m.geometry.getAttribute('position');
    const huesos = huesoDominante(m);
    for (let n = 0; n < pos.count; n += paso) {
      const v = m.getVertexPosition(n, new Vector3()).applyMatrix4(m.matrixWorld);
      v.hueso = huesos[n];
      v.mano = /DEF-(hand|f_|thumb)/.test(v.hueso);
      salida.push(v);
    }
  }
  return salida;
}

/**
 * TODOS los vértices posados que mueve sobre todo alguno de los huesos `nombres`, en mundo.
 *
 * Existe por la comprobación de la barra metida en un miembro: medía el grosor del muslo con los
 * vértices de `verticesPosados(…, 2)`, y a la altura del cruce quedaban 2–4; con 2 mm de cambio en
 * la pose el muslo pasaba de 3,1 a 9,7 cm de grueso, y el bloqueo del peso muerto daba 0 con la
 * barra 3,4 cm dentro. Posar la malla entera sin saltarse vértices en cada fotograma costaría el
 * doble; posar solo los del hueso que hace falta, no.
 *
 * No actualiza las matrices: se llama justo después de `verticesPosados`, que ya lo hace.
 */
export function verticesDeHuesos({ mallas }, nombres) {
  const salida = [];
  for (const m of mallas) {
    const porHueso = indicesPorHueso(m);
    for (const nombre of nombres) {
      for (const n of porHueso.get(nombre) ?? []) {
        salida.push(m.getVertexPosition(n, new Vector3()).applyMatrix4(m.matrixWorld));
      }
    }
  }
  return salida;
}

const cachePorHueso = new WeakMap();
function indicesPorHueso(malla) {
  if (cachePorHueso.has(malla)) return cachePorHueso.get(malla);
  const mapa = new Map();
  huesoDominante(malla).forEach((nombre, n) => {
    if (!mapa.has(nombre)) mapa.set(nombre, []);
    mapa.get(nombre).push(n);
  });
  cachePorHueso.set(malla, mapa);
  return mapa;
}

const cacheHuesos = new WeakMap();
function huesoDominante(malla) {
  if (cacheHuesos.has(malla)) return cacheHuesos.get(malla);
  const indices = malla.geometry.getAttribute('skinIndex');
  const pesos = malla.geometry.getAttribute('skinWeight');
  const resultado = [];
  for (let n = 0; n < indices.count; n += 1) {
    let mejor = 0;
    for (let k = 1; k < 4; k += 1) if (pesos.getComponent(n, k) > pesos.getComponent(n, mejor)) mejor = k;
    resultado.push(malla.skeleton.bones[indices.getComponent(n, mejor)].name);
  }
  cacheHuesos.set(malla, resultado);
  return resultado;
}
