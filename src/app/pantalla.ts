/**
 * Que la pantalla no se apague mientras hace falta mirarla.
 *
 * En el gimnasio el móvil está en el banco entre serie y serie, y con el bloqueo a los 30 s el
 * temporizador de descanso terminaba con la pantalla negra: había que desbloquear para saber si ya
 * tocaba. La Screen Wake Lock API lo evita, y la llevan Chrome, Edge y Safari desde iOS 16.4.
 *
 * VARIAS RAZONES, UN SOLO BLOQUEO. La pantalla «Hoy», el temporizador y el cronómetro la piden cada
 * uno por su lado; se suelta cuando no queda ninguno. Con un simple sí/no, el temporizador al acabar
 * soltaba el bloqueo que la pantalla «Hoy» seguía necesitando.
 *
 * Y SE PIDE OTRA VEZ al volver a la pestaña: el navegador lo suelta solo cada vez que la página se
 * oculta, y no avisa de que no lo devuelve.
 */

const razones = new Set<string>();
let bloqueo: WakeLockSentinel | null = null;

async function actualizar(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    if (razones.size && !bloqueo && document.visibilityState === 'visible') {
      bloqueo = await navigator.wakeLock.request('screen');
      bloqueo.addEventListener('release', () => { bloqueo = null; });
    } else if (!razones.size && bloqueo) {
      await bloqueo.release();
      bloqueo = null;
    }
  } catch {
    // Sin permiso, sin batería o sin soporte: la app sigue, solo que la pantalla se apagará.
  }
}

export function mantenerEncendida(razon: string, si: boolean): void {
  if (si) razones.add(razon);
  else razones.delete(razon);
  void actualizar();
}

document.addEventListener('visibilitychange', () => { void actualizar(); });
