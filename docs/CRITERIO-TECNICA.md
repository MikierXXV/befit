# Criterio de técnica

La técnica **no se reparte por cuota, se elige por adecuación**. La pregunta no es cuál impresiona
más, sino cuál hace que el contenido se entienda.

| Técnica | Cuándo | Coste |
|---|---|---|
| **SVG** | Contenido lógico, relacional, cuantitativo o temporal. Es el caso mayoritario. | Casi nulo |
| **Canvas 2D (física)** | Se entiende por inercia, oscilación, colisión o acumulación: la simulación *es* el argumento, no su decorado. | Bajo |
| **Three.js (3D)** | Solo si la comprensión depende de **profundidad, oclusión o punto de vista**. Exige `justificacion_3d`. | Alto |

## Por qué SVG debe ser la mayoría

Cada elemento es un nodo del DOM: enfocable con teclado, etiquetable para lector de pantalla,
tematizable con variables CSS y depurable con el inspector. Nada de eso lo da un canvas, donde todo
es una imagen opaca para la que hay que reconstruir a mano la accesibilidad.

Y porque **casi ningún contenido es espacial**. Una jerarquía es un árbol; una tensión entre dos
posturas es un eje; una dependencia mutua es una red. Meterlas en 3D les añade una dimensión que no
tienen, y eso estorba: aparecen oclusiones, la perspectiva distorsiona las magnitudes que hay que
comparar, y el usuario acaba gestionando una cámara en vez de pensando. **Cuando alguien tiene que
orbitar para ver bien, ha dejado de razonar sobre el concepto.**

## El presupuesto 3D no es un problema de peso

Está en `content/reglas.json` (`presupuesto_3d`). Si el sitio ya carga Three.js en algún sitio, la
biblioteca está pagada y una escena más apenas pesa. Lo que sí escala es memoria de GPU,
compilación de shaders y, sobre todo, **tiempo de autoría**: una escena 3D bien hecha cuesta varias
veces lo que una pieza SVG, y ese tiempo sale del contenido.

## La prueba que decide

Escribe la alternativa textual **antes** de programar la pieza. Si al describirla en dos frases
queda claro que no hace falta ver nada, la pieza no era necesaria. Si para describirla necesitas
hablar de qué tapa a qué o de desde dónde se mira, entonces sí es 3D.
