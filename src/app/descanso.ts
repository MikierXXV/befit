/**
 * El temporizador de descanso: arranca al anotar una serie y avisa cuando toca la siguiente.
 *
 * VIVE FUERA DE LA PÁGINA, en una barra propia colgada del <body>. La app repinta `#app` entero al
 * cambiar de ruta, y un temporizador dentro moría al volver al catálogo a mirar otro ejercicio, que
 * es justo lo que se hace mientras se descansa.
 *
 * CUENTA CON LA HORA DE FIN, no restando segundos. Un navegador frena los intervalos de una pestaña
 * en segundo plano a uno por minuto, o los para: un descanso que restara uno por tic se quedaría en
 * 1:12 mientras se mira un mensaje, y al volver seguiría contando desde ahí.
 *
 * Y SOBREVIVE A UNA RECARGA: la hora de fin se guarda en sessionStorage. Cambiar de idioma recarga
 * la página, y sin esto se llevaba el descanso por delante.
 */

import { datos, modificar } from './almacen';
import { pitar, prepararAudio, vibrar } from './avisos';
import { reloj } from './calculos.js';
import { mantenerEncendida } from './pantalla';
import { t } from './textos';

interface Estado {
  ejercicio: string;
  nombre: string;
  fin: number;
  total: number;
}

const CLAVE = 'befit.descanso';
const PASO = 15;
/** Lo que se queda en pantalla el aviso de «terminado» antes de irse solo. */
const AVISO_MS = 20000;

let estado: Estado | null = null;
let terminado = false;
let intervalo = 0;
let cierre = 0;

const barra = document.createElement('aside');
barra.className = 'descanso';
barra.hidden = true;
barra.setAttribute('aria-label', t('descanso.titulo'));
document.body.append(barra);

/** El descanso de un ejercicio: el que ajustó el visitante, o el que propone el contenido. */
export const descansoPara = (ejercicio: string, porDefecto: number): number => datos().descansos[ejercicio] ?? porDefecto;

export function iniciarDescanso(ejercicio: string, nombre: string, segundos: number): void {
  prepararAudio();
  estado = { ejercicio, nombre, fin: Date.now() + segundos * 1000, total: segundos };
  terminado = false;
  clearTimeout(cierre);
  guardar();
  pintar();
  arrancar();
}

const restante = (): number => (estado ? (estado.fin - Date.now()) / 1000 : 0);

function arrancar(): void {
  clearInterval(intervalo);
  mantenerEncendida('descanso', true);
  // Cuatro veces por segundo y no una: con un tic por segundo, la cifra cambiaba hasta un segundo
  // tarde según dónde cayera el primero, y se notaba al mirarlo junto al reloj de la pared.
  intervalo = window.setInterval(tic, 250);
  tic();
}

function tic(): void {
  if (!estado || terminado) return;
  const quedan = restante();
  if (quedan <= 0) { terminar(); return; }
  const tiempo = barra.querySelector('.tiempo');
  if (tiempo) tiempo.textContent = reloj(quedan);
  barra.querySelector<HTMLElement>('.progreso span')?.style.setProperty('--avance-descanso', String(1 - quedan / estado.total));
}

function terminar(): void {
  clearInterval(intervalo);
  terminado = true;
  pitar();
  vibrar();
  mantenerEncendida('descanso', false);
  guardar();
  pintar();
  cierre = window.setTimeout(cerrar, AVISO_MS);
}

function cerrar(): void {
  clearInterval(intervalo);
  clearTimeout(cierre);
  estado = null;
  terminado = false;
  mantenerEncendida('descanso', false);
  guardar();
  pintar();
}

/**
 * ±15 s, y se RECUERDA para ese ejercicio: quien acorta el descanso de las elevaciones laterales
 * cada vez que las hace quiere que la próxima vez empiece ya acortado.
 */
function ajustar(delta: number): void {
  if (!estado) return;
  const total = Math.min(600, Math.max(PASO, estado.total + delta));
  estado.fin += (total - estado.total) * 1000;
  estado.total = total;
  const { ejercicio } = estado;
  modificar((d) => ({ ...d, descansos: { ...d.descansos, [ejercicio]: total } }));
  if (restante() <= 0) { terminar(); return; }
  guardar();
  pintar();
}

function guardar(): void {
  try {
    if (estado && !terminado) sessionStorage.setItem(CLAVE, JSON.stringify(estado));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    // Sin almacenamiento, el descanso dura lo que la página. Sigue sirviendo.
  }
}

const escapar = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function pintar(): void {
  barra.hidden = !estado;
  document.body.classList.toggle('con-descanso', !!estado);
  if (!estado) { barra.innerHTML = ''; return; }
  barra.classList.toggle('listo', terminado);
  barra.innerHTML = `
    <div class="dentro">
      <div class="progreso" aria-hidden="true"><span></span></div>
      <p class="que"><span class="titulo">${t(terminado ? 'descanso.terminado' : 'descanso.titulo')}</span>
         <span class="nombre">${escapar(estado.nombre)}</span></p>
      ${terminado ? '' : `<span class="tiempo" role="timer">${reloj(restante())}</span>`}
      <div class="mandos">
        ${terminado
          ? `<button type="button" class="boton" data-cerrar>${t('descanso.cerrar')}</button>`
          : `<button type="button" class="boton" data-ajustar="-${PASO}" aria-label="${t('descanso.menos_largo')}">${t('descanso.menos')}</button>
             <button type="button" class="boton" data-ajustar="${PASO}" aria-label="${t('descanso.mas_largo')}">${t('descanso.mas')}</button>
             <button type="button" class="boton" data-cerrar>${t('descanso.saltar')}</button>`}
      </div>
      <p class="oculto" role="status">${terminado ? t('descanso.terminado') : ''}</p>
    </div>`;
  tic();
}

barra.addEventListener('click', (e) => {
  const boton = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!boton) return;
  if (boton.dataset.ajustar) ajustar(Number(boton.dataset.ajustar));
  if ('cerrar' in boton.dataset) cerrar();
});

// Retomar un descanso que seguía en marcha antes de recargar. Si ya pasó, no se avisa tarde.
try {
  const guardado = JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null') as Estado | null;
  if (guardado && guardado.fin > Date.now()) {
    estado = guardado;
    pintar();
    arrancar();
  } else {
    sessionStorage.removeItem(CLAVE);
  }
} catch {
  // Nada que retomar.
}
