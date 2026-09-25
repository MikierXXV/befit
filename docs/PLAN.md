# Plan de befit — dónde estamos

El plan vivía en la conversación y por eso se perdía a cada rato. Queda escrito aquí, con lo hecho
marcado y con la prueba de que está hecho: un comando que se puede volver a correr, no una opinión.

Estado a 19-09-2026.

---

## Fase 0 — Decidir y montar el andamio ✅

Lo que había que resolver antes de escribir nada.

| | Decisión | Dónde queda |
|---|---|---|
| ✅ | Maniquí 3D **gratuito y redistribuible** (Quaternius, CC0), mapa muscular Apache 2.0 | `assets-originales/CREDITOS-maniqui.md` |
| ✅ | **Variante** de la plantilla, no proyecto aparte, con el motivo por escrito | `docs/DECISION-VARIANTE-APP.md` |
| ✅ | Plantilla por capas: base → `variantes/app` → `modulos/figura` | `plantilla-sitio/crear.mjs` |
| ✅ | Familia = **patrón de movimiento**, no músculo | `docs/MODELO-DE-CONTENIDO.md` |
| ✅ | Español e inglés, movimiento sin idioma | `content/movimientos/` fuera de `es/` y `en/` |
| ✅ | Favoritos en el navegador, sin cuentas | `src/app/favoritos.ts` |

## Fase 1 — Que el maniquí se mueva bien ✅

No «que se mueva»: que un entrenador no señale nada raro.

- ✅ Motor de poses: ángulos anatómicos → huesos, IK de dos huesos, agarres declarados.
- ✅ Naturalidad medida con números, no a ojo: interpolación de Hermite con tangentes limitadas,
  desfase entre segmentos, asimetría, respiración. Sin saltos de velocidad entre claves.
- ✅ **Los dos arreglos que pediste**: la punta del pie se dobla en las flexiones y las manos se
  quedan sujetas a barras y mancuernas durante todo el ciclo.
- ✅ Músculo pintado en **tres grados** de esfuerzo, no en uno.
- ✅ `npm run validar` posa el maniquí en 48 fotogramas y bloquea: rangos articulares, objetivos que
  no se alcanzan, piel bajo el suelo o dentro de un implemento.
- ✅ `npm run hoja` saca la hoja de revisión de cada movimiento, para mirarla.

## Fase 2 — El catálogo ✅ (con hueco reconocido)

- ✅ Catorce ejercicios, en los dos idiomas, con maniquí los catorce.
- ✅ Ocho patrones cubiertos: sentadilla, bisagra, zancada, empuje horizontal (×2), empuje vertical,
  tirón horizontal, tirón vertical, core.
- ✅ Buscar, filtrar por grupo/material/nivel/músculo, favoritos y enlace para llevárselos.
- ✅ Rigor editorial revisado: fuentes verificadas, campo `matices` para lo que las fuentes no
  cierran, aviso de salud en todas las pantallas.
- ✅ **Cerrados los dos huecos de la revisión editorial**: el jalón al pecho da una entrada
  accesible al tirón vertical —la dominada pasa a ser el segundo del grupo— y el press Pallof mete
  el antirrotación que le faltaba al core. Los dos salen de un implemento nuevo, la polea, que es lo
  que abre la familia entera de ejercicios que no se hacen con peso libre.
- ✅ **Ningún grupo empieza en intermedio** salvo tirón horizontal: la sentadilla goblet, el puente
  de glúteo y el press militar con mancuernas dan entrada inicial a sus tres grupos, y el ejercicio
  con barra de cada uno pasa a segundo.
- ⬜ Falta una entrada inicial en **tirón horizontal** (remo invertido) y **zancada** (zancada
  inversa), y el catálogo estaría completo por abajo.
- ⬜ Los roles musculares siguen derivados a mano, ficha a ficha.

## Fase 3 — Que parezca producto terminado ✅

- ✅ Tipografías propias servidas desde el sitio (estaban nombradas y no se cargaban nunca).
- ✅ Un solo componente de control: nada que se pulse es un enlace suelto.
- ✅ La visualización manda en la ficha; el texto acompaña.
- ✅ Alineaciones **medidas**: `npm run alineacion`, en dos temas × dos anchos.
- ✅ Tema oscuro con acentos propios por grupo, verificados contra AA.
- ✅ Presupuestos de rendimiento: CLS 0,000, un solo contexto WebGL vivo, Three.js fuera de la carga
  inicial.
- ⬜ **Volver a medir el LCP del móvil con el equipo descargado.** El 19-09 marcaba 2.904 ms sobre
  un presupuesto de 2.500, pero el mismo código medía 984 ms por la mañana: era carga de la máquina,
  comprobado reconstruyendo el commit anterior.

## Fase 4 — Publicar ✅ (falta el móvil de verdad)

**En el aire: https://mikierxxv.github.io/befit/**

1. ✅ Repositorio: `MikierXXV/befit`.
2. ✅ Siete commits subidos.
3. ✅ Pages con origen «GitHub Actions». El primer intento falló en `configure-pages` porque Pages
   aún no estaba habilitado; el flujo en sí estaba bien.
4. ✅ Recorrido entero contra la URL publicada, en dos temas y dos anchos, sin un solo error: la
   portada, los carteles, la tipografía y el `.glb` del maniquí cargan todos bajo `/befit/`.
5. ⬜ Repasar la web publicada en un móvil de verdad.

Y una cosa que solo se sabe publicando: **los presupuestos de rendimiento pasan en el runner de
CI**, LCP del móvil de gama baja incluido. El 2.904 ms de la máquina local era carga del equipo.

## Fase 5 — Crecer: de catálogo a registro de entreno 🟡

El catálogo llegó a 50 ejercicios validados. El siguiente paso sale de estudiar OpenGym
(`DuarteSantos8/openGym`; el fork `alexpcosta/opengym` está parado): **ideas, no código**. De su
catálogo de 1.324 GIFs no se toma nada —licencia de terceros sin resolver— y nada que pida cuentas
o servidor: la regla 5 se mantiene y el cambio de dispositivo va por fichero.

- ✅ **5.0 Cimientos.** Una sola clave de `localStorage` versionada (`befit.datos.v1`) con migración
  de los favoritos viejos; exportar e importar que **suman**, nunca sustituyen; PWA con manifiesto y
  service worker que abre sin conexión; y `node --test` sobre la lógica de datos, dentro de
  `npm run validar`.
- ✅ **5.1 Anotar desde la ficha.** Peso, repeticiones y RIR —o tiempo en los isométricos, con un
  campo `medida` en la ficha—, historial del ejercicio, 1RM estimado (Epley y Brzycki, con aviso
  por encima de 10 repeticiones) y gráfica en SVG hecho a mano. Vista `#/datos` para exportar,
  importar y borrar. Los campos que no son texto se validan iguales en los dos idiomas.
- ✅ **5.2 Sesión en el gimnasio.** `#/hoy`, temporizador de descanso, cronómetro para los
  isométricos y wake lock. Un solo maniquí vivo: el del ejercicio activo. El descanso por defecto
  sale del contenido (grupo, o ficha si no encaja) y los ±15 s se recuerdan por ejercicio.
- ✅ **5.3 Rutinas.** Las del usuario, en local y por enlace; las de inicio, como contenido en
  `content/<idioma>/rutinas/`; y cambiar un ejercicio por otro de su mismo patrón. Un día de rutina
  se empieza como plan de hoy, y «Hoy» enseña cuántas series lleva cada ejercicio de su objetivo.
- ✅ **5.4 Progreso.** Mapa muscular acumulado ponderado por rol (1 · 0,5 · 0,25), volumen semanal
  por patrón y heatmap de actividad. En tres grados (1-4, 5-9 y 10 o más series por semana), no en
  degradado; esta semana o la media de las cuatro anteriores completas.

Fuera, a propósito: cuentas y sincronización, AI Coach, progresión automática (a OpenGym le ha
dado fallos reales), social, notificaciones, APK y fotos. Importar de Strong/Hevy, quizá más tarde.

Pendientes del catálogo: el cable del press Pallof se ve rígido, y el curl inverso no distingue la
pronación porque la cinemática aún no gira el antebrazo.

## Fase 6 — De 50 a unos 100 ejercicios 🟡

Plan en dos etapas: primero lo que el maniquí ya dibuja (tandas J a N), después implementos nuevos
—banco inclinado, paralelas, kettlebell, máquinas y multipower— (tandas O a S). Rutinas de inicio
nuevas al cerrar cada etapa y revisión de las tres actuales. Cada tanda se anima con un agente por
ejercicio en paralelo, cada uno en su worktree, y se revisa la hoja antes de publicar.

- ✅ **J · Bisagra y sentadilla:** peso muerto, peso muerto sumo, hip thrust, rumano con mancuernas,
  goblet y sentadilla sumo con mancuerna. Trajo tres cambios al motor y al validador: la
  **escápula** (el hombro baja y se adelanta: sin ella los pesos muertos no llegaban a la barra en
  el suelo con la espalda recta), la abducción de cadera que crece con la flexión, y el apoyo de
  **espalda** en el banco (hip thrust).
- ✅ **K · Empujes:** press Arnold, fondos en banco, flexiones declinadas e inclinadas, press de banca
  con agarre cerrado y pullover con mancuerna. Trajo la **pronosupinación** del antebrazo al motor
  (el giro del press Arnold), y el apoyo en banco con manos o pies.
- ⬜ L · Tirones y polea · M · Core · N · Grupos nuevos.
- ⬜ Pendiente: el curl inverso puede usar ya `pronacion` para distinguirse del curl normal.
- ✅ **Movimientos fuera del JS inicial:** se cargan al abrir la ficha, y la proporción del lienzo
  sale de un índice generado al compilar. El JS crítico bajó de 104,6 a 87,5 kB y cada ejercicio
  nuevo le suma bytes, no kilobytes. La app instalada los precarga todos para ir sin conexión.

---

## Lo que este proyecto deja para los siguientes

Era la mitad del encargo: que la máquina sirva para el próximo sitio. Todo esto vive en
`plantilla-sitio`, no aquí.

| Pieza | Qué evita |
|---|---|
| `crear.mjs` con capas | Copiar y pegar un proyecto entero para empezar otro. |
| `modulos/figura` | Volver a escribir el motor de poses. |
| `check-alineacion.mjs` | Descuadres de tres píxeles que solo se ven cuando ya está publicado. |
| `check-contraste.mjs` | Publicar texto que no se lee en uno de los dos temas. |
| `check-idiomas.mjs` | Texto visible escrito dentro del código. |
| `auditar.mjs` | Enterarse del rendimiento por una queja. |
| `capturar-sitio.mjs` | Errores mudos que no rompen nada pero dejan media página vacía. |
| `metricas-respaldo.mjs` | Que cambiar de tipografía mueva la página entera. |
| Agente `animador-de-movimiento` | Cien ciclos de ajustar números y mirar capturas. |
| Agente `revisor-de-contenido` | Publicar como cerrado lo que las fuentes no cierran. |
