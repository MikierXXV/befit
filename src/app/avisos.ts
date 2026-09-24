/**
 * Pitido y vibración para cuando termina un descanso o arranca el cronómetro.
 *
 * El sonido es un oscilador de Web Audio y no un fichero: tres notas no justifican una petición ni
 * un recurso que el service worker tenga que guardar.
 *
 * EL CONTEXTO DE AUDIO SE PREPARA AL PULSAR, no al sonar. Los navegadores solo dejan arrancar audio
 * dentro de un gesto del usuario, y el final de un descanso llega dos minutos después del último
 * toque: creado ahí, el contexto nacía suspendido y el pitido no sonaba nunca. Por eso quien
 * arranca un reloj llama antes a `prepararAudio()`, dentro de su clic.
 *
 * En iOS, con el interruptor de silencio puesto, Web Audio no suena. La vibración tampoco existe en
 * Safari. Lo que queda siempre es el aviso en pantalla, que por eso no depende de ninguno de los dos.
 */

let audio: AudioContext | null = null;

export function prepararAudio(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}

/** Notas en hercios, de 180 ms cada una y separadas un cuarto de segundo. */
export function pitar(notas: number[] = [880, 880, 1320]): void {
  const ctx = audio;
  if (!ctx) return;
  const cero = ctx.currentTime;
  notas.forEach((hz, n) => {
    const inicio = cero + n * 0.25;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.frequency.value = hz;
    // Rampa de entrada y de salida: un oscilador que empieza y acaba en seco hace un chasquido.
    vol.gain.setValueAtTime(0.0001, inicio);
    vol.gain.exponentialRampToValueAtTime(0.3, inicio + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.18);
    osc.connect(vol).connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + 0.2);
  });
}

export function vibrar(patron: number[] = [200, 100, 200, 100, 400]): void {
  try {
    navigator.vibrate?.(patron);
  } catch {
    // Sin vibración no pasa nada: el aviso en pantalla sigue ahí.
  }
}
