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
5. **Los datos del usuario son de su navegador.** Favoritos y, más adelante, series y rutinas. Sin
   cuentas ni servidor: una sola clave de `localStorage`, versionada y con migraciones, y un fichero
   para llevárselos a otro dispositivo, que al importarse **suma** y nunca sustituye. Todo acceso,
   en `try/catch`: en navegación privada lanza. Lo que decide qué se guarda y qué se pierde va en
   funciones puras con test.
6. **Las comprobaciones bloquean el despliegue.** Un aviso que no bloquea acaba ignorándose.

## Mapa

| Dónde | Qué |
|---|---|
| `content/<idioma>/fichas/*.json` | El catálogo. Una ficha por unidad, con su texto. |
| `content/<idioma>/grupos.json` | Los grupos y sus **dos** acentos (claro y oscuro). |
| `content/<idioma>/ui.json` | Todo el texto de interfaz, en los dos idiomas. |
| `content/movimientos/*.json` | Los movimientos del maniquí. Sin idioma. |
| `content/<idioma>/rutinas/*.json` | Rutinas de inicio: contenido con fuentes. Solo se leen y se copian. |
| `content/reglas.json` | Qué valida `validar-contenido.mjs`. **Se edita esto, no el guion.** |
| `public/carteles/*.png` | Imagen fija de cada ficha para el catálogo. Generadas, pero **se versionan**. |
| `src/app/rutas.ts` | Rutas en el fragmento (`#/f/<id>`), con la búsqueda y los filtros dentro. |
| `src/app/datos.js` | Los datos del visitante como valores: migrar, limpiar, fusionar. Puro, con test. |
| `src/app/almacen.ts` | Esos datos en `localStorage`: leer, guardar, avisar, exportar e importar. |
| `src/app/favoritos.ts` | La lista del visitante y el enlace para compartirla, encima de `almacen`. |
| `src/app/registro.ts` · `calculos.js` | Anotar y borrar series; 1RM, sesiones, mejor serie y evolución (puro, con test). |
| `src/app/vistas/` | Bloques que se repintan solos: el registro de la ficha, «Hoy» y «Tus datos». |
| `src/app/rutinas.js` · `mis-rutinas.ts` | Rutinas: normalizar, copiar, progreso y enlace (puro, con test); las del visitante y el plan de hoy. |
| `src/app/descanso.ts` | El temporizador de descanso: barra propia fuera de `#app`, cuenta con la hora de fin. |
| `src/app/pantalla.ts` · `avisos.ts` | Pantalla encendida (wake lock, por razones) y pitido/vibración. |
| `tests/*.test.mjs` | Tests de la lógica pura, con `node --test`. Sin dependencias. |
| `public/sw.js` · `manifest.webmanifest` | La PWA: se instala y abre sin conexión. |
| `src/figura/` | El maniquí: cinemática, visor, mapa muscular y hoja de revisión. |
| `design/tokens.json` · `tokens.css` | Sistema de diseño. Los valores no se escriben sueltos en CSS. |

## Comandos

```bash
npm run dev                   # desarrollo
npm test                      # tests de la lógica pura (node --test)
npm run validar               # tests + contenido + contraste + idiomas + movimiento. Lo que corre CI.
npm run build                 # validar + tsc --noEmit + vite build
npm run hoja                  # hoja de revisión de cada movimiento → capturas/<id>.png
npm run agarre                # fija la mano a la barra, a partir del primer fotograma
npm run carteles              # carteles del catálogo → public/carteles/
npm run auditar               # presupuestos de rendimiento, sobre el build servido
npm run capturar              # recorre el sitio en 2 temas × 2 anchos y caza errores mudos
npm run alineacion            # centrados, alturas, carril izquierdo y desbordes. Bloquea.
npm run metricas              # métricas de la tipografía de respaldo, al cambiar de fuente
npm run iconos                # PNG del icono de la app a partir de public/icono.svg
```

El service worker solo se registra en el build (`import.meta.env.PROD`): en `npm run dev` serviría
módulos viejos de caché. **Al cambiar `public/sw.js`, sube su `VERSION`**, o los que ya lo tienen
instalado no lo renuevan. Y usa `ignoreVary`: GitHub Pages responde con `Vary: Accept-Encoding` y
los módulos se piden con cabecera `Origin`, así que sin él la caché no casaba y la app abría en
blanco sin conexión.

`alineacion` siembra un registro de ejemplo (`scripts/lib/datos-ejemplo.mjs`) en el tema oscuro y
deja el claro vacío: así mira la ficha en sus dos estados.

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

## Al añadir una rutina de inicio

`content/es/rutinas/<id>.json` **y** su gemela en inglés, con los mismos días y ejercicios: solo se
traducen los nombres y el texto (lo vigila `campos_comunes`). `min` y `max` son repeticiones o
segundos según la `medida` de cada ficha. Con fuentes comprobadas y `matices`, como una ficha.

## Al añadir un grupo

Con su `descanso` por defecto en segundos, el mismo en los dos idiomas (lo vigila
`campos_comunes` de `reglas.json`); una ficha que no encaje lo cambia con su propio `descanso`.

Dos acentos, uno por tema —el modo oscuro no es invertir—, con al menos 15° de separación de tono
respecto a los demás. `npm run validar:contraste -- --sugerir` da valores que pasan AA sin cambiar
el tono. El acento del grupo es también el color de los tres grados del mapa muscular.
