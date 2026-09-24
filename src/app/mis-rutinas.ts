/**
 * Las rutinas del visitante y el plan de hoy, encima del almacén común.
 *
 * Las de inicio son CONTENIDO y no se tocan: tienen fuentes, y una rutina con fuentes que alguien
 * ha cambiado ya no es la que las fuentes respaldan. Para cambiar una, se copia.
 */

import { datos, modificar } from './almacen';
import { hoy } from './calculos.js';
import { FICHAS, RUTINAS, type RutinaDeInicio } from './contenido';
import { aEnlace, copiarRutina, normalizarRutina, type Rutina } from './rutinas.js';

const ids = new Set(FICHAS.map((f) => f.id));

export const misRutinas = (): Rutina[] => datos().rutinas;

export interface Encontrada {
  rutina: Rutina;
  /** La de inicio, si lo es: con su resumen, nivel y fuentes. */
  deInicio: RutinaDeInicio | null;
}

export function buscarRutina(id: string): Encontrada | null {
  const deInicio = RUTINAS.find((r) => r.id === id);
  if (deInicio) return { rutina: deInicio, deInicio };
  const propia = misRutinas().find((r) => r.id === id);
  return propia ? { rutina: propia, deInicio: null } : null;
}

/**
 * Ids de las rutinas del visitante con un prefijo que ninguna de inicio usa: sin él, una rutina de
 * inicio nueva que se llamara igual que el id de una del usuario taparía la suya al buscarla.
 */
const nuevoId = (): string => `mia-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Deja fuera los ejercicios que no están en el catálogo. Una rutina que llega por enlace puede
 * nombrar uno que aquí no existe —de otra versión, o inventado—, y pintarlo sería un hueco sin
 * nombre ni maniquí en mitad del día.
 */
function soloDelCatalogo(r: Rutina): Rutina {
  return { ...r, dias: r.dias.map((d) => ({ ...d, ejercicios: d.ejercicios.filter((o) => ids.has(o.ejercicio)) })) };
}

export function guardarRutina(r: Rutina): void {
  const limpia = normalizarRutina(soloDelCatalogo(r));
  if (!limpia) return;
  modificar((d) => ({
    ...d,
    rutinas: d.rutinas.some((x) => x.id === limpia.id) ? d.rutinas.map((x) => (x.id === limpia.id ? limpia : x)) : [...d.rutinas, limpia],
  }));
}

export function nuevaRutina(nombre: string, nombreDia: string): Rutina {
  const r: Rutina = { id: nuevoId(), nombre, dias: [{ nombre: nombreDia, ejercicios: [] }] };
  guardarRutina(r);
  return r;
}

export function copiar(origen: Rutina, nombre: string): Rutina {
  const copia = copiarRutina(origen, nuevoId(), nombre);
  guardarRutina(copia);
  return copia;
}

/** Guarda una rutina que llegó por enlace, con un id nuevo de este dispositivo. */
export function guardarCompartida(r: Rutina): Rutina {
  const suya = { ...r, id: nuevoId() };
  guardarRutina(suya);
  return suya;
}

export function borrarRutina(id: string): void {
  // Si era la del plan de hoy, el plan se va con ella: un plan que apunta a una rutina borrada
  // dejaba «Hoy» buscando ejercicios que ya no estaban en ninguna parte.
  modificar((d) => ({ ...d, rutinas: d.rutinas.filter((r) => r.id !== id), plan: d.plan?.rutina === id ? null : d.plan }));
}

export function enlaceCompartir(r: Rutina): string {
  return `${location.origin}${location.pathname}#/rutina/compartida?r=${encodeURIComponent(aEnlace(r))}`;
}

/** Elige un día de una rutina como plan de hoy. */
export function empezarDia(rutina: string, dia: number): void {
  modificar((d) => ({ ...d, plan: { fecha: hoy(), rutina, dia } }));
}

export function dejarPlan(): void {
  modificar((d) => ({ ...d, plan: null }));
}

/**
 * El plan de hoy, si lo hay y sigue siendo de hoy. Un plan de ayer no se borra al cambiar de día:
 * simplemente deja de valer, y así no hace falta ningún temporizador que lo limpie a medianoche.
 */
export interface PlanDeHoy extends Encontrada {
  dia: number;
  nombreDia: string;
  ejercicios: Rutina['dias'][number]['ejercicios'];
}

export function planDeHoy(): PlanDeHoy | null {
  const plan = datos().plan;
  if (!plan || plan.fecha !== hoy()) return null;
  const encontrada = buscarRutina(plan.rutina);
  const dia = encontrada?.rutina.dias[plan.dia];
  if (!encontrada || !dia) return null;
  return { ...encontrada, dia: plan.dia, nombreDia: dia.nombre, ejercicios: dia.ejercicios.filter((o) => ids.has(o.ejercicio)) };
}
