/**
 * Cinemática del maniquí: de una pose escrita en términos anatómicos a rotaciones de huesos.
 *
 * Es JavaScript y no TypeScript a propósito: lo importan el visor (con Vite) y el validador (con
 * `node` a secas, sin compilar). Si viviera en .ts, el validador necesitaría otro paso de
 * compilación, y un validador que hay que preparar antes de ejecutarlo acaba sin ejecutarse.
 *
 * POR QUÉ ÁNGULOS ANATÓMICOS Y NO CUATERNIONES. Quien escribe la pose —una persona o un agente—
 * razona en "flexión de cadera de 95°", no en rotaciones de hueso. Y el validador puede comprobar
 * esos números contra los rangos articulares reales; un cuaternión no se puede revisar a ojo.
 *
 * EL TRUCO QUE LO HACE POSIBLE: la postura neutra. El esqueleto de Quaternius descansa en T, con
 * cada hueso orientado a su manera. Al cargar, se calcula para cada segmento su orientación
 * "neutra" —de pie, brazos colgando, palmas hacia los muslos— y a partir de ahí cada articulación
 * es solo una rotación en ejes del cuerpo: X hacia la izquierda del maniquí, Y arriba, Z hacia
 * donde mira. Un segmento posado es W = F · N, donde N es su neutra y F el marco acumulado.
 */

import { Matrix4, Quaternion, Vector3 } from 'three';

const GRAD = Math.PI / 180;

/** `i` es la izquierda DEL MANIQUÍ, que mira a +Z; por eso está en +X. Los huesos .L de Quaternius. */
export const LADOS = ['i', 'd'];
const SUFIJO = { i: 'L', d: 'R' };
const SIGNO = { i: 1, d: -1 };

const RADIO_BARRA = 0.014;

/*
 * DÓNDE CAE EL HUECO DEL PUÑO. Medido sobre el modelo, no estimado, y en dos pasadas:
 *
 *  1. La primera miró dónde queda cada falange y puso el agarre "entre el nudillo y la segunda".
 *     Mejor que el medio palmo que había antes, pero seguía sin cuadrar: lo que importa no es dónde
 *     está cada hueso, sino el centro del ARO que forman los tres al curvarse.
 *  2. La segunda calcula ese centro —el circuncentro de nudillo, falange media y punta— y sale otra
 *     cosa: 11,3 cm de avance, no 13, y bastante más hundido hacia la palma.
 *
 * El avance NO depende de cuánto se cierre la mano: el centro del aro se queda en la línea de los
 * nudillos pase lo que pase. El hondo sí, y mucho —de 4,5 cm con la mano entreabierta a 3,2 con el
 * puño cerrado del todo—, porque al cerrarse el aro se hace pequeño y su centro sube hacia la
 * palma. La recta está ajustada sobre cuatro medidas entre 0,7 y 1.
 */
const AVANCE_AGARRE = 0.113;
const hondoAgarre = (cierre) => 0.0753 - 0.0433 * cierre;
/** Grosor de la almohadilla del pie: lo que queda entre la articulación de los dedos y el suelo. */
const ALTURA_ALMOHADILLA = 0.028;

const ABAJO = new Vector3(0, -1, 0);
const DELANTE = new Vector3(0, 0, 1);
const DETRAS = new Vector3(0, 0, -1);

/*
 * Ejes de cada movimiento. Se derivan de la regla k × v: girar v alrededor de k lleva v hacia k × v.
 * Están calculados, no probados a ojo: cuando un signo sale al revés, el fallo está en la pregunta
 * "¿hacia dónde va este segmento?", y ahí es donde hay que mirar.
 */
const EJE = {
  flexionMiembro: new Vector3(-1, 0, 0), // miembro colgando → hacia delante (hombro, cadera, codo)
  flexionRodilla: new Vector3(1, 0, 0), //  pierna → hacia atrás
  flexionTronco: new Vector3(1, 0, 0), //   eje vertical → hacia delante
  lateralTronco: new Vector3(0, 0, 1), //   eje vertical → hacia la derecha (−X)
  rotacionTronco: new Vector3(0, 1, 0), //  mirada → hacia la izquierda (+X)
  dorsiflexion: new Vector3(-1, 0, 0), //   punta del pie → arriba
};

/** Rangos articulares, en grados. De la tabla de la AAOS con margen: esto caza poses imposibles, no técnica mejorable. */
export const RANGOS = {
  /*
   * 185 y no 180 arriba. La flexión de hombro de un manual llega a 180°, pero ahí el húmero no va
   * solo: los últimos grados del bloqueo por encima de la cabeza los pone la escápula girando, y
   * este esqueleto no tiene escápula. Sin ese margen, el press militar quedaba en 183° —el brazo
   * un pelo por detrás de la vertical, que es exactamente donde acaba un press— y no se publicaba.
   */
  'hombro.flexion': [-60, 185],
  'hombro.abduccion': [-30, 180],
  'hombro.rotacion': [-90, 90],
  /*
   * La escápula, movida a través de la clavícula. Este esqueleto no tiene omóplato, y sin él el
   * hombro no se podía bajar ni adelantar: el peso muerto no llegaba a la barra en el suelo sin
   * redondear la espalda o sin sentarse como en una sentadilla, porque una persona real alcanza
   * esa barra en parte bajando y adelantando los hombros. Rangos de la clavícula: elevación hasta
   * unos 35°, depresión unos 10°, protracción y retracción unos 20° a cada lado.
   */
  'escapula.elevacion': [-10, 35],
  'escapula.protraccion': [-20, 20],
  /*
   * Pronosupinación del antebrazo, para las manos que llevan una mancuerna: 0 es la palma hacia la
   * línea media, +90 hacia delante (prona) y -90 hacia atrás (supina). Antes solo había dos agarres
   * fijos, neutro y prono, y el press Arnold —cuyo gesto ES girar la palma de la cara hacia
   * delante— cambiaba de uno a otro de golpe en un fotograma, y a medias.
   */
  'antebrazo.pronacion': [-90, 90],
  'codo.flexion': [0, 150],
  'muneca.extension': [-80, 95],
  'cadera.flexion': [-30, 130],
  'cadera.abduccion': [-30, 50],
  'cadera.rotacion': [-45, 45],
  'rodilla.flexion': [0, 155],
  'tobillo.dorsiflexion': [-50, 40],
  /* Los dedos del pie doblan hasta unos 80° al apoyar sobre el metatarso; más es una lesión. */
  'dedos.flexion': [0, 85],
  'columna.flexion': [-30, 80],
  'columna.lateral': [-35, 35],
  'columna.rotacion': [-45, 45],
  'cuello.flexion': [-60, 50],
};

/* ---------------------------------------------------------------- utilidades de vector -- */

const v3 = (a) => new Vector3(a[0], a[1], a[2]);
/** Sentido de giro de la clavícula en cada lado, medido: positivo eleva y adelanta el hombro. */
/** Sentido del giro del antebrazo en cada lado, medido: positivo lleva la palma hacia delante. */
const SIGNO_PRONACION = { i: 1, d: -1 };

const SIGNO_ESCAPULA = { elevacion: { i: 1, d: -1 }, protraccion: { i: -1, d: 1 } };

const eje = (k, grados) => new Quaternion().setFromAxisAngle(k, grados * GRAD);

/** Cuaternión que lleva la pareja (a0, b0) a (a1, b1). Ambas parejas, unitarias y perpendiculares. */
function mapearBase(a0, b0, a1, b1) {
  const m0 = new Matrix4().makeBasis(a0, b0, new Vector3().crossVectors(a0, b0));
  const m1 = new Matrix4().makeBasis(a1, b1, new Vector3().crossVectors(a1, b1));
  return new Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose()));
}

/** Parte de `v` perpendicular a `u` (unitario), normalizada; `null` si no hay. */
function perpendicular(v, u) {
  const p = v.clone().addScaledVector(u, -v.dot(u));
  return p.lengthSq() < 1e-8 ? null : p.normalize();
}

/* ------------------------------------------------------------------------- esqueleto -- */

/**
 * Localiza los huesos y calcula la postura neutra de cada segmento.
 *
 * OJO con los nombres: GLTFLoader quita los puntos (`DEF-spine.001` llega como `DEF-spine001`).
 * La primera lectura del esqueleto falló justo por eso.
 */
export function prepararEsqueleto(modelo) {
  modelo.updateMatrixWorld(true);
  const buscar = (nombre) => {
    const h = modelo.getObjectByName(nombre);
    if (!h) throw new Error(`El modelo no tiene el hueso ${nombre}`);
    return h;
  };

  const huesos = {
    pelvis: buscar('DEF-hips'),
    columna: ['DEF-spine001', 'DEF-spine002', 'DEF-spine003'].map(buscar),
    cuello: buscar('DEF-neck'),
    cabeza: buscar('DEF-head'),
  };
  for (const l of LADOS) {
    const s = SUFIJO[l];
    Object.assign(huesos, {
      [`clavicula_${l}`]: buscar(`DEF-shoulder${s}`),
      [`brazo_${l}`]: buscar(`DEF-upper_arm${s}`),
      [`antebrazo_${l}`]: buscar(`DEF-forearm${s}`),
      [`mano_${l}`]: buscar(`DEF-hand${s}`),
      [`muslo_${l}`]: buscar(`DEF-thigh${s}`),
      [`pierna_${l}`]: buscar(`DEF-shin${s}`),
      [`pie_${l}`]: buscar(`DEF-foot${s}`),
      [`dedos_pie_${l}`]: buscar(`DEF-toe${s}`),
      [`falanges_${l}`]: ['index', 'middle', 'ring', 'pinky', 'thumb'].flatMap((d) =>
        ['01', '02', '03'].map((n) => buscar(`DEF-${d === 'thumb' ? 'thumb' : 'f_' + d}${n}${s}`)),
      ),
    });
  }

  // Todo hueso guarda su rotación de reposo: cada fotograma parte de ahí, y así lo que una pose no
  // menciona no arrastra lo que dejó la anterior.
  const reposo = new Map();
  modelo.traverse((o) => { if (o.isBone) reposo.set(o, o.quaternion.clone()); });

  const neutra = new Map();
  const mundo = (h) => h.getWorldQuaternion(new Quaternion());
  const direccion = (h) => new Vector3(0, 1, 0).applyQuaternion(mundo(h));
  const enderezar = (h, hacia) =>
    neutra.set(h, new Quaternion().setFromUnitVectors(direccion(h), hacia).multiply(mundo(h)));

  for (const h of [huesos.pelvis, ...huesos.columna, huesos.cuello, huesos.cabeza]) neutra.set(h, mundo(h));
  for (const l of LADOS) {
    neutra.set(huesos[`clavicula_${l}`], mundo(huesos[`clavicula_${l}`]));
    for (const seg of ['brazo', 'antebrazo', 'mano', 'muslo', 'pierna']) enderezar(huesos[`${seg}_${l}`], ABAJO);
    neutra.set(huesos[`pie_${l}`], mundo(huesos[`pie_${l}`]));
    // Los dedos también: sin su neutra, orientarlos reventaba con un error que solo decía "_x".
    neutra.set(huesos[`dedos_pie_${l}`], mundo(huesos[`dedos_pie_${l}`]));
  }

  const distancia = (a, b) => a.getWorldPosition(new Vector3()).distanceTo(b.getWorldPosition(new Vector3()));
  const longitudes = {
    pie: distancia(huesos.pie_i, huesos.dedos_pie_i),
    brazo: distancia(huesos.brazo_i, huesos.antebrazo_i),
    antebrazo: distancia(huesos.antebrazo_i, huesos.mano_i),
    muslo: distancia(huesos.muslo_i, huesos.pierna_i),
    pierna: distancia(huesos.pierna_i, huesos.pie_i),
  };

  return { modelo, huesos, reposo, neutra, longitudes, raiz: huesos.pelvis.parent };
}

/* ------------------------------------------------------------------------------ pose -- */

/** Coloca un hueso con el marco F: rotación de mundo W = F · N, convertida a local. */
function orientar(esq, hueso, F) {
  const W = F.clone().multiply(esq.neutra.get(hueso));
  const padre = hueso.parent.getWorldQuaternion(new Quaternion());
  hueso.quaternion.copy(padre.invert().multiply(W));
  hueso.updateMatrixWorld(true);
}

const posicion = (h) => h.getWorldPosition(new Vector3());

/**
 * Dorsiflexión anatómica: 0 es el pie en ángulo recto con la pierna, que es como se está de pie.
 *
 * Antes se medía con un atan2 en el plano del pie, y con el cuerpo tumbado —una flexión, una
 * plancha— daba 59° donde no hay 59° de nada: el tobillo estaba en su sitio y la cuenta no.
 */
function dorsiflexionDe(pierna, pie) {
  // `pierna` va de la rodilla al tobillo y `pie` del tobillo a los dedos. De pie forman 90°; cuando
  // la espinilla se adelanta el ángulo crece (dorsiflexión) y de puntillas se cierra (plantar).
  const entre = Math.acos(Math.min(1, Math.max(-1, pierna.dot(pie)))) / GRAD;
  return entre - 90;
}

/** Hacia dónde apunta un hueso en su postura neutra: su eje largo, en el mundo. */
function direccionNeutra(esq, hueso) {
  return new Vector3(0, 1, 0).applyQuaternion(esq.neutra.get(hueso));
}

function rotacionTronco(r = {}, parte = 1) {
  return eje(EJE.flexionTronco, (r.flexion ?? 0) * parte)
    .multiply(eje(EJE.lateralTronco, (r.lateral ?? 0) * parte))
    .multiply(eje(EJE.rotacionTronco, (r.rotacion ?? 0) * parte));
}

/** Rotación de una articulación esférica (hombro, cadera) en el marco de su padre. */
function rotacionEsferica(r = {}, lado) {
  const s = SIGNO[lado];
  return eje(EJE.flexionMiembro, r.flexion ?? 0)
    .multiply(eje(new Vector3(0, 0, s), r.abduccion ?? 0))
    .multiply(eje(new Vector3(0, s, 0), r.rotacion ?? 0));
}

/**
 * Cinemática inversa de dos huesos con vector de polo.
 *
 * `polo` es hacia dónde apunta el codo o la rótula. Sin él la solución no es única —hay un círculo
 * entero de codos posibles— y el solver elegiría uno cualquiera, rodillas hacia dentro incluidas,
 * que es justo el fallo de técnica que una ficha de sentadilla advierte.
 */
function resolverDosHuesos({ raiz, objetivo, polo, l1, l2, b0 }) {
  const D = objetivo.clone().sub(raiz);
  const pedido = D.length();
  const u = D.normalize();
  const alcance = Math.min(Math.max(pedido, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const p = perpendicular(polo, u) ?? perpendicular(DELANTE, u) ?? perpendicular(new Vector3(1, 0, 0), u);

  const cosA = (l1 * l1 + alcance * alcance - l2 * l2) / (2 * l1 * alcance);
  const senA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const d1 = u.clone().multiplyScalar(cosA).addScaledVector(p, senA);
  const medio = raiz.clone().addScaledVector(d1, l1);
  const d2 = raiz.clone().addScaledVector(u, alcance).sub(medio).normalize();
  const flexion = Math.acos(Math.min(1, Math.max(-1, d1.dot(d2)))) / GRAD;
  // Con el miembro recto no hay plano de flexión; se toma el contrario del polo, que es hacia donde
  // doblaría. Sin esto, un brazo estirado gira sobre sí mismo de un fotograma al siguiente.
  const b1 = flexion < 0.5 ? p.clone().negate() : perpendicular(d2, d1);

  return { F1: mapearBase(ABAJO, b0, d1, b1), flexion, falta: Math.max(0, pedido - (l1 + l2)) };
}

/**
 * Posa el maniquí. Devuelve lo que el validador necesita: ángulos articulares resultantes,
 * objetivos que no se alcanzan y posiciones de los implementos.
 */
export function aplicarPose(esq, pose, definicion = {}) {
  const { huesos, longitudes } = esq;
  const angulos = {};
  const avisos = [];
  const anotar = (lado, clave, valor) => { angulos[`${clave}${lado ? '_' + lado : ''}`] = valor; };

  for (const [hueso, q] of esq.reposo) hueso.quaternion.copy(q);

  /* Pelvis: posición y orientación en el mundo. */
  const o = pose.pelvis?.orientacion ?? {};
  const Fpelvis = eje(new Vector3(0, 1, 0), o.giro ?? 0)
    .multiply(eje(new Vector3(1, 0, 0), o.inclinacion ?? 0))
    .multiply(eje(new Vector3(0, 0, 1), o.ladeo ?? 0));
  esq.raiz.updateWorldMatrix(true, false);
  huesos.pelvis.position.copy(esq.raiz.worldToLocal(v3(pose.pelvis?.posicion ?? [0, 0.917, 0])));
  orientar(esq, huesos.pelvis, Fpelvis);

  /* Columna: el giro se reparte entre las tres vértebras, más en las de arriba, como en un cuerpo. */
  let F = Fpelvis;
  const REPARTO = [0.25, 0.35, 0.4];
  huesos.columna.forEach((h, n) => {
    F = F.clone().multiply(rotacionTronco(pose.columna, REPARTO[n]));
    orientar(esq, h, F);
  });
  for (const k of ['flexion', 'lateral', 'rotacion']) anotar(null, `columna.${k}`, pose.columna?.[k] ?? 0);
  const Ftorax = F;

  /*
   * LA CABEZA NO SE METE EN EL PECHO.
   *
   * La flexión del cuello es RELATIVA AL TRONCO, y eso se olvida en cuanto el tronco se inclina: en
   * una plancha el tronco ya está a 89°, así que unos inocentes -25° de cuello suman 114° y la
   * cabeza acaba dentro de las costillas. Se coló en diez ejercicios —flexiones, plancha, buenos
   * días, peso muerto a una pierna, perro-pájaro…— y en todos se veía igual: un maniquí sin cuello.
   *
   * Lo que se limita es el ángulo de la cabeza CON LA VERTICAL DEL MUNDO, no la flexión escrita.
   * Mirarse el esternón son unos 95° desde erguido, y de ahí no se pasa: con el tronco ya a 89 solo
   * quedan 6° de margen, que es exactamente lo que le queda a alguien en posición de plancha.
   *
   * Se recorta en vez de fallar porque la pose no está "mal": lo natural al escribirla es pensar en
   * la cabeza mirando al suelo, y eso ya lo da el tronco. Y se anota el valor RECORTADO, que es el
   * que de verdad se ve.
   */
  const LIMITE_CABEZA = 95;
  const inclinacionTronco = Math.acos(
    Math.min(1, Math.max(-1, new Vector3(0, 1, 0).applyQuaternion(Ftorax).y)),
  ) / GRAD;
  const margenCuello = Math.max(0, LIMITE_CABEZA - inclinacionTronco);
  const cuello = { ...(pose.cuello ?? {}) };
  if ((cuello.flexion ?? 0) < -margenCuello) cuello.flexion = -margenCuello;

  const Fcuello = Ftorax.clone().multiply(rotacionTronco(cuello));
  orientar(esq, huesos.cuello, Fcuello);
  orientar(esq, huesos.cabeza, Fcuello);
  anotar(null, 'cuello.flexion', cuello.flexion ?? 0);

  const marcos = { mundo: new Quaternion(), pelvis: Fpelvis, torax: Ftorax };

  /* Implementos que dependen del cuerpo (la barra en la espalda) van después del tronco y antes de los brazos. */
  const implementos = colocarImplementos(esq, pose, definicion, marcos);

  for (const l of LADOS) {
    /*
     * La clavícula, con la escápula que se pida: elevar gira alrededor del eje que mira adelante, y
     * protraer, alrededor del vertical. Con el signo del lado, para que el mismo número baje o
     * adelante los dos hombros por igual.
     */
    const escapula = miembro(pose.brazos, l)?.escapula ?? {};
    const Fclavicula = Ftorax.clone()
      .multiply(eje(new Vector3(0, 1, 0), SIGNO_ESCAPULA.protraccion[l] * (escapula.protraccion ?? 0)))
      .multiply(eje(new Vector3(0, 0, 1), SIGNO_ESCAPULA.elevacion[l] * (escapula.elevacion ?? 0)));
    orientar(esq, huesos[`clavicula_${l}`], Fclavicula);
    anotar(l, 'escapula.elevacion', escapula.elevacion ?? 0);
    anotar(l, 'escapula.protraccion', escapula.protraccion ?? 0);
    posarBrazo(esq, pose, l, Ftorax, implementos, anotar, avisos);
    posarPierna(esq, pose, l, Fpelvis, anotar, avisos);
    /*
     * Qué agarra esta mano, si agarra algo: la barra a la que va, o el implemento que lleva. El
     * pulgar lo necesita para rodearlo en vez de cerrarse sobre la palma.
     */
    const m = miembro(pose.brazos, l);
    const llevado = Object.values(implementos).find((i) => i.en_mano === l);
    const agarrado = m?.objetivo === 'barra' && implementos.barra ? ejeDe(implementos.barra)
      : (llevado?.eje ? llevado.eje.clone() : null);
    /* Y dónde está: el pulgar apunta ahí. Para la barra, el punto del agarre de esta mano; para lo
       que se lleva en la mano, el hueco del puño que ya calculó `posarBrazo`. */
    const dondeAgarra = m?.objetivo === 'barra' && implementos.barra
      ? implementos.barra.posicion.clone().addScaledVector(ejeDe(implementos.barra), SIGNO[l] * (implementos.barra.agarre ?? 0.4))
      : (llevado?.punto ? llevado.punto.clone() : null);
    cerrarMano(esq, l, m?.cierre ?? 0, agarrado, dondeAgarra);
  }

  // La mancuerna va en la mano, así que se coloca cuando la mano ya está.
  for (const imp of Object.values(implementos)) {
    if (imp.en_mano && imp.eje) {
      imp.posicion = imp.punto;
      // El eje del cilindro se modela en X, así que basta con llevarlo al eje del mango.
      imp.orientacion = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), imp.eje);
    }
  }

  return { angulos, avisos, implementos };
}

/** Lee el miembro de un lado: `ambos` se refleja en X para el derecho, `i`/`d` mandan si están. */
export function miembro(grupo, lado) {
  if (!grupo) return undefined;
  if (grupo[lado]) return grupo[lado];
  if (!grupo.ambos) return undefined;
  return lado === 'i' ? grupo.ambos : reflejar(grupo.ambos);
}

function reflejar(m) {
  const r = structuredClone(m);
  for (const k of ['objetivo', 'codo_hacia', 'rodilla_hacia']) {
    if (Array.isArray(r[k])) r[k] = [-r[k][0], r[k][1], r[k][2]];
  }
  return r;
}

/** Punto en el mundo a partir de `[x, y, z]` relativo a algo: el mundo, la cadera o el hombro de ese lado. */
function resolverPunto(esq, spec, lado, implementos, raiz) {
  if (spec.objetivo === 'barra') {
    const barra = implementos.barra;
    if (!barra) throw new Error('La mano va a "barra", pero en esta pose no hay barra');
    const A = ejeDe(barra);
    const agarre = barra.posicion.clone().addScaledVector(A, SIGNO[lado] * (barra.agarre ?? 0.4));
    // La muñeca queda a un radio de barra más medio grosor de palma del EJE, y del lado por el que
    // viene el brazo. Antes se restaban 7 cm "hacia el hombro", que en el press de banca dejaba la
    // muñeca por debajo de donde apoya la mano.
    const radial = perpendicular(raiz.clone().sub(agarre), A) ?? DELANTE.clone();
    // El objetivo es la MUÑECA, y la barra tiene que cruzar la PALMA: por eso se suma también el
    // medio palmo que va de la muñeca al centro de la mano. Sin ese sumando, el primer plano
    // enseñaba el puño cerrado al lado de la barra y la barra a la altura de la muñeca.
    return agarre.addScaledVector(radial, AVANCE_AGARRE);
  }
  if (spec.objetivo === 'banco') {
    const banco = implementos.banco;
    // Muñeca 4 cm sobre el acolchado: lo que mide una mano apoyada de canto a canto.
    return banco.posicion.clone().add(v3(spec.desplazamiento ?? [0, 0, 0])).setY(banco.posicion.y + banco.alto + 0.04);
  }
  const base = { mundo: new Vector3(), articulacion: raiz }[spec.relativo_a ?? 'mundo'];
  if (!base) throw new Error(`relativo_a desconocido: ${spec.relativo_a}`);
  return base.clone().add(v3(spec.objetivo));
}

/** Eje del cilindro de un implemento: la barra se modela a lo largo de X y gira con su orientación. */
function ejeDe(imp) {
  return new Vector3(1, 0, 0).applyQuaternion(imp.orientacion ?? new Quaternion());
}

/**
 * Marco de una mano que agarra un cilindro.
 *
 * El fallo que arregla: la mano seguía al antebrazo y punto, así que la palma miraba donde tocara y
 * los dedos se cerraban en puño AL LADO de la barra en vez de rodearla. Una mano que agarra tiene
 * dos condiciones, no una: sigue al antebrazo (eje largo) Y la palma mira al eje del cilindro.
 */
/**
 * La mano sobre una barra: LA BARRA MANDA EN DOS EJES, el antebrazo solo en el tercero.
 *
 * Una mano que agarra no rota sobre el mango. El eje que cruza la palma —por donde pasa la barra—
 * tiene que ser paralelo al eje de la barra en todos los fotogramas del ciclo, y eso no es una
 * preferencia estética: es lo que significa agarrar.
 *
 * La versión anterior tomaba el antebrazo como eje largo de la mano tal cual y dejaba el eje
 * transversal a lo que saliera. Como el antebrazo gira durante el movimiento, la palma se iba
 * saliendo de la barra. MEDIDO con `48` fotogramas por ejercicio: hasta 73° en las dominadas, 66°
 * en el press militar, 41° en el de banca, 29° en la sentadilla. En pantalla eso es un puño que se
 * va retorciendo sobre una barra que no se mueve.
 *
 * Ahora la barra fija dos ejes —el que cruza la palma es el suyo, y la palma mira a la barra— y el
 * antebrazo solo decide hacia dónde apuntan los dedos DENTRO del plano perpendicular a la barra,
 * que es exactamente la libertad que deja una muñeca cerrada sobre un mango.
 */
function marcoAgarre(muneca, imp, Fantebrazo, l) {
  /*
   * SI EL MOVIMIENTO DECLARA EL AGARRE, LA MANO VA FIJA A LA BARRA. Es lo correcto: un agarre no
   * resbala, y lo que se dobla al moverse el brazo es la muñeca.
   *
   * `agarre_marco` guarda, por mano, la orientación de la mano RESPECTO A LA BARRA, como cuaternión
   * de cuatro números. Lo calcula `scripts/calibrar-agarre.mjs` una vez, a partir del primer
   * fotograma del propio movimiento, así que el agarre queda exactamente como se revisó y ya no se
   * mueve en todo el recorrido.
   *
   * Deducirlo del antebrazo en cada fotograma —lo que se hacía antes, y lo que sigue haciéndose si
   * el movimiento no lo declara— hace que la mano gire despacio alrededor de la barra: hasta 15°
   * entre fotogramas medidos en el press militar. En pantalla parece que la mano cambia de agarre
   * sola a mitad de la serie.
   */
  const fijo = imp.agarre_marco?.[l];
  if (fijo) {
    return (imp.orientacion ?? new Quaternion()).clone()
      .multiply(new Quaternion(fijo[0], fijo[1], fijo[2], fijo[3]));
  }

  const A = ejeDe(imp);
  const radial = perpendicular(imp.posicion.clone().sub(muneca), A);
  if (!radial) return Fantebrazo;
  // El eje largo de la mano es el antebrazo sin la parte que va a lo largo de la barra. Si el
  // antebrazo apunta justo a lo largo de ella no queda nada, y entonces manda la dirección radial.
  const largo = perpendicular(ABAJO.clone().applyQuaternion(Fantebrazo), A) ?? radial.clone();
  const palma = perpendicular(radial, largo);
  if (!palma) return Fantebrazo;
  return mapearBase(ABAJO, new Vector3(-SIGNO[l], 0, 0), largo, palma);
}




function posarBrazo(esq, pose, l, Ftorax, implementos, anotar, avisos) {
  const m = miembro(pose.brazos, l) ?? {};
  const enMano = Object.values(implementos).find((i) => i.en_mano === l);
  const { huesos, longitudes } = esq;
  let Fbrazo, flexionCodo;

  if (m.objetivo !== undefined) {
    const raiz = posicion(huesos[`brazo_${l}`]);
    const polo = v3(m.codo_hacia ?? [SIGNO[l], 0, -1]);
    const resolver = (objetivo) => resolverDosHuesos({
      raiz, objetivo, polo, l1: longitudes.brazo, l2: longitudes.antebrazo, b0: DELANTE,
    });
    let r = resolver(resolverPunto(esq, m, l, implementos, raiz));

    /*
     * LA BARRA TIENE QUE CAER DENTRO DE LA MANO, y eso no se consigue de una pasada.
     *
     * Lo que resuelve la cinemática inversa es dónde va la MUÑECA. El primer objetivo la pone a un
     * palmo de la barra «en la dirección del hombro», y eso solo acierta si la mano apunta justo a
     * la barra. En la sentadilla no apunta: el codo va abierto, la mano sale de lado, y el puño
     * acababa cerrado sobre el aire con la barra pasando por detrás de los nudillos. En primer
     * plano se ve perfectamente y es de las cosas que tiran por tierra el resto del trabajo.
     *
     * Aquí se le da la vuelta a la cuenta: se calcula el marco de la mano, se mira dónde cruzaría la
     * palma, y se corrige la muñeca para que ese punto sea el agarre. Como el marco depende a su vez
     * de dónde esté la muñeca, se repite. Converge en dos vueltas; se hacen tres porque son cuatro
     * multiplicaciones de cuaternión y no aparecen en ningún perfil.
     */
    if (m.objetivo === 'barra' && implementos.barra) {
      const barra = implementos.barra;
      const A = ejeDe(barra);
      const agarre = barra.posicion.clone().addScaledVector(A, SIGNO[l] * (barra.agarre ?? 0.4));
      for (let vuelta = 0; vuelta < 3; vuelta += 1) {
        // La muñeca, siguiendo la cadena: hombro → codo → muñeca. Se calcula en vez de leerla del
        // hueso para no tener que ir colocando el brazo en cada vuelta.
        const Fant = r.F1.clone().multiply(eje(EJE.flexionMiembro, r.flexion));
        const muneca = raiz.clone()
          .addScaledVector(ABAJO.clone().applyQuaternion(r.F1), longitudes.brazo)
          .addScaledVector(ABAJO.clone().applyQuaternion(Fant), longitudes.antebrazo);
        const F = marcoAgarre(muneca, barra, Fant, l);
        const largo = ABAJO.clone().applyQuaternion(F);
        const palma = new Vector3(-SIGNO[l], 0, 0).applyQuaternion(F);
        // Del centro de la palma a la muñeca: medio palmo hacia atrás y el radio de la barra más
        // el grosor de la mano hacia el lado contrario al que mira la palma.
        /*
         * El signo se comprobó de dos formas, y las dos hacían falta: renderizando las dos
         * versiones —con la contraria la barra se despega y flota por encima de los dedos— y
         * midiendo el aro con los MISMOS vectores que usa esta función. Medirlo reconstruyendo el
         * marco de la mano desde el hueso daba el signo cambiado y mandó media tarde al garete.
         */
        const objetivo = agarre.clone()
          .addScaledVector(largo, -AVANCE_AGARRE)
          .addScaledVector(palma, -hondoAgarre(m.cierre ?? 0.8));
        /*
         * Y UNA MANO NO LLEGA MÁS LEJOS QUE SU BRAZO.
         *
         * Colocar bien la palma mueve la muñeca unos nueve centímetros respecto a donde la ponía la
         * cuenta anterior, y con el brazo casi estirado —el peso muerto, el final del press militar—
         * eso bastaba para dejar el objetivo fuera de alcance: el validador cantaba «la mano no
         * llega: faltan 3 cm» en media docena de fotogramas. Se acerca el objetivo hasta el borde
         * de lo que el brazo alcanza. Prefiero la mano un centímetro corta y el brazo creíble que
         * un brazo estirado apuntando a un sitio al que no llega.
         */
        const alcance = (longitudes.brazo + longitudes.antebrazo) * 0.999;
        const desdeHombro = objetivo.clone().sub(raiz);
        if (desdeHombro.length() > alcance) {
          /*
           * Y AVISA. Acercar el objetivo en silencio es lo que convirtió esto en una trampa: como
           * después la mano SÍ llega a donde se le pide, el validador no veía nada y el maniquí
           * soltaba la barra a mitad de recorrido sin que ninguna comprobación dijese ni mu. Pasó
           * con el jalón —20,8 cm fuera de alcance en 46 fotogramas de 48— y solo se vio mirando.
           */
          avisos.push({ tipo: 'recorte', miembro: 'mano', lado: l, falta: desdeHombro.length() - alcance });
          objetivo.copy(raiz).addScaledVector(desdeHombro.normalize(), alcance);
        }
        r = resolver(objetivo);
      }
    }
    // El aviso son DATOS, no una frase: quien lo lee es el validador, que corre en node y le pone
    // palabras. Una frase aquí sería texto en español dentro de src/, que es justo lo que prohíbe
    // check-idiomas.mjs — y con razón, porque nadie distingue a simple vista un mensaje de consola
    // de un rótulo que acaba en pantalla.
    if (r.falta > 0.01) avisos.push({ tipo: 'no_alcanza', miembro: 'mano', lado: l, falta: r.falta });
    Fbrazo = r.F1;
    flexionCodo = r.flexion;
    // Para el validador: el ángulo del brazo respecto al tórax, en los planos de siempre.
    const dir = ABAJO.clone().applyQuaternion(Fbrazo).applyQuaternion(Ftorax.clone().invert());
    // Con el brazo muy abierto, atan2 en el plano sagital no significa nada (el press de banca daba
    // −62° de "flexión" con el brazo casi horizontal). Ahí se mide la flexión horizontal: cuánto sale
    // el brazo del plano frontal.
    const abierto = abduccionDe(dir, l) > 45;
    /*
     * Y el ángulo se da en el lado bueno de la vuelta. Con el brazo justo vertical —el final del
     * press militar— el atan2 devuelve ±180 según de qué lado caiga un milímetro: el mismo gesto
     * salía como 180° en un fotograma y como −180° en el siguiente, y el validador lo cantaba
     * fuera del rango [−60, 180] sin que nada se hubiera movido. Por debajo de −90 no hay gesto
     * posible, así que ahí lo que hay es una vuelta de más.
     */
    const flexionBruta = (abierto ? Math.asin(Math.max(-1, Math.min(1, dir.z))) : Math.atan2(dir.z, -dir.y)) / GRAD;
    anotar(l, 'hombro.flexion', flexionBruta < -90 ? flexionBruta + 360 : flexionBruta);
    anotar(l, 'hombro.abduccion', abduccionDe(dir, l));
  } else {
    Fbrazo = Ftorax.clone().multiply(rotacionEsferica(m.hombro, l));
    flexionCodo = m.codo?.flexion ?? 0;
    for (const k of ['flexion', 'abduccion', 'rotacion']) anotar(l, `hombro.${k}`, m.hombro?.[k] ?? 0);
  }
  anotar(l, 'codo.flexion', flexionCodo);

  orientar(esq, huesos[`brazo_${l}`], Fbrazo);
  const Fantebrazo = Fbrazo.clone().multiply(eje(EJE.flexionMiembro, flexionCodo));
  orientar(esq, huesos[`antebrazo_${l}`], Fantebrazo);
  if (m.mano_plana) {
    // Mano apoyada: palma abajo y dedos hacia delante. Siguiendo al antebrazo, la mano del remo
    // metía los dedos 15 cm dentro del banco; el validador contó 2.500 vértices dentro.
    const rumbo = eje(new Vector3(0, 1, 0), pose.pelvis?.orientacion?.giro ?? 0);
    const Fmano = mapearBase(ABAJO, new Vector3(-SIGNO[l], 0, 0), DELANTE.clone().applyQuaternion(rumbo), ABAJO);
    orientar(esq, huesos[`mano_${l}`], Fmano);

    /*
     * EL PULGAR, TUMBADO EN EL PLANO DE LA PALMA Y APUNTANDO ADELANTE Y HACIA DENTRO.
     *
     * En reposo cuelga por debajo de la palma, así que una mano apoyada dejaba el pulgar 9 cm bajo
     * el suelo: el validador obligaba a levantar la muñeca y el maniquí acababa apoyándose en los
     * dedos. Se resolvía con un giro fijo de 70° alrededor de un eje supuesto, y ese eje solo
     * acertaba en una mano: en la otra el pulgar quedaba doblado hacia atrás contra la muñeca.
     *
     * Ahora se APUNTA, que no depende de ningún convenio: hacia delante y 35° hacia la línea media,
     * que es donde cae el pulgar de una mano apoyada en el suelo.
     */
    const haciaDentro = new Vector3(-SIGNO[l], 0, 0);
    const destinoPulgar = DELANTE.clone().multiplyScalar(0.82)
      .addScaledVector(haciaDentro, 0.57).normalize().applyQuaternion(rumbo);
    for (const h of huesos[`falanges_${l}`]) {
      if (!h.name.includes('thumb')) continue;
      if (!h.name.includes('thumb01')) continue;
      const padre = h.parent.getWorldQuaternion(new Quaternion());
      const mundo = h.getWorldQuaternion(new Quaternion());
      const actual = new Vector3(0, 1, 0).applyQuaternion(mundo);
      const giro = new Quaternion().setFromUnitVectors(actual, destinoPulgar);
      h.quaternion.copy(padre.invert().multiply(giro.multiply(mundo)));
      h.updateMatrixWorld(true);
    }
    const antebrazo = ABAJO.clone().applyQuaternion(Fantebrazo);
    anotar(l, 'muneca.extension', Math.acos(Math.max(-1, Math.min(1, antebrazo.dot(DELANTE.clone().applyQuaternion(rumbo))))) / GRAD);
  } else if (m.objetivo === 'barra' && implementos.barra) {
    orientar(esq, huesos[`mano_${l}`], marcoAgarre(posicion(huesos[`mano_${l}`]), implementos.barra, Fantebrazo, l));
  } else if (enMano) {
    /*
     * MANDA LA PALMA, Y EL MANGO SE DEDUCE DE ELLA.
     *
     * Tres versiones de esto, y las dos primeras estaban mal por lo mismo: decidían primero hacia
     * dónde apunta el mango y sacaban la palma de un producto vectorial. Un producto vectorial
     * cambia de signo cuando cambian sus factores, así que las dos manos salían con la palma hacia
     * lados distintos —no espejados: distintos—, y una mancuerna acababa pegada al DORSO de la mano.
     * En el press con mancuernas se veía a la primera: la derecha agarrada y la izquierda al lado.
     *
     * Lo que de verdad decide una persona al coger algo es hacia dónde mira la palma:
     *
     *  - neutro: hacia la línea media del cuerpo, que es como cuelga una mancuerna al lado;
     *  - prono: hacia delante, que es como se sujeta en un press.
     *
     * Y como la muñeca no es una rótula, esa dirección se endereza contra el antebrazo en vez de
     * imponerse. El eje del mango sale después, de la palma y del antebrazo, con el signo de la
     * mano: así las dos son espejo la una de la otra por construcción y no por casualidad.
     */
    const largo = ABAJO.clone().applyQuaternion(Fantebrazo);
    const rumboCuerpo = eje(new Vector3(0, 1, 0), pose.pelvis?.orientacion?.giro ?? 0);
    const deseada = (enMano.agarre_mango === 'prono'
      ? DELANTE.clone()
      : new Vector3(-SIGNO[l], 0, 0)).applyQuaternion(rumboCuerpo);

    let palma = perpendicular(deseada, largo)
      /* Con el antebrazo apuntando justo adonde mira la palma no queda nada que enderezar —pasa con
         el brazo estirado del todo hacia delante—: ahí sirve cualquier perpendicular. */
      ?? (perpendicular(new Vector3(0, 1, 0), largo) ?? new Vector3(1, 0, 0));
    /*
     * Con `pronacion` en grados, la palma parte de la neutra y GIRA alrededor del antebrazo, que es
     * lo que hace el cúbito con el radio. Es un número y se interpola entre poses: el giro del press
     * Arnold sale gradual en vez de saltar de un agarre a otro.
     */
    if (typeof m.pronacion === 'number') {
      const neutra = new Vector3(-SIGNO[l], 0, 0).applyQuaternion(rumboCuerpo);
      palma = (perpendicular(neutra, largo) ?? palma).applyAxisAngle(largo, SIGNO_PRONACION[l] * m.pronacion * GRAD);
      anotar(l, 'antebrazo.pronacion', m.pronacion);
    }
    const ejeMango = new Vector3().crossVectors(largo, palma).multiplyScalar(-SIGNO[l]).normalize();

    const Fmano = mapearBase(ABAJO, new Vector3(-SIGNO[l], 0, 0), largo, palma);
    orientar(esq, huesos[`mano_${l}`], Fmano);

    // El mango, en el hueco del puño: ver AVANCE_AGARRE.
    enMano.eje = ejeMango;
    enMano.punto = posicion(huesos[`mano_${l}`])
      .addScaledVector(largo, AVANCE_AGARRE)
      .addScaledVector(palma, hondoAgarre(m.cierre ?? 0.8));
  } else {
    orientar(esq, huesos[`mano_${l}`], Fantebrazo);
  }
}

function posarPierna(esq, pose, l, Fpelvis, anotar, avisos) {
  const m = miembro(pose.piernas, l) ?? {};
  const { huesos, longitudes } = esq;
  let Fmuslo, flexionRodilla;

  if (m.objetivo !== undefined) {
    const raiz = posicion(huesos[`muslo_${l}`]);
    const r = resolverDosHuesos({
      raiz,
      objetivo: resolverPunto(esq, m, l, {}, raiz),
      polo: v3(m.rodilla_hacia ?? [0, 0, 1]),
      l1: longitudes.muslo, l2: longitudes.pierna, b0: DETRAS,
    });
    if (r.falta > 0.01) avisos.push({ tipo: 'no_alcanza', miembro: 'pie', lado: l, falta: r.falta });
    Fmuslo = r.F1;
    flexionRodilla = r.flexion;
    const dir = ABAJO.clone().applyQuaternion(Fmuslo).applyQuaternion(Fpelvis.clone().invert());
    anotar(l, 'cadera.flexion', Math.atan2(dir.z, -dir.y) / GRAD);
    anotar(l, 'cadera.abduccion', abduccionDe(dir, l));
  } else {
    Fmuslo = Fpelvis.clone().multiply(rotacionEsferica(m.cadera, l));
    flexionRodilla = m.rodilla?.flexion ?? 0;
    for (const k of ['flexion', 'abduccion', 'rotacion']) anotar(l, `cadera.${k}`, m.cadera?.[k] ?? 0);
  }
  anotar(l, 'rodilla.flexion', flexionRodilla);

  orientar(esq, huesos[`muslo_${l}`], Fmuslo);
  const Fpierna = Fmuslo.clone().multiply(eje(EJE.flexionRodilla, flexionRodilla));
  orientar(esq, huesos[`pierna_${l}`], Fpierna);

  /*
   * APOYO SOBRE EL METATARSO. En una flexión, una plancha o el pie de atrás de una zancada, lo que
   * toca el suelo es la almohadilla del pie y los dedos se doblan; el talón sube. Sin doblar los
   * dedos, el único modo de que la punta llegara al suelo era subir el tobillo hasta 27 cm: en la
   * vista lateral el maniquí se leía "de puntillas muy alto" y no apoyado.
   *
   * El maniquí tiene hueso de dedos (DEF-toe) y no se estaba usando para nada.
   */
  if (m.apoyo === 'metatarso') {
    const rumbo = (pose.pelvis?.orientacion?.giro ?? 0) + SIGNO[l] * (m.apertura ?? 0);
    const giro = eje(new Vector3(0, 1, 0), rumbo);

    /*
     * El ángulo del pie NO se escribe: se calcula. Con el tobillo a la altura que pida la pose, el
     * pie se inclina lo justo para que la articulación de los dedos toque el suelo, y los dedos se
     * quedan planos. Escribirlo a mano significaba reajustarlo en cada pose intermedia.
     */
    /*
     * `superficie` es la altura de LO QUE PISA, no siempre el suelo. En la sentadilla búlgara el pie
     * de atrás apoya la punta sobre un banco a 36 cm: dando por supuesto el suelo, la cuenta pedía
     * estirar el tobillo casi 90° y el pie salía colgando en vertical como si señalara al suelo.
     */
    const superficie = m.superficie ?? 0;
    const alturaTobillo = posicion(huesos[`pie_${l}`]).y;
    const seno = Math.min(1, Math.max(-1, (alturaTobillo - ALTURA_ALMOHADILLA - superficie) / esq.longitudes.pie));
    let inclinacion = Math.min(Math.asin(seno), 85 * GRAD);

    /*
     * MANDA EL TOBILLO, NO EL SUELO. Si para tocar el suelo hiciera falta estirar el tobillo más de
     * lo que se estira, el pie se queda en su límite y la punta flota unos milímetros: invisible, y
     * desde luego menos falso que un tobillo doblado 66°.
     *
     * Perseguir esto desde la ficha no funcionaba: cada pose intermedia pedía una altura distinta y
     * el ciclo se rompía entre poses buenas.
     */
    const pierna = ABAJO.clone().applyQuaternion(Fpierna);
    const direccion = (angulo) => new Vector3(0, -Math.sin(angulo), Math.cos(angulo)).applyQuaternion(giro);
    const LIMITE_PLANTAR = RANGOS['tobillo.dorsiflexion'][0];
    for (let intento = 0; intento < 90 && dorsiflexionDe(pierna, direccion(inclinacion)) < LIMITE_PLANTAR; intento += 1) {
      inclinacion -= GRAD;
    }
    const haciaDedos = direccion(inclinacion);

    const Fpie = new Quaternion().setFromUnitVectors(direccionNeutra(esq, huesos[`pie_${l}`]), haciaDedos);
    orientar(esq, huesos[`pie_${l}`], Fpie);

    // Los dedos, planos y hacia delante: su reposo ya apunta al frente, así que basta con el rumbo.
    orientar(esq, huesos[`dedos_pie_${l}`], giro);

    anotar(l, 'tobillo.dorsiflexion', dorsiflexionDe(ABAJO.clone().applyQuaternion(Fpierna), haciaDedos));
    anotar(l, 'dedos.flexion', inclinacion / GRAD);
  } else if (m.pie_plano) {
    // Pie apoyado: plano en el suelo, girado lo que diga `apertura`. La dorsiflexión sale sola, y es
    // lo que se valida: si pasa de 40°, la pose pide un tobillo que casi nadie tiene.
    // El rumbo sale del `giro` declarado, no de hacia dónde mira la pelvis: tumbado en el banco la
    // pelvis mira al techo, su proyección en el suelo es nula y el rumbo del pie quedaría al azar.
    const rumbo = pose.pelvis?.orientacion?.giro ?? 0;
    const Fpie = eje(new Vector3(0, 1, 0), rumbo + SIGNO[l] * (m.apertura ?? 0));
    orientar(esq, huesos[`pie_${l}`], Fpie);
    anotar(l, 'tobillo.dorsiflexion', dorsiflexionDe(
      ABAJO.clone().applyQuaternion(Fpierna),
      direccionNeutra(esq, huesos[`pie_${l}`]).applyQuaternion(Fpie),
    ));
  } else {
    const Fpie = Fpierna.clone().multiply(eje(EJE.dorsiflexion, m.tobillo?.dorsiflexion ?? 0));
    orientar(esq, huesos[`pie_${l}`], Fpie);
    anotar(l, 'tobillo.dorsiflexion', m.tobillo?.dorsiflexion ?? 0);
  }
}

/**
 * Cierra los dedos alrededor del agarre. 0 = mano abierta, 1 = cerrada del todo.
 *
 * Un ángulo igual en las tres falanges da un puño, no un agarre: la mano cerrada sobre una barra
 * dobla mucho los nudillos y la falange media, y poco la punta. El pulgar va aparte y menos, porque
 * se opone al resto en lugar de curvarse con ellos.
 *
 * EL 1 NO ES EL TOPE: ES EL AGARRE. Estos 165° repartidos entre las tres falanges son los que hacen
 * falta para rodear una barra; un puño de verdad pide cerca de 260. Para cerrar el puño —la
 * plancha— el `cierre` va por encima de 1, y ahí hay un óptimo MEDIDO con la punta del índice
 * contra la muñeca: 1.55 da un puño de 9,9 cm, y a partir de 1.8 el dedo se enrolla de más, la
 * punta sale por debajo de la palma y vuelve a alejarse —1.7 mide 15,4 cm, peor que no cerrar—.
 * La distancia no crece con el número, así que se mide en vez de subirlo a ojo: probando 1.7 se
 * concluyó que el puño era imposible, y lo que pasaba es que estaba justo pasado el punto bueno.
 */
const CURVA_DEDOS = { falange: [55, 70, 40], pulgar: [20, 24, 16] };

/**
 * Cierra los dedos alrededor del agarre. 0 = mano abierta, 1 = cerrada del todo.
 *
 * Un ángulo igual en las tres falanges da un puño, no un agarre: la mano cerrada sobre una barra
 * dobla mucho los nudillos y la falange media, y poco la punta.
 *
 * EL PULGAR RODEA LA BARRA; NO SE CIERRA CONTRA LA PALMA. Es la diferencia entre agarrar y cerrar
 * el puño, y se notaba: el pulgar se metía dentro del puño, la barra le pasaba por encima y en el
 * primer plano del press de banca asomaba un muñón por un lado. Cuando hay algo agarrado, todas las
 * falanges del pulgar giran alrededor del EJE DE ESE ALGO —igual que hacen los otros cuatro dedos,
 * solo que llegando por el otro lado—, que es lo que hace que la mano se cierre sobre el mango en
 * vez de sobre sí misma.
 *
 * Sin nada agarrado —la plancha, el puente— no hay eje al que rodear: ahí el pulgar se dobla hacia
 * la palma, alrededor de la perpendicular a su propio hueso y a la normal de la palma. Suponer la X
 * del hueso, como se hacía antes, valía para una mano y abría el pulgar de la otra hacia fuera.
 */
function cerrarMano(esq, l, cierre, ejeAgarre, puntoAgarre) {
  if (!cierre) return;
  const mano = esq.huesos[`mano_${l}`];
  const marcoMano = mano.getWorldQuaternion(new Quaternion()).multiply(esq.neutra.get(mano).clone().invert());
  const palma = new Vector3(-SIGNO[l], 0, 0).applyQuaternion(marcoMano);

  /*
   * EL SENTIDO DEL CIERRE NO SE SUPONE: SE PRUEBA.
   *
   * Aquí se han estrellado cuatro intentos, todos por lo mismo. Doblar un dedo es girarlo alrededor
   * de un eje, y acertar ese eje a base de convenios —la X del hueso, el signo de la mano, la normal
   * de la palma— sale bien en una mano y mal en la otra, porque el esqueleto no está espejado como
   * uno supone. Lo que no falla es mirar el resultado: de los dos sentidos posibles, el bueno es el
   * que ACERCA la punta del dedo a lo que se está agarrando.
   *
   * Con algo en la mano, el eje es el del propio mango: enrollarse alrededor de un cilindro es
   * girar alrededor de su eje, y ahí el dedo pasa de rozarlo a envolverlo. Sin nada que agarrar
   * —la plancha, el puente— no hay a qué acercarse: el dedo se dobla hacia la palma y punto.
   */
  /*
   * EL SENTIDO DEL CIERRE, CONTINUO.
   *
   * Girar un dedo alrededor del eje `e` mueve su punta hacia `e × dir`, así que el sentido bueno es
   * el que hace que eso apunte hacia la palma. Sale de un producto escalar, no de comparar dos
   * distancias: comparando distancias, el resultado saltaba de un fotograma a otro cuando las dos
   * opciones quedaban parecidas, y la mano daba un tirón a mitad del recorrido. En la sentadilla y
   * en el press militar se veía como si la mano cambiara de agarre sola.
   */
  const sentidoDe = (dir, ejeMundo) => {
    const haciaDonde = new Vector3().crossVectors(ejeMundo, dir).dot(palma);
    return haciaDonde >= 0 ? 1 : -1;
  };

  let sentido = 0;
  for (const h of esq.huesos[`falanges_${l}`]) {
    const pulgar = h.name.includes('thumb');
    const n = Number(h.name.match(/0(\d)/)[1]) - 1;

    /*
     * La primera falange del pulgar se APUNTA al agarre: no basta con doblarlo, porque se opone al
     * resto y hay que llevarlo antes a donde está el mango.
     */
    /*
     * UN PUÑO CIERRA EL PULGAR SOBRE LOS DEDOS, NO LO DEJA TIESO.
     *
     * Curvándolo por ángulos no sale: el eje que lo dobla es `dir × palma`, y el pulgar apunta casi
     * en la dirección de la palma, así que ese producto queda cortísimo y cada falange acaba
     * girando en un plano distinto. Los giros se cancelan y el pulgar se queda RECTO —medido: 9,2 cm
     * de la base a la punta con la mano abierta, 8,7 cerrando del todo—. En la plancha salía tieso,
     * apuntando al otro puño.
     *
     * Se resuelve como ya se resolvía con una barra: APUNTÁNDOLO. El destino es la falange media
     * del índice, que a estas alturas del bucle ya está cerrada —los dedos van antes que el pulgar—,
     * así que el pulgar cae encima de ellos, que es donde va en un puño.
     */
    let destinoPulgar = puntoAgarre;
    if (pulgar && !puntoAgarre && cierre > 1) {
      const indice = esq.huesos[`falanges_${l}`].find((x) => x.name.includes('index02'));
      if (indice) destinoPulgar = indice.getWorldPosition(new Vector3());
    }

    if (pulgar && destinoPulgar && n === 0) {
      const padre = h.parent.getWorldQuaternion(new Quaternion());
      const mundo = h.getWorldQuaternion(new Quaternion());
      const actual = new Vector3(0, 1, 0).applyQuaternion(mundo);
      /*
       * Apuntando al CENTRO del agarre, el pulgar se metía dentro del puño y asomaba entre el índice
       * y el corazón. Un pulgar no va al centro de la barra: va a su SUPERFICIE, por el lado por el
       * que llega. Ese punto se calcula desde la base del propio pulgar —se proyecta sobre el eje y
       * se sale un radio hacia fuera—, así que sale bien esté donde esté la mano.
       */
      const base = h.getWorldPosition(new Vector3());
      let destino = destinoPulgar.clone();
      if (ejeAgarre) {
        const sobreEje = destinoPulgar.clone().addScaledVector(ejeAgarre, base.clone().sub(destinoPulgar).dot(ejeAgarre));
        const haciaFuera = base.clone().sub(sobreEje);
        if (haciaFuera.lengthSq() > 1e-8) destino = sobreEje.addScaledVector(haciaFuera.normalize(), RADIO_BARRA + 0.012);
      }
      const deseada = destino.sub(base);
      if (deseada.lengthSq() > 1e-8) {
        const giro = new Quaternion().setFromUnitVectors(actual, deseada.normalize());
        h.quaternion.copy(padre.invert().multiply(giro.multiply(mundo)));
        h.updateMatrixWorld(true);
      }
      continue;
    }

    const angulo = CURVA_DEDOS[pulgar ? 'pulgar' : 'falange'][n] * cierre;
    const mundo = h.getWorldQuaternion(new Quaternion());
    const dir = new Vector3(0, 1, 0).applyQuaternion(mundo);

    // El eje alrededor del que gira: el del mango si hay algo agarrado, si no el que lleva a la palma.
    let ejeMundo = ejeAgarre ? ejeAgarre.clone() : new Vector3().crossVectors(dir, palma);
    if (ejeMundo.lengthSq() < 1e-8) continue;
    ejeMundo.normalize();

    /*
     * El sentido se decide UNA VEZ POR MANO, con la primera falange, y vale para todas.
     *
     * Decidirlo en cada falange parecía más listo y era peor: en cuanto una punta llega al mango,
     * los dos sentidos la alejan, el desempate sale por décimas y el dedo se desenrolla a mitad de
     * camino. Un dedo se cierra entero hacia el mismo lado o no se cierra.
     */
    if (sentido === 0) sentido = sentidoDe(dir, ejeMundo);
    const ejeDedo = ejeMundo.multiplyScalar(sentido).applyQuaternion(mundo.clone().invert());
    h.quaternion.multiply(eje(ejeDedo, angulo));
    // La siguiente falange lee su dirección en el mundo: sin actualizar, la lee sin el giro de su
    // padre y el dedo sale en abanico en vez de enrollado.
    h.updateMatrixWorld(true);
  }
}




/**
 * Abducción como ángulo de salida del plano sagital, no como atan2 en el plano frontal.
 *
 * Con el muslo flexionado hacia delante, su proyección en el plano frontal es casi un punto y el
 * atan2 se dispara: la primera sentadilla daba 149° de abducción en una cadera normal.
 */
function abduccionDe(dir, lado) {
  return Math.asin(Math.max(-1, Math.min(1, SIGNO[lado] * dir.x))) / GRAD;
}

/* ------------------------------------------------------------------------ implementos -- */

function colocarImplementos(esq, pose, definicion, marcos) {
  const salida = {};
  for (const [nombre, def] of Object.entries(definicion.implementos ?? {})) {
    const estado = { ...def, ...(pose.implementos?.[nombre] ?? {}) };
    let pos = v3(estado.posicion ?? [0, 0, 0]);
    let orientacion = new Quaternion();
    if (estado.relativo_a) {
      const marco = marcos[estado.relativo_a];
      if (!marco) throw new Error(`Implemento ${nombre}: relativo_a desconocido (${estado.relativo_a})`);
      const origen = estado.relativo_a === 'torax' ? posicion(esq.huesos.columna[2]) : posicion(esq.huesos.pelvis);
      pos = origen.add(v3(estado.desplazamiento ?? [0, 0, 0]).applyQuaternion(marco));
      orientacion = marco.clone();
      /*
       * `giro`: cuánto se tumba el implemento respecto al cuerpo que lo lleva, alrededor del eje
       * que mira adelante. Existe por la sentadilla goblet: una mancuerna se agarra de pie, en
       * vertical y con las dos manos una encima de otra. En horizontal, las manos caen a 10 cm una
       * de otra —y un puño de este maniquí mide 9 de ancho—, así que se fundían en un solo bulto.
       */
      if (estado.giro) orientacion.multiply(eje(new Vector3(0, 0, 1), estado.giro));
    }
    /*
     * `rodar`: cuánto gira la barra sobre su PROPIO eje, en grados, por pose. Con el agarre fijado
     * a la barra (`agarre_marco`), la mano gira con ella. Sin esto una barra suelta no rodaba nunca,
     * y en el curl con barra la mano conservaba arriba la orientación que tenía colgando abajo: la
     * muñeca acababa doblada 90° y el recorrido había que cortarlo antes de llegar al pecho.
     */
    if (typeof estado.rodar === 'number') orientacion.multiply(eje(new Vector3(1, 0, 0), estado.rodar));
    salida[nombre] = { ...estado, posicion: pos, orientacion };
  }
  return salida;
}

/* --------------------------------------------------------------------- interpolación -- */

/*
 * CURVAS: reparten el tiempo DENTRO de un tramo, sin tocar sus extremos.
 *
 * Todas cumplen f(0)=0, f(1)=1 y **f'(0)=f'(1)=1**. Esa última condición es la que importa: una
 * curva que llega a la pose con velocidad distinta de la que sale de ella deja un tirón en cada pose
 * intermedia. Medido en la sentadilla: la cadera bajaba a 1,56 m por ciclo y en el fotograma
 * siguiente a 0,27 —un frenazo que en pantalla se ve como un tropiezo—. Por eso todas están
 * construidas sobre sin²(πk), que vale 0 y tiene derivada 0 en los dos extremos.
 */
const CURVAS = {
  lineal: (k) => k,
  suave: (k) => k,
  /** Excéntrica controlada: entra despacio y recupera al final del tramo. */
  controlada: (k) => k - 0.22 * Math.sin(Math.PI * k) ** 2,
  /** Sale rápido y afloja: la salida del punto bajo. */
  explosiva: (k) => k + 0.22 * Math.sin(Math.PI * k) ** 2,
  /**
   * Rápido al salir y lento después: el punto de estancamiento de cualquier repetición con carga.
   * Sin esto, la subida va a velocidad de cinta transportadora, que es de lo que más delata que hay
   * un muñeco y no alguien levantando peso.
   */
  esfuerzo: (k) => k + 0.36 * Math.sin(Math.PI * k) ** 2 * (0.5 - k),
};

/**
 * Mezcla cuatro poses —la anterior, las dos del tramo y la siguiente— campo a campo.
 *
 * Lo que una pose no dice vale lo neutro (0), no lo de la otra pose: si no, una columna declarada
 * solo abajo aparecía ya inclinada en el fotograma de arriba.
 */
function mezclar(previa, a, b, siguiente, k, duraciones) {
  const tipos = [previa, a, b, siguiente];
  const numero = tipos.find((x) => typeof x === 'number') !== undefined;
  const lista = tipos.find((x) => Array.isArray(x));
  const objeto = tipos.find((x) => isPlano(x));

  if (numero) {
    const [p, u, v, s] = tipos.map((x) => (typeof x === 'number' ? x : 0));
    return hermite(p, u, v, s, k, duraciones);
  }
  if (lista) {
    return lista.map((_, n) => mezclar(...tipos.map((x) => (Array.isArray(x) ? x[n] : x)), k, duraciones));
  }
  if (objeto) {
    // Recorrido a mano y sin Set ni flatMap: esto se ejecuta para cada campo de cada pose y en cada
    // fotograma, y la versión bonita costaba medio milisegundo por fotograma ella sola.
    const r = {};
    for (const x of tipos) {
      if (!isPlano(x)) continue;
      for (const clave in x) {
        if (clave in r) continue;
        r[clave] = mezclar(
          isPlano(previa) ? previa[clave] : undefined,
          isPlano(a) ? a[clave] : undefined,
          isPlano(b) ? b[clave] : undefined,
          isPlano(siguiente) ? siguiente[clave] : undefined,
          k, duraciones,
        );
      }
    }
    return r;
  }
  // Textos y banderas: no se interpolan, se cambian a mitad de tramo.
  return k < 0.5 ? a : b;
}

/**
 * Interpolación con velocidad continua entre poses (spline de Hermite con tangentes acotadas).
 *
 * Por qué no una recta entre dos poses: con rectas, cada pose intermedia es un cambio brusco de
 * velocidad. Y por qué tangentes ACOTADAS (regla de Fritsch-Carlson): un spline normal se pasa de
 * largo en los extremos, y pasarse en el punto bajo de una sentadilla es rebotar, que además de
 * feo es justo lo que una ficha de técnica dice que no hay que hacer.
 */
function hermite(previa, a, b, siguiente, k, [dtPrevia, dt, dtSiguiente]) {
  const pendiente = (v0, v1, d) => (d > 1e-6 ? (v1 - v0) / d : 0);
  const central = (v0, v1, v2, d0, d1) => {
    const s0 = pendiente(v0, v1, d0);
    const s1 = pendiente(v1, v2, d1);
    // En un extremo local la tangente es cero: ahí el movimiento se para de verdad (el punto bajo
    // de la sentadilla), y con tangente distinta de cero el maniquí lo rebasa y vuelve.
    return s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
  };
  const m0 = central(previa, a, b, dtPrevia, dt) * dt;
  const m1 = central(a, b, siguiente, dt, dtSiguiente) * dt;
  const k2 = k * k;
  const k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * a + (k3 - 2 * k2 + k) * m0 + (-2 * k3 + 3 * k2) * b + (k3 - k2) * m1;
}

/**
 * Pose interpolada en la fase `f` del ciclo. La curva de cada pose reparte el tiempo de su tramo.
 *
 * El ciclo es cerrado: la pose anterior a la primera es la penúltima, porque la última es una copia
 * de la primera. Sin esa vuelta, el arranque y el final del bucle tenían tangente cero y el maniquí
 * se paraba un instante en cada repetición.
 */
function mezclaEn(poses, f, soloClave) {
  const fase = ((f % 1) + 1) % 1;
  const ultimo = poses.length - 1;
  let n = 0;
  while (n < ultimo - 1 && poses[n + 1].t <= fase) n += 1;

  const a = poses[n];
  const b = poses[n + 1];
  const previa = poses[n === 0 ? ultimo - 1 : n - 1];
  const siguiente = poses[n + 2 > ultimo ? 1 : n + 2];
  const dur = (p, q) => ((q.t - p.t) + 1) % 1 || 1e-6;

  const k = (fase - a.t) / Math.max(1e-6, b.t - a.t);
  const curva = CURVAS[a.curva ?? 'suave'] ?? CURVAS.suave;
  const avance = curva(Math.min(1, Math.max(0, k)));
  const duraciones = [dur(previa, a), dur(a, b), dur(b, siguiente)];

  // Con `soloClave` se mezcla una sola parte. Lo usan los desfases: recalcular la pose entera para
  // quedarse con el cuello costaba tanto como el resto del fotograma junto.
  if (soloClave) {
    return mezclar(previa[soloClave], a[soloClave], b[soloClave], siguiente[soloClave], avance, duraciones);
  }
  return mezclar(previa, a, b, siguiente, avance, duraciones);
}

/*
 * LO QUE SEPARA UN MOVIMIENTO DE UN MUÑECO MOVIÉNDOSE.
 *
 * Con las poses solas, todas las articulaciones salen y llegan a la vez, los dos lados son clones y
 * el ciclo repite exactamente igual. Ninguna de las tres cosas pasa en un cuerpo. Los tres remedios
 * de aquí abajo son deterministas —nada de azar— porque el validador tiene que ver exactamente el
 * mismo movimiento que el visitante, y porque un movimiento que cambia entre ejecuciones no se puede
 * revisar mirando una hoja de capturas.
 */

/**
 * Cuánto se retrasa cada parte respecto a la cadera, en fracción de ciclo.
 *
 * El cuerpo es una cadena: la cadera manda, el tronco la sigue y la cabeza llega la última. Dos
 * centésimas de ciclo no se ven como retraso, se ven como peso.
 *
 * Los brazos NO llevan retraso por defecto: cuando agarran algo, su objetivo se resuelve contra la
 * posición actual del implemento, así que retrasarlos despega las manos de la barra.
 */
const RITMO_POR_DEFECTO = { columna: 0.02, cuello: 0.05 };

/** Partes que pueden llevar desfase propio. */
const PARTES = ['pelvis', 'columna', 'cuello', 'brazos', 'piernas', 'implementos'];

/**
 * Pose completa en la fase `f`, con ritmo, asimetría y respiración.
 *
 * Recibe el movimiento entero y no solo sus poses porque los tres ajustes se declaran en él, junto a
 * la duración: son parte de cómo se mueve, no de cómo se dibuja.
 */
export function poseEn(movimiento, f) {
  const poses = movimiento.poses ?? movimiento;
  const base = mezclaEn(poses, f);
  const ritmo = { ...RITMO_POR_DEFECTO, ...(movimiento.ritmo ?? {}) };
  const salida = { ...base };

  for (const parte of PARTES) {
    const desfase = ritmo[parte];
    if (!desfase || base[parte] === undefined) continue;
    const atrasada = mezclaEn(poses, f - desfase, parte);
    if (atrasada !== undefined) salida[parte] = atrasada;
  }

  /*
   * Asimetría. Nadie levanta igual con los dos lados: un hombro sube un poco antes, la cadera se va
   * unos milímetros hacia el lado fuerte y el tronco gira un grado escaso. Un grado no se ve; lo que
   * se ve es su ausencia, que es lo que hace que un maniquí parezca una estatua articulada.
   */
  const a = movimiento.asimetria ?? 0;
  if (a) {
    for (const grupo of ['brazos', 'piernas']) {
      const suyo = salida[grupo];
      if (!suyo?.ambos || suyo.d !== undefined) continue;
      const tarde = mezclaEn(poses, f - 0.02 * a, grupo);
      if (tarde?.ambos) salida[grupo] = { ...suyo, d: reflejar(tarde.ambos) };
    }
    salida.columna = {
      ...(salida.columna ?? {}),
      rotacion: (salida.columna?.rotacion ?? 0) + 0.8 * a,
      lateral: (salida.columna?.lateral ?? 0) + 0.5 * a,
    };
    salida.pelvis = {
      ...salida.pelvis,
      posicion: sumarX(salida.pelvis?.posicion, 0.006 * a),
    };
  }

  /*
   * Respiración. Un número entero de respiraciones por ciclo, para que la última pose siga siendo
   * igual que la primera: con un ciclo y medio, el maniquí da un salto al repetir.
   */
  const r = movimiento.respiracion;
  if (r?.amplitud) {
    const onda = Math.sin(2 * Math.PI * Math.round(r.ciclos ?? 1) * f);
    salida.pelvis = { ...salida.pelvis, posicion: sumarY(salida.pelvis?.posicion, r.amplitud * onda) };
    salida.columna = { ...(salida.columna ?? {}), flexion: (salida.columna?.flexion ?? 0) - 0.6 * onda };
  }

  return salida;
}

const sumarX = (p, d) => (p ? [p[0] + d, p[1], p[2]] : p);
const sumarY = (p, d) => (p ? [p[0], p[1] + d, p[2]] : p);

function isPlano(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

export const CURVAS_VALIDAS = Object.keys(CURVAS);
