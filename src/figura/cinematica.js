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
const LARGO_PALMA = 0.05;

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
  'hombro.flexion': [-60, 180],
  'hombro.abduccion': [-30, 180],
  'hombro.rotacion': [-90, 90],
  'codo.flexion': [0, 150],
  'muneca.extension': [-80, 95],
  'cadera.flexion': [-30, 130],
  'cadera.abduccion': [-30, 50],
  'cadera.rotacion': [-45, 45],
  'rodilla.flexion': [0, 155],
  'tobillo.dorsiflexion': [-50, 40],
  'columna.flexion': [-30, 80],
  'columna.lateral': [-35, 35],
  'columna.rotacion': [-45, 45],
  'cuello.flexion': [-60, 50],
};

/* ---------------------------------------------------------------- utilidades de vector -- */

const v3 = (a) => new Vector3(a[0], a[1], a[2]);
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
  }

  const distancia = (a, b) => a.getWorldPosition(new Vector3()).distanceTo(b.getWorldPosition(new Vector3()));
  const longitudes = {
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
  const Fcuello = Ftorax.clone().multiply(rotacionTronco(pose.cuello));
  orientar(esq, huesos.cuello, Fcuello);
  orientar(esq, huesos.cabeza, Fcuello);
  anotar(null, 'cuello.flexion', pose.cuello?.flexion ?? 0);

  const marcos = { mundo: new Quaternion(), pelvis: Fpelvis, torax: Ftorax };

  /* Implementos que dependen del cuerpo (la barra en la espalda) van después del tronco y antes de los brazos. */
  const implementos = colocarImplementos(esq, pose, definicion, marcos);

  for (const l of LADOS) {
    orientar(esq, huesos[`clavicula_${l}`], Ftorax);
    posarBrazo(esq, pose, l, Ftorax, implementos, anotar, avisos);
    posarPierna(esq, pose, l, Fpelvis, anotar, avisos);
    cerrarMano(esq, l, miembro(pose.brazos, l)?.cierre ?? 0);
  }

  // La mancuerna va en la mano, así que se coloca cuando la mano ya está.
  for (const imp of Object.values(implementos)) {
    if (imp.en_mano) {
      const mano = huesos[`mano_${imp.en_mano}`];
      const W = mano.getWorldQuaternion(new Quaternion());
      const largo = ABAJO.clone().applyQuaternion(W);
      const palma = new Vector3(-SIGNO[imp.en_mano], 0, 0).applyQuaternion(W);
      // El mango cruza la palma, no sigue los dedos: 5 cm hacia la punta de la mano y 1,5 cm hacia
      // el lado de la palma, que es donde apoya de verdad.
      imp.posicion = posicion(mano).addScaledVector(largo, 0.05).addScaledVector(palma, 0.015);
      imp.orientacion = W.clone().multiply(new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), new Vector3(0, 0, 1)));
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
    return agarre.addScaledVector(radial, RADIO_BARRA + 0.03 + LARGO_PALMA);
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
function marcoAgarre(muneca, imp, Fantebrazo, l) {
  const A = ejeDe(imp);
  const radial = perpendicular(imp.posicion.clone().sub(muneca), A);
  const largo = ABAJO.clone().applyQuaternion(Fantebrazo);
  const palma = radial ? perpendicular(radial, largo) : null;
  if (!palma) return Fantebrazo;
  return mapearBase(ABAJO, new Vector3(-SIGNO[l], 0, 0), largo, palma);
}

function posarBrazo(esq, pose, l, Ftorax, implementos, anotar, avisos) {
  const m = miembro(pose.brazos, l) ?? {};
  const { huesos, longitudes } = esq;
  let Fbrazo, flexionCodo;

  if (m.objetivo !== undefined) {
    const raiz = posicion(huesos[`brazo_${l}`]);
    const r = resolverDosHuesos({
      raiz,
      objetivo: resolverPunto(esq, m, l, implementos, raiz),
      polo: v3(m.codo_hacia ?? [SIGNO[l], 0, -1]),
      l1: longitudes.brazo, l2: longitudes.antebrazo, b0: DELANTE,
    });
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
    anotar(l, 'hombro.flexion', (abierto ? Math.asin(Math.max(-1, Math.min(1, dir.z))) : Math.atan2(dir.z, -dir.y)) / GRAD);
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
     * El pulgar, al plano de la palma. En reposo cuelga por debajo de ella, así que una mano apoyada
     * dejaba el pulgar 9 cm bajo el suelo: el validador —que cuenta los vértices de la mano contra
     * el suelo— obligaba a levantar toda la muñeca, y en las flexiones la palma quedaba flotando y
     * el maniquí parecía apoyarse en los dedos. Se abre hacia fuera, que es como se apoya de verdad.
     *
     * El eje y los 70° están MEDIDOS, no probados a ojo: con el pulgar abierto, el punto más bajo de
     * la mano pasa de 13,8 a 4,4 cm por debajo de la muñeca, que es el grosor de la palma.
     */
    for (const h of huesos[`falanges_${l}`]) {
      if (!h.name.includes('thumb')) continue;
      h.quaternion.multiply(eje(new Vector3(0, 0, -SIGNO[l]), 70));
    }
    const antebrazo = ABAJO.clone().applyQuaternion(Fantebrazo);
    anotar(l, 'muneca.extension', Math.acos(Math.max(-1, Math.min(1, antebrazo.dot(DELANTE.clone().applyQuaternion(rumbo))))) / GRAD);
  } else if (m.objetivo === 'barra' && implementos.barra) {
    orientar(esq, huesos[`mano_${l}`], marcoAgarre(posicion(huesos[`mano_${l}`]), implementos.barra, Fantebrazo, l));
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

  if (m.pie_plano) {
    // Pie apoyado: plano en el suelo, girado lo que diga `apertura`. La dorsiflexión sale sola, y es
    // lo que se valida: si pasa de 40°, la pose pide un tobillo que casi nadie tiene.
    // El rumbo sale del `giro` declarado, no de hacia dónde mira la pelvis: tumbado en el banco la
    // pelvis mira al techo, su proyección en el suelo es nula y el rumbo del pie quedaría al azar.
    const rumbo = pose.pelvis?.orientacion?.giro ?? 0;
    const Fpie = eje(new Vector3(0, 1, 0), rumbo + SIGNO[l] * (m.apertura ?? 0));
    orientar(esq, huesos[`pie_${l}`], Fpie);
    const tibia = ABAJO.clone().applyQuaternion(Fpierna).negate().applyQuaternion(Fpie.clone().invert());
    anotar(l, 'tobillo.dorsiflexion', Math.atan2(tibia.z, tibia.y) / GRAD);
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
 */
const CURVA_DEDOS = { falange: [55, 70, 40], pulgar: [22, 30, 22] };
function cerrarMano(esq, l, cierre) {
  if (!cierre) return;
  for (const h of esq.huesos[`falanges_${l}`]) {
    const pulgar = h.name.includes('thumb');
    const n = Number(h.name.match(/0(\d)/)[1]) - 1;
    h.quaternion.multiply(eje(new Vector3(1, 0, 0), CURVA_DEDOS[pulgar ? 'pulgar' : 'falange'][n] * cierre));
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
    }
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
