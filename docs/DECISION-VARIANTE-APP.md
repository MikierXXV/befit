# Decisión: variante `app` y módulo `figura`

Estado: **propuesta**, 16-09-2026. La prueba técnica de befit (`befit-fase0/docs/RESULTADOS.md`)
confirmó que el módulo `figura` funciona; la variante `app` está por construir.

## El problema

La plantilla nació del rincón y da por hecho un **sitio de contenido**: una página que se recorre
con scroll, paradas por familia, escenografía y el 3D como excepción (`presupuesto_3d`,
`justificacion_3d`). El proyecto de gimnasio es otra cosa:

- es una **app**: catálogo, filtros, buscador, ficha por ejercicio y favoritos del usuario;
- el 3D **es el formato de cada ficha**, no una excepción que haya que justificar;
- tiene estado que persiste entre visitas (los favoritos).

## Lo que se descartó

**Ampliar la plantilla tal cual.** Todos los sitios de contenido arrastrarían rutas, estado y un
visor animado que no usan, y el recorrido con escenografía pelea con una app de catálogo: habría que
desactivar media plantilla en cada proyecto de app, y lo que se desactiva a mano se olvida.

**Una segunda plantilla en otro repo.** Vite, tsconfig, despliegue, validadores, tokens, contraste,
paridad de idiomas, `escena3d.ts` y las comprobaciones de navegador son idénticos. Copiarlos a otro
repo es tener dos versiones al primer arreglo, y el arreglo acaba en una sola.

## Lo que se propone

Un solo repo, con capas:

```
plantilla-sitio/
  (base)              lo común: config, validadores, tokens, escena3d, auditoría, despliegue
  variantes/app/      rutas, catálogo, filtros, favoritos; sustituye recorrido y escenografía
  modulos/figura/     maniquí, reproductor de poses, schema y validador de movimiento, carteles
```

```bash
node crear.mjs ../x --tipo contenido            # lo de siempre, por defecto: nada cambia
node crear.mjs ../x --tipo app --con figura     # gimnasio
node crear.mjs ../x --tipo contenido --con figura   # p. ej. un sitio divulgativo de yoga
```

- `--tipo contenido` sigue siendo el valor por defecto, así que los sitios existentes y su flujo no
  cambian.
- `figura` es **módulo y no variante** porque no depende de que sea app: un sitio divulgativo sobre
  ergonomía también querría un cuerpo que se mueve.
- La variante `app` **sustituye** ficheros, no los parchea: si parchease, cada cambio en la base
  podría romperla sin avisar.

## Lo que cuesta

- `crear.mjs` deja de ser una copia plana: copia la base, luego la variante y luego los módulos.
- Las comprobaciones de la plantilla hay que pasarlas **en cada combinación** que se use, no solo en
  la de por defecto. Lo que no se prueba en una combinación se rompe en esa combinación.
- Skills nuevas o ampliadas: `figura-animada` (nueva), `nuevo-sitio` (pregunta el tipo) y
  `modelo-de-contenido` (schema de movimiento).
