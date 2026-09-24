/**
 * Un registro de ejemplo para las comprobaciones visuales.
 *
 * Sin esto, `alineacion` y `capturar` solo veían la ficha recién estrenada: el formulario y una
 * frase. La lista de series, las marcas, la gráfica y el historial —lo que de verdad puede
 * descuadrarse— no los miraba nadie.
 *
 * Las fechas son RELATIVAS a hoy, no fijas: con fechas fijas nunca habría series «de hoy», y ese es
 * justo el bloque con botones de borrar, el que más fácil se sale de la retícula de alturas.
 *
 * Sin favoritos, a propósito: así la pantalla de favoritos sigue enseñando su estado vacío, que
 * también hay que comprobar.
 */
export function datosDeEjemplo(ahora = new Date()) {
  const dia = (atras) => {
    const d = new Date(ahora);
    d.setDate(d.getDate() - atras);
    const dos = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  };
  let n = 0;
  const serie = (ejercicio, atras, extra) => ({ id: `ejemplo-${(n += 1)}`, ejercicio, fecha: dia(atras), creada: n, ...extra });
  return {
    version: 1,
    favoritos: [],
    series: [
      ...[[28, 60, 8], [21, 62.5, 8], [14, 65, 6], [7, 67.5, 5], [0, 70, 5]].flatMap(([atras, peso, reps]) => [
        serie('sentadilla-barra', atras, { peso, reps, rir: 2 }),
        serie('sentadilla-barra', atras, { peso, reps: reps - 1 }),
      ]),
      ...[[9, 30], [5, 40], [0, 45]].map(([atras, segundos]) => serie('plancha-frontal', atras, { segundos })),
    ],
  };
}
