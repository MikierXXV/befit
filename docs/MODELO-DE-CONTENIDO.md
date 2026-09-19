# Modelo de contenido de befit

Decidido el 18-09-2026, con las primeras fichas delante. Lo que está aquí es lo que **no** se puede
deducir leyendo el código.

## La unidad es el ejercicio; el grupo es el patrón de movimiento

Un ejercicio es una ficha. Los ejercicios se agrupan por **patrón de movimiento** —sentadilla,
bisagra de cadera, zancada, empuje y tirón (horizontal y vertical), core—, **no por músculo**.

Por qué, y esto ya costó una refactorización en elrincondelareflexion: un ejercicio trabaja varios
músculos a la vez. Agrupar por músculo obliga a elegir uno y deja los demás fuera del recorrido; el
press de banca tendría que vivir en «pectoral» y renunciar a tríceps y deltoides, o duplicarse. El
patrón, en cambio, es una propiedad del ejercicio y no un reparto arbitrario: una sentadilla es una
sentadilla lleve barra, mancuerna o nada.

Los músculos no desaparecen: van dentro de la ficha **con un rol** —principal, sinergista,
estabilizador— y son uno de los filtros del catálogo. Es la misma solución que en el rincón, donde
los autores pasaron a ser figuras dentro de la idea.

## Ocho grupos

| id | Qué lo define |
|---|---|
| `sentadilla` | Cadera y rodillas se doblan a la vez, tronco más o menos vertical. |
| `bisagra-cadera` | La cadera va atrás con las rodillas casi fijas. El movimiento está en la cadera, no en la espalda. |
| `zancada` | Lo mismo que una sentadilla, pero con las piernas desalineadas y una carga por pierna. |
| `empuje-horizontal` | Alejar la carga del pecho. |
| `empuje-vertical` | Llevar la carga por encima de la cabeza. |
| `tiron-horizontal` | Traer la carga al tronco. |
| `tiron-vertical` | Traer la carga desde arriba, o subir el cuerpo hasta ella. |
| `core` | **Resistir** que el tronco se doble o gire, más que doblarlo a propósito. |

Los casos que no encajan del todo —un peso muerto convencional es bisagra con mucha rodilla— van al
patrón que más manda, y se dice en el resumen. Inventar un noveno grupo para las excepciones deja
un cajón de sastre que nadie filtra.

## Qué lleva una ficha

`nombre`, `resumen` (40-300 caracteres), `ejecucion` (los pasos), `material`, `nivel` y `musculos`
por rol. Opcionalmente `movimiento_id`, que la conecta con su maniquí.

**Los pasos son también la alternativa textual**: quien no ve el maniquí —porque no le carga, porque
usa lector de pantalla o porque pidió no ver movimiento— tiene que poder ejecutar el ejercicio solo
con ellos. Si los pasos necesitan la animación para entenderse, están mal escritos.

## El contenido va por delante de la animación

Una ficha sin `movimiento_id` es válida y se publica: sale en el catálogo y se lee entera. Animar un
movimiento cuesta bastante más que escribir una ficha, y bloquear la ficha hasta tener el maniquí
significa publicar menos contenido del que ya está listo.

Lo que **no** se hace es al revés: un movimiento sin ficha no sale a ningún sitio, y el validador
avisa de que sobra.

## Lo que falta decidir

- **Cuántos ejercicios** en la primera versión pública, y en qué orden se animan.
- **Las fuentes**: hoy los roles musculares son los estándar de manual; falta contrastarlos y citar.
  Ver el plan, fase 3.
- **El aviso sanitario**, que tiene que estar antes de publicar.
