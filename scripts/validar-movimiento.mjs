#!/usr/bin/env node
/**
 * Valida el movimiento de cada ejercicio posando el maniquí de verdad, fotograma a fotograma.
 *
 *   node scripts/validar-movimiento.mjs            todos
 *   node scripts/validar-movimiento.mjs --detalle  además, los ángulos de cada pose clave
 *
 * POR QUÉ POSANDO Y NO LEYENDO EL JSON. Casi todo lo que sale mal no está escrito en la ficha: sale
 * de la cinemática inversa. Nadie escribe "rodilla a 170°"; escribe una cadera demasiado baja y la
 * rodilla se dobla sola. Y la interpolación entre dos poses buenas puede pasar por una mala.
 *
 * Qué comprueba, en `MUESTRAS` fotogramas por ciclo:
 *  - estructura: t de 0 a 1 en orden, curvas que existen, y ciclo cerrado (la última pose = la primera);
 *  - que manos y pies alcancen su objetivo;
 *  - rangos articulares (RANGOS en cinematica.js);
 *  - piel: ningún vértice bajo el suelo ni dentro de un implemento sólido;
 *  - barras: ninguna barra ni agarre de polea atravesando un miembro por dentro;
 *  - implementos: ninguna mancuerna o barra metida más de 1 cm en otra, ni en el banco;
 *  - autocolisión: ningún miembro metido más de 2,5 cm en otro que no es su vecino (antebrazo en
 *    la barriga, mano en el muslo); ver EL CUERPO QUE SE ATRAVIESA A SÍ MISMO;
 *  - apoyos: si la ficha dice que el cuerpo descansa en el banco, que descanse;
 *  - equilibrio: la barra sobre el medio pie, cuando la ficha lo pide.
 *
 * Bloquea: sale con código 1 si hay un solo error. Un aviso que no bloquea acaba ignorándose.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { aplicarPose, geometriaBanco, poseEn, RANGOS, CURVAS_VALIDAS, LADOS } from '../src/figura/cinematica.js';
import { cargarManiqui, verticesPosados, verticesDeHuesos } from './lib/maniqui-node.mjs';

/**
 * El rango de una articulación, que en la cadera depende de la postura.
 *
 * La abducción de 50° de RANGOS es la de la cadera ESTIRADA. Con la cadera flexionada llega más
 * lejos: los ligamentos que la frenan —iliofemoral y pubofemoral— se tensan en extensión y se
 * destensan al flexionar, que es por lo que se puede abrir mucho más en cuclillas que de pie. Con
 * un único 50° el peso muerto sumo no cabía: sin poder abrir más los muslos, las rodillas iban
 * hacia delante, la cadera se pasaba de flexión y la inclinación que faltaba acababa en la
 * espalda, redondeada, que es justo lo que un peso muerto no debe enseñar.
 *
 * Se abre de forma gradual, hasta 15° más con la cadera a 90° de flexión.
 */
function rango(clave, angulos) {
  const base = clave.replace(/_[id]$/, '');
  const [min, max] = RANGOS[base] ?? [-Infinity, Infinity];
  if (base !== 'cadera.abduccion') return [min, max];
  const flexion = angulos[clave.replace('abduccion', 'flexion')] ?? 0;
  return [min, max + 15 * Math.min(1, Math.max(0, flexion / 90))];
}

/*
 * Los números salen de content/reglas.json, como en el resto de validadores de la plantilla: el
 * guion es genérico y no sabe nada del proyecto. Las tolerancias de piel están en metros; la malla
 * es de videojuego y el talón ya asoma un milímetro bajo el suelo en reposo.
 */
const REGLAS = JSON.parse(readFileSync('content/reglas.json', 'utf8')).movimiento ?? {};
const MUESTRAS = REGLAS.muestras_por_ciclo ?? 48;
const HOLGURA_SUELO = REGLAS.holgura_suelo ?? 0.012;
const HOLGURA_SOLIDO = REGLAS.holgura_solido ?? 0.02;
const DIRECTORIO = REGLAS.directorio ?? 'content/movimientos';
const DETALLE = process.argv.includes('--detalle');

/*
 * LA BARRA QUE ATRAVIESA UN MIEMBRO POR DENTRO.
 *
 * La comprobación de piel de más abajo busca vértices a menos de 1,4 cm del eje de la barra, y eso
 * solo ve la barra que ROZA la piel. Cuando la barra cruza un muslo por el medio, la piel queda a
 * 6 u 8 cm del eje, por fuera, y no salta nada: en el peso muerto sumo la barra iba metida hasta
 * 6,8 cm en los muslos, y en el convencional hasta 5,3 cm entre t≈0,33 y t≈0,58, las dos con el
 * validador en verde. Además la del peso muerto no se declaraba `solido`, así que ni se miraba.
 *
 * Aquí se mira el hueso, no la piel: la distancia mínima entre el eje de la barra y el segmento
 * óseo de cada miembro, contra el grosor de la piel de ESE miembro en ESA dirección, medido en los
 * vértices posados que mueve ese hueso y que caen a la altura del cruce. Si el eje queda más
 * adentro que el grosor menos la tolerancia, la barra está metida. Una barra APOYADA —en la
 * espalda en la sentadilla, en la cadera en el hip thrust, en el pecho en el press— tiene el eje a
 * un radio de barra por fuera de la piel y no cuenta; lo que se busca es la que se hunde.
 *
 * Las manos no son segmentos: agarran la barra a propósito. Del antebrazo solo se mira la parte del
 * codo: el tramo junto a la muñeca queda, con la mano cerrada, a un par de centímetros de la barra.
 *
 * Tolerancia de 1 cm. El grosor medio (ver CÓMO SE MIDE EL GROSOR) queda entre 0,5 y 1 cm por
 * debajo de la piel que encuentra un rayo lanzado desde el hueso hacia la barra, así que 1 cm aquí
 * son 1,5–2 cm de barra hundida de verdad. Las barras bien apoyadas —la del rumano y la del curl
 * con barra resbalando por los muslos— dan entre −0,2 y 0 cm (0,8 cm con rayos).
 * (La primera versión, con el vértice que más salía, pedía 1,5 cm porque sobrestimaba; esta no.)
 */
const TOLERANCIA_BARRA = REGLAS.tolerancia_barra_dentro ?? 0.01;
/*
 * CÓMO SE MIDE EL GROSOR, y por qué no con el vértice que más sale.
 *
 * La primera versión tomaba el máximo de los vértices de `verticesPosados(…, 2)` a ±4 cm del cruce:
 * quedaban 2–4, y con 2 mm de cambio en la pose el grosor del muslo saltaba entre 3,1 y 9,7 cm,
 * según cuál entrase en la franja. El bloqueo del peso muerto daba 0 con la barra 3,4 cm dentro.
 * Ahora se usan TODOS los vértices del hueso y una media ponderada de su distancia al eje: pesan
 * más los que están a la altura del cruce (campana de 3,5 cm, hasta 7 cm) y los que miran hacia la
 * barra (campana de 25°, hasta 70°). Un vértice que entra o sale de la franja pesa casi nada, así
 * que el grosor cambia poco a poco cuando la pose cambia poco a poco.
 */
const GROSOR_SIGMA_EJE = 0.035;
const GROSOR_FRANJA = 0.07;
const GROSOR_SIGMA_ANGULO = (25 * Math.PI) / 180;
const GROSOR_ANGULO_MAX = (70 * Math.PI) / 180;
const SEGMENTOS = [
  ...LADOS.flatMap((l) => {
    const s = { i: 'L', d: 'R' }[l];
    const lado = { i: 'izquierdo', d: 'derecho' }[l];
    return [
      { nombre: `muslo ${lado}`, desde: `muslo_${l}`, hasta: `pierna_${l}`, huesos: [`DEF-thigh${s}`] },
      { nombre: `pierna ${lado}`, desde: `pierna_${l}`, hasta: `pie_${l}`, huesos: [`DEF-shin${s}`] },
      { nombre: `brazo ${lado}`, desde: `brazo_${l}`, hasta: `antebrazo_${l}`, huesos: [`DEF-upper_arm${s}`] },
      { nombre: `antebrazo ${lado}`, desde: `antebrazo_${l}`, hasta: `mano_${l}`, huesos: [`DEF-forearm${s}`], hastaFraccion: 0.7 },
    ];
  }),
  { nombre: 'tronco', desde: 'pelvis', hasta: 'cuello', huesos: ['DEF-hips', 'DEF-spine001', 'DEF-spine002', 'DEF-spine003'] },
  /*
   * El cuello y la cabeza tampoco estaban, y la barra pasa por ahí en cuanto sube por delante de la
   * cara. En las dominadas supinas la cabeza subía justo debajo de la barra y la atravesaba hasta
   * 7 cm, y en el press militar la barra subía recta y cruzaba la barbilla hasta 4,7 cm (con rayos),
   * las dos en verde. El cuello es un cilindro como los demás; la cabeza no (ver `bolaDentro`).
   */
  { nombre: 'cuello', desde: 'cuello', hasta: 'cabeza', huesos: ['DEF-neck'] },
  { nombre: 'cabeza', bola: true, huesos: ['DEF-head'] },
];
/*
 * TEMPORAL. Movimientos que hoy tienen la barra metida en un miembro y aún no se han corregido: se
 * informa, pero no bloquea. Al arreglar uno, se quita de aquí; la lista tiene que acabar vacía.
 */
const BARRA_DENTRO_PENDIENTES = new Set([]);

/*
 * UN IMPLEMENTO DENTRO DE OTRO.
 *
 * Lo de arriba mira el cuerpo contra los implementos, pero nada miraba un implemento contra otro:
 * en las aperturas inclinadas, arriba, las dos mancuernas iban una dentro de la otra —5,3 cm entre
 * ejes con discos de 6 cm de radio— con el validador en verde, y se vio en la hoja.
 *
 * Mancuernas y barras son cilindros a lo largo de su eje X, pieza a pieza como las dibuja el visor
 * (`crearImplemento`): la mancuerna, un mango de 1,6 cm de radio y 14 de largo y dos discos de 6 cm
 * de radio y 8 de largo a ±11 cm; la barra, la barra de 2,2 m, los manguitos y los dos discos de
 * cada lado. Se siembran puntos por el volumen de cada pieza (anillos cada 2 cm a lo largo del eje,
 * en el centro, a medio radio y en el borde) y se mide cuánto se mete el más hondo en la otra: en
 * un cilindro, lo que le falta para salir por el lado o por la tapa, lo menor; en el banco, su
 * `profundidad`, la misma de la piel. Se mira en los dos sentidos, y antes, si las esferas que
 * envuelven las dos piezas ni se tocan, no se siembra nada: casi todos los fotogramas acaban ahí.
 *
 * Mide el punto más hondo, no lo que habría que separarlas, así que se queda corto: las dos
 * mancuernas de las aperturas daban unos 4 cm, cuando separarlas pedía 6,7. Para cazar el fallo
 * basta; no se pasa nunca.
 *
 * Tolerancia de 1 cm. Dos discos que se tocan dan 0, y tocarse está bien —las mancuernas del press
 * se juntan arriba—; lo que se busca es que se metan.
 */
const TOLERANCIA_IMPLEMENTOS = REGLAS.tolerancia_implementos ?? 0.01;
// [radio, medio largo, centro en X], en metros; el mismo dibujo que `crearImplemento` del visor.
const PIEZAS_CILINDRO = {
  mancuerna: [[0.016, 0.07, 0], [0.06, 0.04, -0.11], [0.06, 0.04, 0.11]],
  barra: [[0.014, 1.1, 0], ...[-1, 1].flatMap((s) => [[0.025, 0.21, s * 0.88], [0.225, 0.0225, s * 0.72], [0.19, 0.0175, s * 0.765]])],
};
/*
 * TEMPORAL, como las otras dos: movimientos con un implemento metido en otro que aún no se han
 * corregido. Avisan sin bloquear; al arreglar uno se quita de aquí.
 */
const IMPLEMENTOS_PENDIENTES = new Set([]);

/*
 * EL CUERPO QUE SE ATRAVIESA A SÍ MISMO.
 *
 * Nada miraba la piel contra la piel: en el remo en polea sentado los antebrazos se metían en la
 * barriga al tirar, y en la rotación rusa brazos y manos cruzaban muslos y tronco, los dos
 * publicados con el validador en verde. Lo vio Migue en la web.
 *
 * Cada VOLUMEN (tronco, muslos, piernas) se trata como una cápsula sobre su hueso, con el grosor
 * medido en SUS vértices posados, sin saltarse ninguno: un perfil de radio por franjas de 3 cm a lo
 * largo del hueso y sectores de 30° alrededor. El tronco son cuatro cápsulas, una por vértebra de
 * la malla, porque en un encogimiento o en la rotación rusa se curva, y un eje recto de la pelvis
 * al cuello salía por delante de la barriga. Luego se miran los vértices de cada MIEMBRO que puede
 * chocar con él: cuánto queda cada uno por dentro del radio del volumen en su franja y su sector.
 * La cabeza es una bola, como en la barra (ver `bolaDentro`).
 *
 * Lo que cuenta es el TERCER vértice más hundido, no el primero: el perfil es una media y en un
 * sector donde la piel cambia deprisa —la axila, la ingle— un vértice suelto sale 1-2 cm dentro sin
 * que haya nada que ver. Cuando un miembro entra de verdad, entran muchos.
 *
 * Qué choca con qué. Solo parejas que no son vecinas: antebrazo, brazo y mano contra tronco y
 * muslos; antebrazo y brazo contra la cabeza; muslo contra el tronco y el otro muslo; pierna contra
 * la otra pierna y el otro muslo. El antebrazo contra su brazo (el curl) no se mira: es el codo.
 * Las parejas que comparten articulación sí se miran, pero lejos de ella: del brazo contra el
 * tronco, solo desde el 35 % del brazo (el hombro hunde el deltoides en el pecho en cualquier
 * elevación); del muslo contra el tronco, desde el 40 % (la ingle se pliega en cuanto la cadera
 * flexiona); de un muslo contra el otro, desde el 30 % (la entrepierna).
 *
 * Tolerancia de 2,5 cm. Rozar no es un fallo: dos pieles que se tocan dan 0, pero la malla no se
 * aplasta como la carne, y un brazo colgando pegado al costado ya se mete 1,5-2,2 cm (sentadilla con
 * barra, peso muerto, rumano con mancuernas, buenos días) y una mano apoyada en el muslo, lo mismo.
 * Con 2 cm saltaban esos. Lo que se busca entra 4-8 cm: los antebrazos del remo en polea en la
 * barriga, hasta 6,3 cm; las manos de la rotación rusa en los muslos, hasta 7,8. El muslo contra
 * el tronco va con la misma: se temía que en una sentadilla profunda se tocasen de verdad, pero en
 * la sentadilla con barra, la goblet y el encogimiento abdominal quedan 4-5 cm de aire.
 * Un trazado de rayos contra la malla da lo mismo o más hondo (la goblet, 5-7 cm): los fallos
 * son de la pose, no del método, que se queda corto antes que pasarse.
 *
 * MANO CONTRA MANO. Las parejas de arriba no comparaban una mano con la otra, ni una mano con el
 * antebrazo contrario, y en la rotación rusa las manos iban metidas una dentro de la otra delante
 * del pecho (1,7 cm en el centro, hasta 2,9 al salir hacia los lados) con todo en verde. Lo vio
 * Migue. Ahora la mano izquierda se mide contra la derecha (una vez, como los muslos) y cada mano
 * contra el antebrazo del otro lado, con el mismo método. La mano es un volumen de dieciséis
 * cápsulas, una por hueso (palma, pulgar y cada falange), sobre el eje Y del hueso y RECORTADAS a
 * su largo: sin recortar, la franja que el perfil deja más allá de la punta de un dedo daba
 * «dentro» a lo que solo tocaba la yema.
 *
 * Tolerancia de 1,5 cm, no 2,5: una falange tiene 1,6-2 cm de grueso y la palma unos 3, así que ni
 * un dedo que atraviesa otro de lado a lado llegaría a 2,5. Contrastado con el número de giro de la
 * malla de la otra mano (cuántos vértices quedan dentro de verdad, y a qué distancia de su piel):
 * la rotación rusa daba aquí 1,9 en el centro y hasta 4,1 al girar (de verdad, 1,7 y 2,9); el
 * pullover, 3,2 (1,7 de verdad, las dos manos una dentro de la otra en la mancuerna); el remo en
 * polea, 1,7 (1,2: los dedos de una mano entre los de la otra junto al agarre en V). Por debajo
 * quedan la sentadilla sumo con mancuerna, 1,5 (0,7 de verdad: dedos que se montan bajo el disco),
 * y el face-pull, 0,9 (0,8); la goblet, el press Pallof, las dominadas y los jalones, nada. Mide
 * algo más hondo que el número de giro, pero en el mismo orden. El antebrazo contrario va con la
 * misma tolerancia, porque lo que se mete en él es la mano.
 */
const TOLERANCIA_AUTOCOLISION = REGLAS.tolerancia_autocolision ?? 0.025;
const TOLERANCIA_AUTOCOLISION_MANO = REGLAS.tolerancia_autocolision_mano ?? 0.015;
const PERFIL_FRANJA = 0.03;
const PERFIL_SECTORES = 12;
const PERFIL_SIGMA_EJE = 0.02;
const PERFIL_SIGMA_ANGULO = (20 * Math.PI) / 180;
const HUESOS_MANO = ['hand', ...['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'].flatMap((d) => ['01', '02', '03'].map((n) => d + n))];
const VOLUMENES = {
  tronco: [
    { desde: (h) => h.pelvis, hasta: (h) => h.columna[0], huesos: ['DEF-hips'] },
    { desde: (h) => h.columna[0], hasta: (h) => h.columna[1], huesos: ['DEF-spine001'] },
    { desde: (h) => h.columna[1], hasta: (h) => h.columna[2], huesos: ['DEF-spine002'] },
    { desde: (h) => h.columna[2], hasta: (h) => h.cuello, huesos: ['DEF-spine003'] },
  ],
  ...Object.fromEntries(LADOS.flatMap((l) => {
    const s = { i: 'L', d: 'R' }[l];
    const lado = { i: 'izquierdo', d: 'derecho' }[l];
    return [
      [`muslo ${lado}`, [{ desde: (h) => h[`muslo_${l}`], hasta: (h) => h[`pierna_${l}`], huesos: [`DEF-thigh${s}`] }]],
      [`pierna ${{ i: 'izquierda', d: 'derecha' }[l]}`, [{ desde: (h) => h[`pierna_${l}`], hasta: (h) => h[`pie_${l}`], huesos: [`DEF-shin${s}`] }]],
      [`antebrazo ${lado}`, [{ desde: (h) => h[`antebrazo_${l}`], hasta: (h) => h[`mano_${l}`], huesos: [`DEF-forearm${s}`] }]],
      // La mano, una cápsula por hueso (palma y cada falange) a lo largo de su eje, recortada a su
      // largo: ver MANO CONTRA MANO.
      [`mano ${{ i: 'izquierda', d: 'derecha' }[l]}`, HUESOS_MANO.map((n) => ({ hueso: `DEF-${n}${s}`, huesos: [`DEF-${n}${s}`], recortar: true }))],
    ];
  })),
  cabeza: 'bola',
};
/*
 * Los miembros que se prueban contra los volúmenes; `contra` da, por volumen, desde qué fracción del
 * miembro (medida desde su articulación de arriba) se miran sus vértices. Las parejas simétricas —
 * muslo con muslo, pierna con pierna— solo desde el izquierdo, o saldrían dos veces.
 */
const MIEMBROS_CHOQUE = LADOS.flatMap((l) => {
  const s = { i: 'L', d: 'R' }[l];
  const lado = { i: 'izquierdo', d: 'derecho' }[l];
  const otro = { i: 'derecho', d: 'izquierdo' }[l];
  const ladoF = { i: 'izquierda', d: 'derecha' }[l];
  const otraF = { i: 'derecha', d: 'izquierda' }[l];
  const muslos = { 'muslo izquierdo': 0, 'muslo derecho': 0 };
  return [
    { nombre: `antebrazo ${lado}`, desde: `antebrazo_${l}`, hasta: `mano_${l}`, huesos: [`DEF-forearm${s}`], contra: { tronco: 0, ...muslos, cabeza: 0 } },
    { nombre: `brazo ${lado}`, desde: `brazo_${l}`, hasta: `antebrazo_${l}`, huesos: [`DEF-upper_arm${s}`], contra: { tronco: 0.35, ...muslos, cabeza: 0 } },
    // La mano tiene más vértices que el resto del brazo junto (los dedos): basta uno de cada tres.
    { nombre: `mano ${ladoF}`, femenino: true, mano: s, paso: 3, contra: { tronco: 0, ...muslos, [`antebrazo ${otro}`]: 0, ...(l === 'i' ? { [`mano ${otraF}`]: 0 } : {}) } },
    { nombre: `muslo ${lado}`, desde: `muslo_${l}`, hasta: `pierna_${l}`, huesos: [`DEF-thigh${s}`], contra: { tronco: 0.4, ...(l === 'i' ? { [`muslo ${otro}`]: 0.3 } : {}) } },
    { nombre: `pierna ${ladoF}`, femenino: true, desde: `pierna_${l}`, hasta: `pie_${l}`, huesos: [`DEF-shin${s}`], contra: { [`muslo ${otro}`]: 0, ...(l === 'i' ? { [`pierna ${otraF}`]: 0 } : {}) } },
  ];
});
/*
 * TEMPORAL, como BARRA_DENTRO_PENDIENTES: movimientos con el cuerpo metido en sí mismo que aún no
 * se han corregido. Avisan sin bloquear; al arreglar uno se quita de aquí, y la lista se vacía.
 */
const AUTOCOLISION_PENDIENTES = new Set([
  // Mano contra mano, desde que se miran (ver MANO CONTRA MANO): las dos manos una dentro de otra.
]);

const maniqui = await cargarManiqui();
const dir = DIRECTORIO;
let errores = 0;

for (const fichero of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const mov = JSON.parse(readFileSync(`${dir}/${fichero}`, 'utf8'));
  const id = mov.id ?? fichero.replace(/\.json$/, '');
  const problemas = new Map(); // mensaje → primeras fases donde pasa; así 48 fotogramas no dan 48 líneas
  const fallo = (msg, fase) => {
    if (!problemas.has(msg)) problemas.set(msg, []);
    problemas.get(msg).push(fase);
  };

  /* Estructura */
  const poses = mov.poses;
  if (poses[0]?.t !== 0 || poses.at(-1)?.t !== 1) fallo('las poses deben empezar en t=0 y acabar en t=1', '-');
  poses.forEach((p, n) => {
    if (n && p.t <= poses[n - 1].t) fallo(`pose ${n}: t no crece`, p.t);
    if (p.curva && !CURVAS_VALIDAS.includes(p.curva)) fallo(`pose ${n}: curva "${p.curva}" no existe (${CURVAS_VALIDAS.join(', ')})`, p.t);
  });
  const sinT = ({ t, curva, etiqueta, ...resto }) => JSON.stringify(resto);
  if (sinT(poses[0]) !== sinT(poses.at(-1))) {
    fallo('el ciclo no cierra: la última pose debe ser igual que la primera, o el muñeco salta al repetir', 1);
  }

  const resumen = [];
  const avisos = []; // de la lista temporal de barras metidas: se enseñan, no bloquean
  for (let s = 0; s <= MUESTRAS; s += 1) {
    const fase = s / MUESTRAS;
    const etiqueta = fase.toFixed(2);
    let r;
    try {
      r = aplicarPose(maniqui.esq, poseEn(mov, fase === 1 ? 0.999999 : fase), mov);
    } catch (e) {
      fallo(e.message, etiqueta);
      break;
    }
    r.avisos.forEach((a) => fallo(redactar(a), etiqueta));

    for (const [clave, valor] of Object.entries(r.angulos)) {
      const [min, max] = rango(clave, r.angulos);
      if (valor < min - 0.5 || valor > max + 0.5) {
        fallo(`${clave} fuera de rango [${min}, ${max}]`, `${etiqueta} (${valor.toFixed(0)}°)`);
      }
    }

    const vertices = verticesPosados(maniqui, 2);
    // Piel completa de un miembro, posada solo si alguna barra pasa cerca, y una vez por fotograma.
    const pielPorMiembro = new Map();
    const pielDe = (seg) => {
      if (!pielPorMiembro.has(seg)) pielPorMiembro.set(seg, verticesDeHuesos(maniqui, seg.huesos));
      return pielPorMiembro.get(seg);
    };

    const suelo = Math.min(...vertices.map((v) => v.y));
    if (suelo < -HOLGURA_SUELO) fallo('el cuerpo atraviesa el suelo', `${etiqueta} (${(suelo * 100).toFixed(1)} cm)`);

    for (const [nombre, imp] of Object.entries(r.implementos)) {
      if (!imp.solido) continue;
      // La barra no tiene holgura: 1,4 cm de radio no dan para meterse "un poco". El banco sí, porque
      // la espalda de verdad se hunde algo en el acolchado.
      // Los cilindros finos —barras y agarres de polea— van con holgura de 2 mm: con los 2 cm de
      // un banco, una mano cerrada sobre una barra de 28 mm no tocaría nunca.
      const holgura = imp.tipo.startsWith('barra') || imp.tipo === 'polea' ? 0.002 : HOLGURA_SOLIDO;
      // Sin manos: su contacto con un implemento es el agarre o el apoyo, y se revisa en la hoja.
      const dentro = vertices.filter((v) => !v.mano && profundidad(imp, v) > holgura).length;
      if (dentro > 0) fallo(`el cuerpo atraviesa ${nombre}`, `${etiqueta} (${dentro} vértices)`);
    }

    for (const [nombre, imp] of Object.entries(r.implementos)) {
      for (const dentro of barraDentro(imp, pielDe)) {
        const msg = `${nombre} metida en ${dentro.miembro}`;
        const donde = `${etiqueta} (${(dentro.metida * 100).toFixed(1)} cm)`;
        if (BARRA_DENTRO_PENDIENTES.has(id)) avisos.push([msg, donde, dentro.metida, etiqueta]);
        else fallo(msg, donde);
      }
    }

    for (const choque of implementosMetidos(r.implementos)) {
      const donde = `${etiqueta} (${(choque.metida * 100).toFixed(1)} cm)`;
      if (IMPLEMENTOS_PENDIENTES.has(id)) avisos.push([choque.msg, donde, choque.metida, etiqueta]);
      else fallo(choque.msg, donde);
    }

    for (const choque of autocolision(vertices)) {
      const msg = `${choque.miembro} ${choque.femenino ? 'metida' : 'metido'} en ${choque.volumen}`;
      const donde = `${etiqueta} (${(choque.metida * 100).toFixed(1)} cm)`;
      const tolerancia = /^(mano|antebrazo)/.test(choque.volumen) ? TOLERANCIA_AUTOCOLISION_MANO : TOLERANCIA_AUTOCOLISION;
      if (choque.metida <= tolerancia) continue;
      if (AUTOCOLISION_PENDIENTES.has(id)) avisos.push([msg, donde, choque.metida, etiqueta]);
      else fallo(msg, donde);
    }

    for (const apoyo of mov.apoyos ?? []) {
      const imp = r.implementos[apoyo.implemento];
      // El hueco es lo que queda entre la piel más baja y la superficie: el asiento, el respaldo o
      // las dos, según `con` (ver `zonaDeApoyo`).
      const zona = zonaDeApoyo(imp, apoyo.con);
      const hueco = Math.min(...vertices.map((v) => sobreBanco(imp, v, zona)).filter((h) => h !== null));
      const donde = zona === 'todo' ? apoyo.implemento : `el ${zona} de ${apoyo.implemento}`;
      if (!(Math.abs(hueco) <= apoyo.tolerancia)) {
        fallo(`el cuerpo no descansa en ${donde}`, `${etiqueta} (hueco ${(hueco * 100).toFixed(1)} cm)`);
      }
    }

    /*
     * SENTADO, PERO SENTADO EN EL BANCO.
     *
     * Que el cuerpo no atraviese el banco y que "descanse" en él no basta: en la elevación de
     * talones sentado la cadera estaba 3 cm POR DELANTE del borde, apoyando solo el canto del
     * glúteo, y el maniquí parecía en cuclillas al lado del banco. Las dos comprobaciones de arriba
     * pasaban —el glúteo llega hacia atrás y tocaba—, así que hizo falta verlo en la web.
     *
     * Se mira la CADERA, no la piel: tiene que caer dentro de la huella con un margen. Solo aplica
     * cuando el maniquí está a la altura del acolchado, que es lo que distingue estar sentado de
     * pasar por encima.
     */
    for (const [nombre, imp] of Object.entries(r.implementos)) {
      if (imp.tipo !== 'banco') continue;
      /*
       * Salvo que lo que se apoya en el banco NO sea el asiento. En el hip thrust las escápulas van
       * en el borde y la cadera sube y baja por delante de él, pasando justo por la altura del
       * acolchado: esta regla lo daba por «sentado fuera del banco» en 33 de 48 fotogramas, y no
       * hay pose correcta que lo evite. Lo mismo con las manos (fondos, flexiones inclinadas) o los
       * pies (flexiones declinadas) en el banco. El movimiento lo declara en su apoyo:
       * `"con": "espalda" | "manos" | "pies"`. Sin `con`, es el asiento y la regla se aplica.
       */
      /*
       * Con respaldo, un mismo movimiento declara DOS apoyos en el banco —la espalda en el respaldo y
       * el asiento— y basta con que uno sea el asiento para que la regla valga: antes se saltaba en
       * cuanto un apoyo decía `con`, y el press inclinado con `con: "espalda"` dejaba de mirar si
       * estaba sentado dentro del asiento o en el aire delante de él.
       */
      const suyos = (mov.apoyos ?? []).filter((a) => a.implemento === nombre);
      if (suyos.length && suyos.every((a) => a.con && a.con !== 'asiento')) continue;
      const cadera = maniqui.esq.huesos.pelvis.getWorldPosition(new Vector3());
      if (Math.abs(cadera.y - (imp.posicion.y + imp.alto)) > 0.16) continue;
      // El borde de delante es el del ASIENTO: en el banco inclinado, el respaldo queda detrás.
      const margen = imp.posicion.z + geometriaBanco(imp).asiento.z1 - cadera.z;
      if (margen < 0.05) {
        fallo(`sentado fuera de ${nombre}`, `${etiqueta} (la cadera queda a ${(margen * 100).toFixed(0)} cm del borde)`);
      }
    }

    const eq = mov.comprobaciones?.equilibrio;
    if (eq) {
      const medioPie = LADOS.map((l) => maniqui.esq.huesos[`pie_${l}`].getWorldPosition(new Vector3()))
        .reduce((a, b) => a.add(b)).multiplyScalar(0.5).add(new Vector3(0, 0, 0.07));
      const desvio = r.implementos[eq.implemento].posicion.z - medioPie.z;
      if (Math.abs(desvio) > eq.tolerancia) {
        fallo(`${eq.implemento} fuera del medio pie: se caería ${desvio > 0 ? 'hacia delante' : 'hacia atrás'}`, `${etiqueta} (${(desvio * 100).toFixed(0)} cm)`);
      }
    }

    if (DETALLE && poses.some((p) => Math.abs(p.t - fase) < 1e-6)) {
      resumen.push(`    t=${etiqueta}  ` + Object.entries(r.angulos)
        .filter(([, v]) => Math.abs(v) > 0.5).map(([k, v]) => `${k}=${v.toFixed(0)}`).join('  '));
    }
  }

  if (problemas.size === 0) {
    console.log(`✓ ${id}`);
  } else {
    errores += problemas.size;
    console.log(`✗ ${id}`);
    for (const [msg, fases] of problemas) {
      console.log(`    ${msg} — en ${fases.slice(0, 3).join(', ')}${fases.length > 3 ? ` y ${fases.length - 3} más` : ''}`);
    }
  }
  if (avisos.length) {
    // El peor fotograma de cada miembro, que es el que hay que mirar al arreglarlo.
    const peor = new Map();
    for (const [msg, donde, metida, etiqueta] of avisos) {
      const previo = peor.get(msg);
      if (!previo) peor.set(msg, { metida, donde, n: 1, desde: etiqueta, hasta: etiqueta });
      else Object.assign(previo, { n: previo.n + 1, hasta: etiqueta }, metida > previo.metida ? { metida, donde } : {});
    }
    for (const [msg, { donde, n, desde, hasta }] of peor) {
      console.log(`    ! ${msg} — peor en ${donde}; ${n} fotograma(s) entre ${desde} y ${hasta} [pendiente, no bloquea]`);
    }
  }
  resumen.forEach((l) => console.log(l));
}

/**
 * Los miembros que una barra —o el agarre de una polea— atraviesa por dentro, y cuánto (en metros,
 * del eje de la barra a la piel). Ver LA BARRA QUE ATRAVIESA UN MIEMBRO POR DENTRO, arriba.
 */
function barraDentro(imp, pielDe) {
  const salida = [];
  if (!(imp.tipo.startsWith('barra') || imp.tipo === 'polea')) return salida;
  const medio = imp.tipo === 'polea' ? ((imp.ancho ?? 1.1) / 2) : 1.1;
  const eje = new Vector3(1, 0, 0).applyQuaternion(imp.orientacion ?? { x: 0, y: 0, z: 0, w: 1 });
  const b0 = imp.posicion.clone().addScaledVector(eje, -medio);
  const b1 = imp.posicion.clone().addScaledVector(eje, medio);
  for (const seg of SEGMENTOS) {
    if (seg.bola) {
      const dentro = bolaDentro(pielDe(seg), b0, b1);
      if (dentro > TOLERANCIA_BARRA) salida.push({ miembro: seg.nombre, metida: dentro });
      continue;
    }
    const a0 = maniqui.esq.huesos[seg.desde].getWorldPosition(new Vector3());
    const a1 = maniqui.esq.huesos[seg.hasta].getWorldPosition(new Vector3());
    if (seg.hastaFraccion) a1.lerp(a0, 1 - seg.hastaFraccion);
    const { p, q } = masCercanos(a0, a1, b0, b1);
    // Lejos de cualquier grosor posible: ni se mide.
    if (p.distanceTo(q) > 0.25) continue;
    const L = a1.distanceTo(a0);
    const dir = a1.clone().sub(a0).divideScalar(L);
    /*
     * El grosor se mide a la altura del punto de la BARRA, y la distancia en perpendicular al hueso.
     * Medirlo en el punto más cercano del hueso fallaba cuando ese punto era un extremo: en lo alto
     * de las dominadas la barra queda por encima del cuello, el punto más cercano del tronco era la
     * base del cuello, y se comparaba con el grosor del pecho de debajo, que sale mucho más: daba
     * la barra 2,7 cm «dentro» del tronco con el trazado de rayos diciendo que estaba fuera.
     */
    const tq = q.clone().sub(a0).dot(dir);
    const hacia = q.clone().sub(a0).addScaledVector(dir, -tq);
    const d = hacia.length();
    // Si la barra pasa por el propio hueso no hay dirección: vale el grosor medio en todas.
    const centrada = d < 1e-4;
    if (!centrada) hacia.normalize();
    // Ver CÓMO SE MIDE EL GROSOR, arriba.
    let suma = 0;
    let pesos = 0;
    const w = new Vector3();
    for (const v of pielDe(seg)) {
      w.subVectors(v, a0);
      const t = w.dot(dir);
      if (Math.abs(t - tq) > GROSOR_FRANJA) continue;
      w.addScaledVector(dir, -t);
      const radio = w.length();
      if (radio < 1e-4) continue;
      let peso = Math.exp(-0.5 * ((t - tq) / GROSOR_SIGMA_EJE) ** 2);
      if (!centrada) {
        // Acotado por los dos lados: un vértice justo a la espalda del eje daba un coseno de -1,0000001,
        // `acos` devolvía NaN, la media salía NaN y NaN > tolerancia es falso, así que el miembro
        // entero dejaba de comprobarse en ese fotograma (pasaba con el cuello en la sentadilla).
        const angulo = Math.acos(Math.max(-1, Math.min(1, w.dot(hacia) / radio)));
        if (angulo > GROSOR_ANGULO_MAX) continue;
        peso *= Math.exp(-0.5 * (angulo / GROSOR_SIGMA_ANGULO) ** 2);
      }
      suma += peso * radio;
      pesos += peso;
    }
    // Menos de un vértice «entero» no es una medida: pasa fuera del miembro, por encima o por debajo.
    if (pesos < 1) continue;
    const dentro = suma / pesos - d;
    if (dentro > TOLERANCIA_BARRA) salida.push({ miembro: seg.nombre, metida: dentro });
  }
  return salida;
}

/**
 * Cuánto se mete la barra en la cabeza, en metros (negativo: cuánto le falta); `null` si ni se acerca.
 *
 * La cabeza se mide como una bola, no como un cilindro sobre su hueso. `DEF-head` no tiene hijo, así
 * que el segmento había que inventárselo hasta la coronilla, y con la barra ENCIMA de la cabeza —
 * colgado en la dominada— el eje del segmento apuntaba a la barra, la distancia en perpendicular
 * salía casi 0 y daba la barra 4,4 cm «dentro» con 3,6 cm de aire según los rayos. Aquí se mira
 * desde el centro de la cabeza (la media de sus vértices) hacia el punto más cercano de la barra, y
 * el radio de la piel en esa dirección es la media ponderada de sus vértices, con la misma campana
 * de ángulo que los miembros. Se queda entre 0,5 y 2 cm por debajo de los rayos (más junto a la
 * barbilla, que sobresale), y ve igual la barra por encima, por delante de la cara o bajo la
 * barbilla. Una barra que pasa por delante de la cara, como en el
 * jalón, queda a más de 25 cm del centro y ni se mide; la de la sentadilla, en el trapecio, se
 * queda a 12 cm de la piel de la cabeza.
 */
function bolaDentro(piel, b0, b1) {
  const c = new Vector3();
  for (const v of piel) c.add(v);
  c.divideScalar(piel.length);
  const eje = b1.clone().sub(b0);
  const q = b0.clone().addScaledVector(eje, Math.min(1, Math.max(0, c.clone().sub(b0).dot(eje) / eje.lengthSq())));
  const d = q.distanceTo(c);
  if (d > 0.25) return null;
  const hacia = q.clone().sub(c).divideScalar(d);
  let suma = 0;
  let pesos = 0;
  const w = new Vector3();
  for (const v of piel) {
    w.subVectors(v, c);
    const radio = w.length();
    const angulo = Math.acos(Math.max(-1, Math.min(1, w.dot(hacia) / radio)));
    if (angulo > GROSOR_ANGULO_MAX) continue;
    const peso = Math.exp(-0.5 * (angulo / GROSOR_SIGMA_ANGULO) ** 2);
    suma += peso * radio;
    pesos += peso;
  }
  if (pesos < 1) return null;
  return suma / pesos - d;
}

/**
 * Cuánto se mete cada miembro en cada volumen del propio cuerpo, en metros, en el fotograma posado.
 * Ver EL CUERPO QUE SE ATRAVIESA A SÍ MISMO, arriba. Devuelve solo las parejas que se tocan.
 *
 * `vertices` es la piel de `verticesPosados(…, 2)`, que ya está posada: de ella salen los vértices
 * que se prueban y las cajas para descartar parejas lejanas. Los volúmenes se miden con TODOS sus
 * vértices (`verticesDeHuesos`), y solo los que alguna pareja necesita: con la mitad, una franja de
 * 3 cm y 30° del muslo se quedaba con uno o ningún vértice y el radio saltaba.
 */
function autocolision(vertices) {
  const h = maniqui.esq.huesos;
  const porHueso = new Map();
  for (const v of vertices) {
    if (!porHueso.has(v.hueso)) porHueso.set(v.hueso, []);
    porHueso.get(v.hueso).push(v);
  }
  const perfiles = new Map(); // nombre del volumen → sus cápsulas medidas, o la bola de la cabeza
  const perfilDe = (nombre) => {
    if (!perfiles.has(nombre)) {
      const def = VOLUMENES[nombre];
      perfiles.set(nombre, def === 'bola'
        ? { bola: verticesDeHuesos(maniqui, ['DEF-head']) }
        : def.map((p) => {
          if (!p.hueso) return perfilCapsula(p.desde(h).getWorldPosition(new Vector3()), p.hasta(h).getWorldPosition(new Vector3()), verticesDeHuesos(maniqui, p.huesos));
          // Un hueso suelto de la mano: su eje es su Y, como en todos los huesos que salen de Blender.
          const hueso = maniqui.escena.getObjectByName(p.hueso);
          const a0 = hueso.getWorldPosition(new Vector3());
          const a1 = new Vector3(0, 1, 0).applyQuaternion(hueso.getWorldQuaternion(new Quaternion())).add(a0);
          return perfilCapsula(a0, a1, verticesDeHuesos(maniqui, p.huesos), p.recortar);
        }));
    }
    return perfiles.get(nombre);
  };
  const cajaVolumen = new Map();
  const cajaDe = (nombre) => {
    if (!cajaVolumen.has(nombre)) {
      const def = VOLUMENES[nombre];
      const huesos = def === 'bola' ? ['DEF-head'] : def.flatMap((p) => p.huesos);
      cajaVolumen.set(nombre, caja(huesos.flatMap((n) => porHueso.get(n) ?? []), 0.03));
    }
    return cajaVolumen.get(nombre);
  };

  const salida = [];
  for (const m of MIEMBROS_CHOQUE) {
    let piel;
    let a0;
    let dir;
    let L;
    if (m.mano) {
      piel = [...porHueso].filter(([hueso, vs]) => vs[0].mano && hueso.endsWith(m.mano))
        .flatMap(([, vs]) => vs.filter((_, n) => n % m.paso === 0));
    } else {
      piel = m.huesos.flatMap((n) => porHueso.get(n) ?? []);
      a0 = h[m.desde].getWorldPosition(new Vector3());
      dir = h[m.hasta].getWorldPosition(new Vector3()).sub(a0);
      L = dir.length();
      dir.divideScalar(L);
    }
    for (const [volumen, desdeFraccion] of Object.entries(m.contra)) {
      const cv = cajaDe(volumen);
      // Solo los vértices de la parte del miembro que se mira, y dentro de la caja del volumen.
      const candidatos = piel.filter((v) => dentroDeCaja(cv, v)
        && (!desdeFraccion || ((v.x - a0.x) * dir.x + (v.y - a0.y) * dir.y + (v.z - a0.z) * dir.z) / L >= desdeFraccion));
      if (candidatos.length < 3) continue;
      const perfil = perfilDe(volumen);
      const hundidos = [];
      for (const v of candidatos) {
        let metida = -Infinity;
        if (perfil.bola) metida = hundidoEnBola(perfil.bola, v);
        else for (const c of perfil) metida = Math.max(metida, hundidoEnCapsula(c, v));
        if (metida > 0) hundidos.push(metida);
      }
      if (hundidos.length < 3) continue;
      hundidos.sort((a, b) => b - a);
      salida.push({ miembro: m.nombre, femenino: m.femenino, volumen, metida: hundidos[2] });
    }
  }
  return salida;
}

/**
 * El perfil de una cápsula: radio medio de la piel por franja a lo largo del eje a0→a1 y por sector
 * alrededor de él. Los sectores se cuentan desde un perpendicular cualquiera: el perfil y las
 * consultas son del mismo fotograma, así que basta con que sea el mismo.
 */
function perfilCapsula(a0, a1, piel, recortar = false) {
  const L = a1.distanceTo(a0);
  const dir = a1.clone().sub(a0).divideScalar(L);
  const ref = Math.abs(dir.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const u = ref.clone().cross(dir).normalize();
  const w = dir.clone().cross(u);
  const c = { a0, dir, u, w, tmin: Infinity, tmax: -Infinity, recortar, franjas: 0, bins: null };
  const locales = piel.map((v) => local(c, v));
  for (const [t] of locales) c.tmin = Math.min(c.tmin, t);
  const tmax = Math.max(...locales.map(([t]) => t));
  c.tmax = tmax;
  c.franjas = Math.floor((tmax - c.tmin) / PERFIL_FRANJA) + 1;
  c.bins = Array.from({ length: c.franjas * PERFIL_SECTORES }, () => ({ n: 0, t: 0, r: 0 }));
  for (const [t, ang, r] of locales) {
    const b = c.bins[Math.floor((t - c.tmin) / PERFIL_FRANJA) * PERFIL_SECTORES + sector(ang)];
    b.n += 1;
    b.t += t;
    b.r += r;
  }
  for (const b of c.bins) if (b.n) { b.t /= b.n; b.r /= b.n; }
  return c;
}

/** Un punto en coordenadas de la cápsula: [a lo largo del eje, ángulo alrededor, distancia al eje]. */
function local(c, v) {
  // Sin vectores intermedios: se llama miles de veces por fotograma.
  const dx = v.x - c.a0.x, dy = v.y - c.a0.y, dz = v.z - c.a0.z;
  const t = dx * c.dir.x + dy * c.dir.y + dz * c.dir.z;
  const x = dx * c.u.x + dy * c.u.y + dz * c.u.z;
  const y = dx * c.w.x + dy * c.w.y + dz * c.w.z;
  return [t, Math.atan2(y, x), Math.hypot(x, y)];
}

function sector(ang) {
  return ((Math.floor((ang + Math.PI) / (2 * Math.PI) * PERFIL_SECTORES) % PERFIL_SECTORES) + PERFIL_SECTORES) % PERFIL_SECTORES;
}

/**
 * Cuánto queda el punto `v` por dentro de la piel de la cápsula (negativo: por fuera; -Infinity si
 * cae fuera de su largo). El radio es la media de las franjas y sectores vecinos, con campanas de
 * 2 cm y 20°: con la franja sola, el radio cambiaba a saltos al pasar de una a otra.
 */
function hundidoEnCapsula(c, v) {
  const [t, ang, r] = local(c, v);
  // Una falange mide 2-4 cm: sin recortar, la franja de más allá de la punta daba «dentro» a lo
  // que solo toca la yema.
  if (c.recortar && (t < c.tmin || t > c.tmax)) return -Infinity;
  const f = Math.floor((t - c.tmin) / PERFIL_FRANJA);
  if (f < -1 || f > c.franjas) return -Infinity;
  const s = sector(ang);
  let suma = 0;
  let pesos = 0;
  for (let df = -1; df <= 1; df += 1) {
    const ff = f + df;
    if (ff < 0 || ff >= c.franjas) continue;
    for (let ds = -1; ds <= 1; ds += 1) {
      const b = c.bins[ff * PERFIL_SECTORES + ((s + ds + PERFIL_SECTORES) % PERFIL_SECTORES)];
      if (!b.n) continue;
      // El centro del sector frente al ángulo del punto, con la vuelta: -179° y 179° están a 2°.
      const centro = ((s + ds + 0.5) / PERFIL_SECTORES) * 2 * Math.PI - Math.PI;
      const da = Math.atan2(Math.sin(ang - centro), Math.cos(ang - centro));
      const peso = b.n * Math.exp(-0.5 * ((t - b.t) / PERFIL_SIGMA_EJE) ** 2 - 0.5 * (da / PERFIL_SIGMA_ANGULO) ** 2);
      suma += peso * b.r;
      pesos += peso;
    }
  }
  // Menos de un vértice «entero» no es una medida: el punto queda más allá del final de la piel.
  if (pesos < 1) return -Infinity;
  return suma / pesos - r;
}

/** Lo mismo con la cabeza, que es una bola: radio de su piel en la dirección del punto. */
function hundidoEnBola(piel, v) {
  if (!piel.centro) {
    piel.centro = new Vector3();
    for (const p of piel) piel.centro.add(p);
    piel.centro.divideScalar(piel.length);
  }
  const d = v.distanceTo(piel.centro);
  if (d > 0.2 || d < 1e-4) return -Infinity;
  const hacia = v.clone().sub(piel.centro).divideScalar(d);
  let suma = 0;
  let pesos = 0;
  const w = new Vector3();
  for (const p of piel) {
    w.subVectors(p, piel.centro);
    const radio = w.length();
    const angulo = Math.acos(Math.max(-1, Math.min(1, w.dot(hacia) / radio)));
    if (angulo > GROSOR_ANGULO_MAX) continue;
    const peso = Math.exp(-0.5 * (angulo / GROSOR_SIGMA_ANGULO) ** 2);
    suma += peso * radio;
    pesos += peso;
  }
  if (pesos < 1) return -Infinity;
  return suma / pesos - d;
}

function caja(puntos, margen) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of puntos) { min.min(p); max.max(p); }
  return { min: min.subScalar(margen), max: max.addScalar(margen) };
}

function dentroDeCaja({ min, max }, v) {
  return v.x >= min.x && v.x <= max.x && v.y >= min.y && v.y <= max.y && v.z >= min.z && v.z <= max.z;
}

/** Puntos más cercanos entre los segmentos a0-a1 y b0-b1; `s` es la fracción del primero. */
function masCercanos(a0, a1, b0, b1) {
  const u = a1.clone().sub(a0);
  const v = b1.clone().sub(b0);
  const w = a0.clone().sub(b0);
  const a = u.dot(u), b = u.dot(v), c = v.dot(v), d = u.dot(w), e = v.dot(w);
  const den = a * c - b * b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b * e - c * d) / den)) : 0;
  let t = (b * s + e) / c;
  if (t < 0 || t > 1) {
    t = Math.min(1, Math.max(0, t));
    s = Math.min(1, Math.max(0, (t * b - d) / a));
  }
  return { p: a0.clone().addScaledVector(u, s), q: b0.clone().addScaledVector(v, t), s };
}

/**
 * Las parejas de implementos metidas una en otra más de TOLERANCIA_IMPLEMENTOS. Ver UN IMPLEMENTO
 * DENTRO DE OTRO, arriba.
 */
function implementosMetidos(implementos) {
  const salida = [];
  const lista = Object.entries(implementos).filter(([, imp]) => PIEZAS_CILINDRO[imp.tipo] || imp.tipo === 'banco');
  for (let a = 0; a < lista.length; a += 1) {
    for (let b = a + 1; b < lista.length; b += 1) {
      let [[na, ia], [nb, ib]] = [lista[a], lista[b]];
      if (ia.tipo === 'banco' && ib.tipo === 'banco') continue;
      if (ia.tipo === 'banco') [[na, ia], [nb, ib]] = [[nb, ib], [na, ia]];
      const piezasA = cilindrosDe(ia);
      let metida = 0;
      if (ib.tipo === 'banco') {
        // Solo lo que cae sobre el ancho del banco: de los 2,2 m de la barra, casi nada, y así no se
        // rehace la geometría del banco en miles de puntos que quedan a un lado.
        const medio = ib.ancho / 2;
        for (const p of piezasA) sembrar(p, (v) => { if (Math.abs(v.x - ib.posicion.x) < medio) metida = Math.max(metida, profundidad(ib, v)); });
      } else {
        for (const p of piezasA) {
          for (const q of cilindrosDe(ib)) {
            if (p.c.distanceTo(q.c) > Math.hypot(p.r, p.h) + Math.hypot(q.r, q.h)) continue;
            sembrar(p, (v) => { metida = Math.max(metida, hondoEnCilindro(q, v)); });
            sembrar(q, (v) => { metida = Math.max(metida, hondoEnCilindro(p, v)); });
          }
        }
      }
      if (metida > TOLERANCIA_IMPLEMENTOS) salida.push({ msg: `${na} metida en ${nb}`, metida });
    }
  }
  return salida;
}

/** Las piezas de un implemento como cilindros en el mundo: centro `c`, eje `u`, radio y medio largo. */
function cilindrosDe(imp) {
  const u = new Vector3(1, 0, 0).applyQuaternion(imp.orientacion ?? new Quaternion());
  return PIEZAS_CILINDRO[imp.tipo].map(([r, h, x]) => ({ r, h, u, c: imp.posicion.clone().addScaledVector(u, x) }));
}

/** Cuánto le falta a un punto para salir del cilindro, por el lado o por la tapa (≤ 0: fuera). */
function hondoEnCilindro(cil, v) {
  const w = v.clone().sub(cil.c);
  const a = w.dot(cil.u);
  const radial = Math.sqrt(Math.max(0, w.lengthSq() - a * a));
  return Math.min(cil.r - radial, cil.h - Math.abs(a));
}

/** Llama a `cada` con puntos repartidos por el volumen del cilindro: anillos cada 2 cm por el eje. */
function sembrar(cil, cada) {
  const perp = Math.abs(cil.u.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  const e1 = perp.cross(cil.u).normalize();
  const e2 = cil.u.clone().cross(e1);
  const anillos = Math.max(3, Math.ceil((2 * cil.h) / 0.02) + 1);
  const v = new Vector3();
  for (let n = 0; n < anillos; n += 1) {
    const a = -cil.h + (2 * cil.h * n) / (anillos - 1);
    cada(v.copy(cil.c).addScaledVector(cil.u, a));
    for (const radio of [cil.r / 2, cil.r]) {
      for (let k = 0; k < 12; k += 1) {
        const ang = (k * Math.PI) / 6;
        cada(v.copy(cil.c).addScaledVector(cil.u, a).addScaledVector(e1, radio * Math.cos(ang)).addScaledVector(e2, radio * Math.sin(ang)));
      }
    }
  }
}

/** Pone palabras a un aviso de la cinemática, que informa con datos. */
function redactar(aviso) {
  const parte = { mano: 'La mano', pie: 'El pie' }[aviso.miembro];
  const lado = { i: 'izquierda', d: 'derecha' }[aviso.lado];
  if (aviso.tipo === 'recorte') {
    // Con un decimal: este aviso salta con medio centímetro, y "0 cm" no dice nada.
    return `${parte} ${lado} tendría que ir ${(aviso.falta * 100).toFixed(1)} cm más lejos de lo que da el brazo: el implemento está demasiado lejos y la mano lo suelta`;
  }
  return `${parte} ${lado} no llega a su objetivo: faltan ${(aviso.falta * 100).toFixed(0)} cm`;
}

/** Cuánto se mete un punto dentro de un implemento sólido (0 si está fuera). */
function profundidad(imp, v) {
  if (imp.tipo === 'banco') {
    /*
     * El banco inclinado es la UNIÓN de dos cajas: el asiento, de pie en el suelo como el banco
     * plano, y el respaldo girado. Dentro de una unión, lo hundido es lo más hundido en cualquiera
     * de las dos. Ver `geometriaBanco` en la cinemática, que es de donde sale la forma.
     */
    const g = geometriaBanco(imp);
    const dx = g.ancho / 2 - Math.abs(v.x - imp.posicion.x);
    const z = v.z - imp.posicion.z;
    const dy = imp.posicion.y + g.alto - v.y;
    const asiento = Math.max(0, Math.min(dx, dy, z - g.asiento.z0, g.asiento.z1 - z, v.y - imp.posicion.y));
    if (!g.respaldo) return asiento;
    const { u, h } = enRespaldo(g.respaldo, z, v.y - imp.posicion.y);
    const respaldo = Math.max(0, Math.min(dx, u, g.respaldo.largo - u, -h, h + g.respaldo.macizo, v.y - imp.posicion.y));
    return Math.max(asiento, respaldo);
  }
  if (imp.tipo === 'pared') {
    // Caja de pie apoyada en el suelo: crece hacia arriba desde `posicion`, como la dibuja el visor.
    const dx = imp.ancho / 2 - Math.abs(v.x - imp.posicion.x);
    const dz = imp.grosor / 2 - Math.abs(v.z - imp.posicion.z);
    const dy = imp.posicion.y + imp.alto - v.y;
    return Math.max(0, Math.min(dx, dy, dz, v.y - imp.posicion.y));
  }
  if (imp.tipo === 'barra' || imp.tipo === 'barra_fija' || imp.tipo === 'polea') {
    // Cilindro a lo largo de X. El medio ancho sale del implemento cuando lo declara —el agarre de
    // una polea mide 20 cm, no 2,2 m— para no dar por buena una mano metida en el aire de al lado.
    const medio = imp.tipo === 'polea' ? ((imp.ancho ?? 1.1) / 2) : 1.1;
    if (Math.abs(v.x - imp.posicion.x) > medio) return 0;
    const d = Math.hypot(v.y - imp.posicion.y, v.z - imp.posicion.z);
    return Math.max(0, 0.014 - d);
  }
  return 0;
}

/**
 * Un punto en coordenadas del respaldo: `u`, lo que ha subido por él desde el pivote, y `h`, su
 * altura sobre la superficie (negativa: por dentro). `z` e `y` van relativos a `posicion`.
 */
function enRespaldo(respaldo, z, y) {
  const pz = z - respaldo.pivote.z;
  const py = y - respaldo.pivote.y;
  return { u: pz * respaldo.d.z + py * respaldo.d.y, h: pz * respaldo.n.z + py * respaldo.n.y };
}

/**
 * Qué superficie del banco mide un apoyo. En el plano solo hay una, así que `con` no cambia nada
 * y los movimientos que ya existían se miden igual que siempre. En el inclinado, `con: "espalda"`
 * o `"pecho"` (el remo con pecho apoyado) es el respaldo; sin `con`, o con `"asiento"`, el asiento;
 * cualquier otra cosa (`"manos"`, `"pies"`), el que quede más cerca.
 *
 * Sin esto el apoyo miraba la altura sobre el asiento de todo lo que caía encima, y en un respaldo
 * a 45° la espalda está a 30-60 cm por encima del asiento aunque esté pegada al acolchado.
 */
function zonaDeApoyo(imp, con) {
  if (!geometriaBanco(imp).respaldo) return 'todo';
  if (con === 'espalda' || con === 'pecho') return 'respaldo';
  if (!con || con === 'asiento') return 'asiento';
  return 'todo';
}

/**
 * Altura de un punto sobre la superficie de apoyo del banco (negativa: hundido), o `null` si no cae
 * encima de ella. «Encima» es dentro de la huella y a menos de 15 cm, contados en vertical sobre el
 * asiento y en la normal sobre el respaldo.
 */
function sobreBanco(imp, v, zona) {
  const g = geometriaBanco(imp);
  if (Math.abs(v.x - imp.posicion.x) >= g.ancho / 2) return null;
  const z = v.z - imp.posicion.z;
  const y = v.y - imp.posicion.y;
  let mejor = null;
  if (zona !== 'respaldo' && z > g.asiento.z0 && z < g.asiento.z1 && y < g.alto + 0.15) mejor = y - g.alto;
  if (zona !== 'asiento' && g.respaldo) {
    const { u, h } = enRespaldo(g.respaldo, z, y);
    if (u > 0 && u < g.respaldo.largo && h < 0.15 && h > -g.respaldo.macizo) mejor = mejor === null ? h : Math.min(mejor, h);
  }
  return mejor;
}

if (errores) {
  console.log(`\n${errores} problema(s). El movimiento no se publica así.`);
  process.exit(1);
}
