#!/usr/bin/env node
/**
 * Fija el agarre de los movimientos con barra (o paralelas, o kettlebell a dos manos): escribe en cada uno la orientación de la mano
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
import { aplicarPose, barraDeMano, poseEn, LADOS } from '../src/figura/cinematica.js';
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
  /*
   * Las paralelas se calibran igual, cada mano contra la barra de SU lado: el marco se guarda en el
   * implemento `paralelas`, relativo a esa barra (ver `barraParalela` en la cinemática).
   */
  const va = (objetivo) => mov.poses.some((p) => ['ambos', 'i', 'd'].some((k) => p.brazos?.[k]?.objetivo === objetivo));
  /*
   * Y la kettlebell cogida con las dos manos, por el asa (`objetivo: "kettlebell"`) o por los cuernos
   * (`"cuernos"`): el marco se guarda en la kettlebell, relativo al asa o al cuerno de cada mano.
   * Un movimiento, una forma de cogerla: el marco es uno.
   */
  const objetivo = ['barra', 'paralelas', 'kettlebell', 'cuernos']
    .find((o) => mov.implementos?.[o === 'cuernos' ? 'kettlebell' : o] && va(o));
  const nombre = objetivo === 'cuernos' ? 'kettlebell' : objetivo;
  // Solo los que tienen una barra a la que van las manos: lo que se lleva EN la mano ya va con ella.
  if (!nombre) continue;
  const barra = mov.implementos[nombre];

  /*
   * Se calibra SIN el marco puesto: si ya hubiera uno, se estaría copiando a sí mismo y el
   * movimiento se quedaría congelado en la primera calibración para siempre.
   */
  delete barra.agarre_marco;
  const r = aplicarPose(esq, poseEn(mov, 0), mov);
  // La misma barra que agarra la cinemática: la de siempre, la paralela de su lado, el asa o el cuerno.
  const orientacionDe = (l) => barraDeMano({ objetivo }, r.implementos, l).orientacion.clone();

  const marco = {};
  for (const l of LADOS) {
    const hueso = esq.huesos[`mano_${l}`];
    // El marco de la mano es W · N⁻¹; relativo a la barra, la orientación de esta por delante.
    const F = hueso.getWorldQuaternion(new Quaternion()).multiply(esq.neutra.get(hueso).clone().invert());
    const relativo = orientacionDe(l).invert().multiply(F);
    marco[l] = [relativo.x, relativo.y, relativo.z, relativo.w].map((n) => Number(n.toFixed(6)));
  }

  /*
   * AGARRE SUPINO: MEDIA VUELTA ALREDEDOR DEL EJE DE LA MANO, NO DEL DE LA BARRA.
   *
   * La cinemática deduce siempre un agarre pronado —palmas hacia fuera—, porque saca el marco de la
   * mano del antebrazo. Supinar es lo que hace el antebrazo al girar sobre sí mismo: la palma pasa
   * al otro lado y el eje largo de la mano, de la muñeca a los dedos, SE QUEDA DONDE ESTABA.
   *
   * El primer intento giró media vuelta alrededor del eje de la barra. Eso invierte la palma, sí,
   * pero también el eje largo, y la cinemática usa ese eje para decidir dónde poner la muñeca
   * —`AVANCE_AGARRE` la separa del agarre «hacia atrás»—. Con el eje del revés la muñeca se iba al
   * otro lado de la barra y el puño quedaba cerrado sobre el aire, con la barra rozando los
   * nudillos por fuera. Se ve en el primer plano del agarre.
   *
   * Post-multiplicar es lo que hace que el giro sea EN EL MARCO DE LA MANO. El eje largo local es
   * ABAJO, (0, -1, 0), así que media vuelta sobre él es el cuaternión (0, -1, 0, 0).
   */
  if (barra.agarre_supino) {
    const media = new Quaternion(0, -1, 0, 0);
    for (const l of LADOS) {
      const q = new Quaternion(...marco[l]).multiply(media);
      marco[l] = [q.x, q.y, q.z, q.w].map((n) => Number(n.toFixed(6)));
    }
  }

  barra.agarre_marco = marco;
  writeFileSync(ruta, `${JSON.stringify(mov, null, 2)}\n`);
  console.log(`✓ ${id}`);
  hechos += 1;
}

console.log(`\n${hechos} movimiento(s) con el agarre fijado a la barra.`);
