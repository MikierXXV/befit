# befit

Ejercicios de gimnasio explicados con un maniquí 3D.

App de catálogo dirigida por contenido. Vite + TypeScript estricto, sin framework. Se publica en
GitHub Pages. Sale de la plantilla con `--tipo app`, y con `--con figura` si lleva maniquí 3D.

## Las seis reglas que no se negocian

1. **El contenido es datos, no código.** Cada unidad es un JSON en `content/<idioma>/fichas/`.
   Añadir contenido no debe tocar TypeScript.
2. **Ningún texto visible dentro del código.** Sale de `content/<idioma>/ui.json` vía `t()`. Lo
   vigila `check-idiomas.mjs` y bloquea el despliegue.
3. **El movimiento no se traduce.** Vive en `content/movimientos/`, fuera de los idiomas, y cada
   ficha lo referencia con `movimiento_id`. Dentro de la ficha estaría duplicado por idioma, y una
   corrección en español dejaría la versión inglesa con la rodilla vieja.
4. **Un solo contexto WebGL vivo a la vez.** El catálogo usa carteles (imágenes); el maniquí solo se
   monta en la ficha abierta, y `destruir()` libera el contexto al salir. Lo comprueba `auditar.mjs`.
5. **Los favoritos son del navegador.** Sin cuentas ni servidor: `localStorage` y un enlace para
   llevárselos a otro dispositivo. Todo acceso, en `try/catch`: en navegación privada lanza.
6. **Las comprobaciones bloquean el despliegue.** Un aviso que no bloquea acaba ignorándose.

## Mapa

| Dónde | Qué |
|---|---|
| `content/<idioma>/fichas/*.json` | El catálogo. Una ficha por unidad, con su texto. |
| `content/<idioma>/grupos.json` | Los grupos y sus **dos** acentos (claro y oscuro). |
| `content/<idioma>/ui.json` | Todo el texto de interfaz, en los dos idiomas. |
| `content/movimientos/*.json` | Los movimientos del maniquí. Sin idioma. |
| `content/reglas.json` | Qué valida `validar-contenido.mjs`. **Se edita esto, no el guion.** |
| `public/carteles/*.png` | Imagen fija de cada ficha para el catálogo. Generadas, pero **se versionan**. |
| `src/app/rutas.ts` | Rutas en el fragmento (`#/f/<id>`), con la búsqueda y los filtros dentro. |
| `src/app/favoritos.ts` | La lista del visitante y el enlace para compartirla. |
| `src/figura/` | El maniquí: cinemática, visor, mapa muscular y hoja de revisión. |
| `design/tokens.json` · `tokens.css` | Sistema de diseño. Los valores no se escriben sueltos en CSS. |

## Comandos

```bash
npm run dev                   # desarrollo
npm run validar               # contenido + contraste + idiomas + movimiento. Es lo que corre CI.
npm run build                 # validar + tsc --noEmit + vite build
npm run hoja                  # hoja de revisión de cada movimiento → capturas/<id>.png
npm run agarre                # fija la mano a la barra, a partir del primer fotograma
npm run carteles              # carteles del catálogo → public/carteles/
npm run auditar               # presupuestos de rendimiento, sobre el build servido
npm run capturar              # recorre el sitio en 2 temas × 2 anchos y caza errores mudos
npm run alineacion            # centrados, alturas, carril izquierdo y desbordes. Bloquea.
npm run metricas              # métricas de la tipografía de respaldo, al cambiar de fuente
```

`hoja`, `carteles`, `auditar`, `capturar` y `alineacion` necesitan el sitio compilado y servido:
`npm run build && npx vite preview --port 4173`.

Y `carteles` escribe en `public/`, que solo entra en `dist/` al compilar: **después de generar
carteles hay que volver a compilar** antes de capturar, o las capturas enseñan los carteles viejos.
Pasó: un cartel corregido seguía saliendo mal en el catálogo tres capturas seguidas.

## Al añadir una ficha

1. JSON en `content/es/fichas/` **y** en `content/en/fichas/`, con `orden` contiguo dentro del grupo.
2. Si lleva maniquí: el movimiento en `content/movimientos/<id>.json` y `movimiento_id` en la ficha.
3. `npm run validar`. El movimiento se valida posando el maniquí en 48 fotogramas del ciclo: rangos
   articulares, objetivos que no se alcanzan, piel bajo el suelo o dentro de un implemento.
4. `npm run hoja` y **mirar la hoja**. El validador sabe si una rodilla pasa de 155°; no sabe si el
   ejercicio parece lo que dice ser.
5. Si las manos van a una barra, `npm run agarre` DESPUÉS de mirar la hoja: congela la orientación
   de la mano respecto a la barra tomándola del primer fotograma, y con eso deja de girar durante el
   recorrido. Lo que se congele es lo que se verá todo el rato, así que primero se revisa y luego se
   fija. Y se vuelve a fijar si se cambia la postura inicial.
   Si el agarre es supino —palmas hacia la cara, o hacia arriba en la sentadilla frontal—, el
   implemento lleva `"agarre_supino": true` y el calibrador gira la mano media vuelta alrededor de
   la barra. La cinemática siempre deduce pronación, porque saca el marco de la mano del antebrazo.
6. `npm run carteles` para el cartel del catálogo.
7. Los pasos de `ejecucion` son también la alternativa para quien no ve el maniquí: tienen que
   bastar por sí solos.

## Al añadir un grupo

Dos acentos, uno por tema —el modo oscuro no es invertir—, con al menos 15° de separación de tono
respecto a los demás. `npm run validar:contraste -- --sugerir` da valores que pasan AA sin cambiar
el tono. El acento del grupo es también el color de los tres grados del mapa muscular.
