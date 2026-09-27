/**
 * Carga el maniquí en Node, sin navegador, para validar y medir poses.
 *
 * Se usa el mismo GLTFLoader y el mismo decodificador meshopt que en el visor. Un validador que
 * cargase el modelo por otro camino podría dar por buena una pose que en pantalla se ve distinta.
 */
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
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
    prepararPosado(m);
    for (let n = 0; n < pos.count; n += paso) {
      const v = posarVertice(m, n);
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
      for (const n of porHueso.get(nombre) ?? []) salida.push(posarVertice(m, n));
    }
  }
  return salida;
}

/*
 * POSAR UN VÉRTICE SIN `getVertexPosition`.
 *
 * Three.js, en cada vértice y en cada una de sus cuatro influencias, multiplica la matriz de mundo
 * del hueso por su inversa de reposo y desnormaliza la posición y los pesos, que en este modelo van
 * cuantizados. Con la comprobación de autocolisión, que posa todos los vértices de tronco, muslos y
 * piernas en cada fotograma, eso era más de la mitad del tiempo del validador: pasaba de 6 a 9 s.
 * Aquí las matrices se calculan una vez por malla y fotograma (en `verticesPosados`, que es quien
 * actualiza el mundo) y los atributos se desnormalizan una vez al cargar. Mismo cálculo, mismos
 * números que `getVertexPosition` + `matrixWorld`.
 */
const cachePosado = new WeakMap();
function prepararPosado(m) {
  let c = cachePosado.get(m);
  if (!c) {
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const ind = g.getAttribute('skinIndex');
    const pes = g.getAttribute('skinWeight');
    c = { pos: new Float32Array(pos.count * 3), ind: new Uint16Array(pos.count * 4), pes: new Float32Array(pos.count * 4), huesos: [], salida: new Matrix4() };
    for (let n = 0; n < pos.count; n += 1) {
      c.pos[n * 3] = pos.getX(n); c.pos[n * 3 + 1] = pos.getY(n); c.pos[n * 3 + 2] = pos.getZ(n);
      for (let k = 0; k < 4; k += 1) {
        c.ind[n * 4 + k] = ind.getComponent(n, k);
        c.pes[n * 4 + k] = pes.getComponent(n, k);
      }
    }
    cachePosado.set(m, c);
  }
  // hueso_k = matrixWorld(hueso) · inversa de reposo · bindMatrix; y al final, bindMatrixInverse y el mundo de la malla.
  const { bones, boneInverses } = m.skeleton;
  c.huesos = bones.map((b, k) => new Matrix4().multiplyMatrices(b.matrixWorld, boneInverses[k]).multiply(m.bindMatrix).elements);
  c.salida.multiplyMatrices(m.matrixWorld, m.bindMatrixInverse);
  return c;
}

function posarVertice(m, n) {
  const c = cachePosado.get(m) ?? prepararPosado(m);
  const px = c.pos[n * 3], py = c.pos[n * 3 + 1], pz = c.pos[n * 3 + 2];
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 4; k += 1) {
    const w = c.pes[n * 4 + k];
    if (w === 0) continue;
    const e = c.huesos[c.ind[n * 4 + k]];
    x += w * (e[0] * px + e[4] * py + e[8] * pz + e[12]);
    y += w * (e[1] * px + e[5] * py + e[9] * pz + e[13]);
    z += w * (e[2] * px + e[6] * py + e[10] * pz + e[14]);
  }
  return new Vector3(x, y, z).applyMatrix4(c.salida);
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
