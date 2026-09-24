/**
 * Carga de contenido de una app de catálogo.
 *
 * Dos capas, y la separación es la decisión de diseño de esta variante:
 *
 *  - **fichas y grupos** están en `content/<idioma>/`: son texto, y se traducen;
 *  - **movimientos** están en `content/movimientos/`: son geometría, y NO se traducen.
 *
 * Meter el movimiento dentro de la ficha parece más simple hasta que hay dos idiomas: entonces cada
 * pose vive por duplicado, alguien corrige una rodilla en español y la versión inglesa se queda con
 * la rodilla vieja. Nadie lo ve, porque nadie revisa el idioma que no habla.
 */

import type { Rutina } from './rutinas.js';
import { t } from './textos';

export interface Grupo {
  id: string;
  nombre: string;
  descripcion?: string;
  orden: number;
  /** Descanso por defecto entre series de sus ejercicios, en segundos. */
  descanso?: number;
  /** Un color por tema. El modo oscuro no es invertir; lo exige AA en los dos, ver check-contraste.mjs. */
  color_acento?: { claro: string; oscuro: string };
}

/** Una rutina de inicio: contenido, con fuentes, como una ficha. Ver content/schema/rutina.schema.json. */
export interface RutinaDeInicio extends Rutina {
  resumen: string;
  nivel: 'inicial' | 'intermedio' | 'avanzado';
  /** Días de entrenamiento por semana. */
  frecuencia: number;
  matices?: string;
  fuentes?: Array<{ titulo: string; url?: string; autor?: string }>;
}

export type Rol = 'principal' | 'sinergista' | 'estabilizador';

export interface Ficha {
  id: string;
  grupo_id: string;
  orden: number;
  nombre: string;
  resumen: string;
  ejecucion?: string[];
  material?: string[];
  nivel?: 'inicial' | 'intermedio' | 'avanzado';
  /** Qué se anota en el registro. Sin el campo, repeticiones; `tiempo` en los que se sostienen. */
  medida?: 'reps' | 'tiempo';
  /** Descanso entre series si no es el del grupo, en segundos. */
  descanso?: number;
  musculos?: Partial<Record<Rol, string[]>>;
  /** Lo que las fuentes no cierran. Se pinta aparte, no mezclado con lo que sí se sostiene. */
  matices?: string;
  /** Fichero de content/movimientos/. Sin él, la ficha es solo texto. */
  movimiento_id?: string;
  fuentes?: Array<{ titulo: string; url?: string; autor?: string }>;
}

const ficherosGrupos = import.meta.glob<{ default: { grupos: Grupo[] } }>('../../content/*/grupos.json', { eager: true });
const ficherosFichas = import.meta.glob<{ default: Ficha }>('../../content/*/fichas/*.json', { eager: true });
const ficherosRutinas = import.meta.glob<{ default: RutinaDeInicio }>('../../content/*/rutinas/*.json', { eager: true });
const ficherosMovimientos = import.meta.glob<{ default: unknown }>('../../content/movimientos/*.json', { eager: true });

const idioma = () => document.documentElement.lang || 'es';
const delIdioma = <T>(ficheros: Record<string, { default: T }>): T[] =>
  Object.entries(ficheros).filter(([ruta]) => ruta.includes(`/${idioma()}/`)).map(([, m]) => m.default);

export const GRUPOS: Grupo[] = (delIdioma(ficherosGrupos)[0]?.grupos ?? []).slice().sort((a, b) => a.orden - b.orden);

/*
 * Orden del catálogo: primero el grupo, después la ficha dentro del grupo. Con solo `orden`, dos
 * fichas de grupos distintos empatan y el catálogo sale en el orden en que el empaquetador leyó los
 * ficheros, que es alfabético y no significa nada para quien lo lee.
 */
export const FICHAS: Ficha[] = delIdioma(ficherosFichas)
  .slice()
  .sort((a, b) => (ordenDeGrupo(a.grupo_id) - ordenDeGrupo(b.grupo_id)) || (a.orden - b.orden));

function ordenDeGrupo(id: string): number {
  return GRUPOS.find((g) => g.id === id)?.orden ?? Number.MAX_SAFE_INTEGER;
}

export const MOVIMIENTOS: Record<string, unknown> = Object.fromEntries(
  Object.entries(ficherosMovimientos).map(([ruta, m]) => [ruta.split('/').pop()!.replace('.json', ''), m.default]),
);

export const fichaPorId = (id: string): Ficha | undefined => FICHAS.find((f) => f.id === id);
export const grupoPorId = (id: string): Grupo | undefined => GRUPOS.find((g) => g.id === id);

/** Valores presentes en el catálogo para un campo de lista, para construir los filtros. */
export function valoresDe(campo: 'material' | 'nivel' | 'musculos'): string[] {
  const vistos = new Set<string>();
  for (const f of FICHAS) {
    if (campo === 'nivel') { if (f.nivel) vistos.add(f.nivel); continue; }
    if (campo === 'material') { (f.material ?? []).forEach((m) => vistos.add(m)); continue; }
    for (const lista of Object.values(f.musculos ?? {})) lista.forEach((m) => vistos.add(m));
  }
  return [...vistos].sort((a, b) => etiqueta(campo, a).localeCompare(etiqueta(campo, b)));
}

/**
 * Nombre visible de un valor de catálogo (`barra` → «Barra»).
 *
 * Pasa por ui.json y no por el JSON de la ficha a propósito: si el nombre visible viviera en cada
 * ficha, «mancuerna» estaría escrito ochenta veces y traducido ochenta veces.
 */
export function etiqueta(campo: string, valor: string): string {
  return t(`catalogo.${campo}.${valor}`) === `catalogo.${campo}.${valor}` ? valor : t(`catalogo.${campo}.${valor}`);
}

/**
 * El descanso que propone el contenido para una ficha: el suyo, o el de su grupo, o 90 s.
 *
 * El último recurso existe para que el temporizador no se quede sin valor si un grupo nuevo se
 * publica sin el campo; el esquema no lo exige para no romper los proyectos que salen de la plantilla.
 */
export const descansoDe = (f: Ficha): number => f.descanso ?? grupoPorId(f.grupo_id)?.descanso ?? 90;

/** Las rutinas de inicio del idioma, en el orden de su nivel: primero la de quien empieza. */
export const RUTINAS: RutinaDeInicio[] = delIdioma(ficherosRutinas)
  .slice()
  .sort((a, b) => ['inicial', 'intermedio', 'avanzado'].indexOf(a.nivel) - ['inicial', 'intermedio', 'avanzado'].indexOf(b.nivel) || a.frecuencia - b.frecuencia);
