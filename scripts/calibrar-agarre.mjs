#!/usr/bin/env node
/**
 * Fija el agarre de los movimientos con barra: escribe en cada uno la orientación de la mano
 * RESPECTO A LA BARRA, tomada de su primer fotograma.
 *
 *   node scripts/calibrar-agarre.mjs                 # todos los que van con barra
 *   node scripts/calibrar-agarre.mjs sentadilla-barra
 *
 * POR QUÉ HACE FALTA. Sin esto, la cinemática deduce la orientación de la mano del antebrazo en
 * cada fotograma, y al moverse el brazo la mano va girando alrededor de la barra —medido: hasta 15°
 * de un fotograma al siguiente en el press militar—. Un agarre de verdad no resbala: lo que se
 * dobla es la muñeca. Con el marco declarado, la mano se queda donde se puso.
 *
 * SE CALIBRA Y SE MIRA. El primer fotograma es el que manda, así que hay que haberlo revisado antes
 * en la hoja (`npm run hoja`): lo que se congele aquí es lo que se verá durante todo el recorrido.
 * Y se vuelve a calibrar si se cambia la postura inicial del movimiento.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Quaternion } from 'three';
import { aplicarPose, poseEn, LADOS } from '../src/figura/cinematica.js';
import { cargarManiqui } from './lib/maniqui-node.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(RAIZ, 'content/movimientos');

const { esq } = await cargarManiqui();
const pedidos = process.argv.slice(2);
const ids = pedidos.length
  ? pedidos
  : readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

let hechos = 0;
for (const id of ids) {
  const ruta = join(DIR, `${id}.json`);
  const mov = JSON.parse(readFileSync(ruta, 'utf8'));
  const barra = mov.implementos?.barra;
  // Solo los que tienen una barra a la que van las manos: lo que se lleva EN la mano ya va con ella.
  if (!barra || !mov.poses.some((p) => p.brazos?.ambos?.objetivo === 'barra' || p.brazos?.i?.objetivo === 'barra')) continue;

  /*
   * Se calibra SIN el marco puesto: si ya hubiera uno, se estaría copiando a sí mismo y el
   * movimiento se quedaría congelado en la primera calibración para siempre.
   */
  delete barra.agarre_marco;
  const r = aplicarPose(esq, poseEn(mov, 0), mov);
  const orientacionBarra = r.implementos.barra.orientacion.clone();

  const marco = {};
  for (const l of LADOS) {
    const hueso = esq.huesos[`mano_${l}`];
    // El marco de la mano es W · N⁻¹; relativo a la barra, la orientación de esta por delante.
    const F = hueso.getWorldQuaternion(new Quaternion()).multiply(esq.neutra.get(hueso).clone().invert());
    const relativo = orientacionBarra.clone().invert().multiply(F);
    marco[l] = [relativo.x, relativo.y, relativo.z, relativo.w].map((n) => Number(n.toFixed(6)));
  }

  /*
   * AGARRE SUPINO: MEDIA VUELTA ALREDEDOR DE LA BARRA.
   *
   * La cinemática deduce siempre un agarre pronado —palmas hacia fuera—, porque saca el marco de
   * la mano del antebrazo. Un agarre supino es exactamente ese mismo marco girado 180° sobre el eje
   * de la barra, que en su marco local es la X. Así la mano se queda donde está y solo cambia por
   * qué lado la rodea, que es lo que distingue una dominada de una dominada supina.
   */
  if (barra.agarre_supino) {
    const media = new Quaternion(1, 0, 0, 0);
    for (const l of LADOS) {
      const q = media.clone().multiply(new Quaternion(...marco[l]));
      marco[l] = [q.x, q.y, q.z, q.w].map((n) => Number(n.toFixed(6)));
    }
  }

  barra.agarre_marco = marco;
  writeFileSync(ruta, `${JSON.stringify(mov, null, 2)}\n`);
  console.log(`✓ ${id}`);
  hechos += 1;
}

console.log(`\n${hechos} movimiento(s) con el agarre fijado a la barra.`);
