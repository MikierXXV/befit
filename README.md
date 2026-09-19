# befit

Ejercicios de gimnasio explicados con un maniquí 3D.

## Arrancar

```bash
npm install
npm run validar   # contenido, contraste y textos: debe pasar antes de tocar nada
npm run dev
```

## Estructura

```
content/          el contenido, en JSON. Es la fuente de verdad.
  reglas.json     qué se valida. Se edita esto, no el validador.
  schema/         la forma de cada tipo de ficha
  es/             familias, textos de interfaz y una ficha por pieza
design/           tokens del sistema de diseño
src/
  app/            contenido, tema, textos, índice y escenografía
    efectos.ts    registro de efectos: qué puede pedir el contenido
  estilos/        maqueta, escenografía e índice
  vis/            lenguaje gráfico, andamiaje 3D y registro
    mecanicas/    las visualizaciones parametrizadas
scripts/          validación, auditoría y preparación de modelos
```

El movimiento se declara desde el contenido, no se programa:

```json
"escena": { "tipo": "cubierta", "tono": "oscuro", "velo": "grano", "entrada": "deriva" }
```

## Publicar

Crear el repositorio y empujar. Después, en **Settings → Pages → Source: GitHub Actions**. No hace
falta rama `gh-pages` ni ningún secreto: el flujo usa el despliegue oficial con `id-token`.

```bash
git init -b main
git add .
git commit -m "befit"
git remote add origin https://github.com/<usuario>/<repo>.git
git push -u origin main
```

A partir de ahí, cada `push` a `main` publica —si valida—. La base del sitio se deduce del nombre
del repositorio, así que renombrarlo no rompe el despliegue en silencio.

## Qué bloquea la publicación

| Comprobación | Qué exige |
|---|---|
| `validar-contenido.mjs` | schema, referencias en los dos sentidos, orden sin huecos, límites de longitud, citas breves, presupuesto 3D, efectos existentes y su presupuesto |
| `check-contraste.mjs` | WCAG 2.1 AA en los dos temas, y acentos distinguibles entre sí |
| `check-idiomas.mjs` | ningún texto visible escrito dentro del código |
| `tsc --noEmit` | TypeScript en estricto |
| `vite build` | que compile |

No bloquean pero fallan a la vista, en un trabajo aparte: `capturar-sitio.mjs` —errores mudos,
huecos vacíos, legibilidad en móvil, rótulos que se pisan, índice ilegible sobre una parada de otro
tono, bloques que nunca entran, desbordamiento horizontal y CSS que anima la maqueta— y `auditar.mjs` —presupuestos de carga, contextos WebGL y fluidez al recorrerlo—.
