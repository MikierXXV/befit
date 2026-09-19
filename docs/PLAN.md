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

- ✅ Nueve ejercicios, en los dos idiomas, con maniquí los nueve.
- ✅ Ocho patrones cubiertos: sentadilla, bisagra, zancada, empuje horizontal (×2), empuje vertical,
  tirón horizontal, tirón vertical, core.
- ✅ Buscar, filtrar por grupo/material/nivel/músculo, favoritos y enlace para llevárselos.
- ✅ Rigor editorial revisado: fuentes verificadas, campo `matices` para lo que las fuentes no
  cierran, aviso de salud en todas las pantallas.
- ⬜ **Huecos que dejó la revisión editorial**, pendientes a propósito:
  - tirón vertical solo tiene un ejercicio y es **avanzado** (falta una entrada accesible: jalón o
    dominada asistida);
  - core no tiene **antirrotación** (pallof, por ejemplo);
  - los roles musculares están derivados a mano, ficha a ficha.

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

## Fase 5 — Crecer ⬜

- ⬜ Cerrar los huecos de catálogo de la fase 2.
- ⬜ Más ejercicios por patrón, con la máquina ya montada: ficha en dos idiomas, movimiento, validar,
  mirar la hoja, cartel.
- ⬜ Lo que salga de usarlo.

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
