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
 *  - apoyos: si la ficha dice que el cuerpo descansa en el banco, que descanse;
 *  - equilibrio: la barra sobre el medio pie, cuando la ficha lo pide.
 *
 * Bloquea: sale con código 1 si hay un solo error. Un aviso que no bloquea acaba ignorándose.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { aplicarPose, poseEn, RANGOS, CURVAS_VALIDAS, LADOS } from '../src/figura/cinematica.js';
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

    for (const apoyo of mov.apoyos ?? []) {
      const imp = r.implementos[apoyo.implemento];
      const hueco = Math.min(...vertices.filter((v) => dentroDeHuella(imp, v)).map((v) => v.y - (imp.posicion.y + imp.alto)));
      if (!(Math.abs(hueco) <= apoyo.tolerancia)) {
        fallo(`el cuerpo no descansa en ${apoyo.implemento}`, `${etiqueta} (hueco ${(hueco * 100).toFixed(1)} cm)`);
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
      if ((mov.apoyos ?? []).some((a) => a.implemento === nombre && a.con && a.con !== 'asiento')) continue;
      const cadera = maniqui.esq.huesos.pelvis.getWorldPosition(new Vector3());
      if (Math.abs(cadera.y - (imp.posicion.y + imp.alto)) > 0.16) continue;
      const margen = imp.posicion.z + imp.largo / 2 - cadera.z;
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
    const dx = imp.ancho / 2 - Math.abs(v.x - imp.posicion.x);
    const dz = imp.largo / 2 - Math.abs(v.z - imp.posicion.z);
    const dy = imp.posicion.y + imp.alto - v.y;
    return Math.max(0, Math.min(dx, dy, dz, v.y - imp.posicion.y));
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

function dentroDeHuella(imp, v) {
  return Math.abs(v.x - imp.posicion.x) < imp.ancho / 2 && Math.abs(v.z - imp.posicion.z) < imp.largo / 2
    && v.y < imp.posicion.y + imp.alto + 0.15;
}

if (errores) {
  console.log(`\n${errores} problema(s). El movimiento no se publica así.`);
  process.exit(1);
}
