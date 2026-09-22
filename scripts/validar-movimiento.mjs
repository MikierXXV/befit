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
 *  - apoyos: si la ficha dice que el cuerpo descansa en el banco, que descanse;
 *  - equilibrio: la barra sobre el medio pie, cuando la ficha lo pide.
 *
 * Bloquea: sale con código 1 si hay un solo error. Un aviso que no bloquea acaba ignorándose.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { aplicarPose, poseEn, RANGOS, CURVAS_VALIDAS, LADOS } from '../src/figura/cinematica.js';
import { cargarManiqui, verticesPosados } from './lib/maniqui-node.mjs';

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
      const [min, max] = RANGOS[clave.replace(/_[id]$/, '')] ?? [-Infinity, Infinity];
      if (valor < min - 0.5 || valor > max + 0.5) {
        fallo(`${clave} fuera de rango [${min}, ${max}]`, `${etiqueta} (${valor.toFixed(0)}°)`);
      }
    }

    const vertices = verticesPosados(maniqui, 2);

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
  resumen.forEach((l) => console.log(l));
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
