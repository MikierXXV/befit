/**
 * Andamiaje común de las escenas Three.js.
 *
 * Existe porque todas las escenas repiten exactamente lo mismo y equivocarse en cualquiera de esas
 * piezas es caro: detección de capacidad, respaldo cuando no hay 3D, redimensionado con la
 * proporción única del hueco, y sobre todo **liberación real del contexto WebGL**. Sin ese último
 * paso, abrir varias escenas seguidas agota la memoria de GPU de un móvil de gama baja.
 *
 * LA REGLA DE RENDIMIENTO DEL PROYECTO —un solo contexto WebGL vivo a la vez— SE CUMPLE AQUÍ, no en
 * cada escena, para que no dependa de que nadie se olvide. scripts/auditar.mjs lo comprueba sobre
 * el sitio compilado.
 *
 * CUÁNDO USAR 3D: solo si la comprensión depende de profundidad, oclusión o punto de vista del
 * observador. Meter en 3D algo que no es espacial le añade una dimensión que no tiene: aparecen
 * oclusiones, la perspectiva distorsiona las magnitudes que hay que comparar, y el usuario acaba
 * gestionando una cámara en vez de pensando. Cuando alguien tiene que orbitar para ver bien, ha
 * dejado de razonar sobre el concepto.
 */

import { alternativaTextual, crearLienzo, movimientoReducido, resolver, PROPORCION, t } from './lenguaje';
import type { Visualizacion } from './lenguaje';

export { PROPORCION };

export function soportaWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export interface OpcionesEscena {
  contenedor: HTMLElement;
  /** Etiqueta accesible del lienzo. */
  etiqueta: string;
  /** Descripción de lo que se ve, para quien no puede verlo. Obligatoria. */
  alternativaTexto: string;
  /** Qué se supone que el usuario ha entendido al terminar. */
  resolucionRespaldo: string;
  /**
   * Lienzo con canal alfa, para que se vea el fondo de la página a través de él.
   *
   * Pintar dentro de la escena un fondo del color de la página parece equivalente y no lo es: el
   * mapeo de tonos se aplica también a ese color, así que sale más oscuro que la página y el lienzo
   * se delata como un rectángulo. Con alfa no hay dos colores que puedan discrepar, porque solo
   * hay uno.
   */
  transparente?: boolean;
}

export interface Escena3D {
  THREE: typeof import('three');
  escena: import('three').Scene;
  camara: import('three').PerspectiveCamera;
  render: import('three').WebGLRenderer;
  /** Contenedor de los botones de la pieza, con el estilo del sistema. */
  controles: HTMLElement;
  /**
   * Arranca el bucle. `paso` recibe el tiempo transcurrido en segundos.
   *
   * `dibujar` permite sustituir el pintado directo; lo necesita quien componga con post-proceso y
   * por tanto no renderice a pantalla sino a través de un EffectComposer. Una escena normal lo
   * omite, que es lo correcto para ella.
   */
  animar(paso: (t: number) => void, dibujar?: () => void): void;
  visualizacion: Visualizacion;
}

function respaldo(op: OpcionesEscena): Visualizacion {
  const aviso = document.createElement('div');
  aviso.className = 'vis-respaldo';
  aviso.textContent = t('vis.respaldo_3d');
  crearLienzo(op.contenedor).append(aviso);
  alternativaTextual(op.contenedor, op.alternativaTexto);
  resolver(op.contenedor, op.resolucionRespaldo);
  return { destruir: () => op.contenedor.replaceChildren() };
}

/**
 * Prepara escena, cámara, renderer y controles.
 *
 * Devuelve el respaldo YA MONTADO cuando no hay 3D disponible, de modo que quien llama solo tiene
 * que devolverlo. Se hace así para que "sin WebGL" y "con movimiento reducido" no sean dos caminos
 * que cada escena tenga que acordarse de cubrir por su cuenta.
 */
export async function crearEscena3D(
  op: OpcionesEscena,
): Promise<{ escena3d: Escena3D } | { respaldo: Visualizacion }> {
  if (!soportaWebGL() || movimientoReducido()) return { respaldo: respaldo(op) };

  // import() dinámico: Three.js no se descarga hasta que alguien abre una escena de verdad.
  const THREE = await import('three');

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(48, PROPORCION, 0.1, 4000);

  const render = new THREE.WebGLRenderer({
    antialias: true,
    // `low-power` a propósito: estas escenas no necesitan la GPU discreta, y pedirla acorta la
    // batería del portátil por un render que cabe de sobra en la integrada.
    powerPreference: 'low-power',
    alpha: op.transparente === true,
  });
  // Tope de 2: por encima, el número de píxeles crece al cuadrado sin diferencia visible.
  render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (op.transparente) render.setClearColor(0x000000, 0);
  render.domElement.className = 'vis-canvas';
  render.domElement.setAttribute('role', 'img');
  render.domElement.setAttribute('aria-label', op.etiqueta);

  // El dibujo y los controles van dentro del lienzo; la alternativa y la resolución, fuera y debajo.
  const lienzo = crearLienzo(op.contenedor);
  lienzo.append(render.domElement);

  const controles = document.createElement('div');
  controles.className = 'vis-controles';
  lienzo.append(controles);
  alternativaTextual(op.contenedor, op.alternativaTexto);

  let animacion = 0;
  const inicio = performance.now();

  function redimensionar(): void {
    const ancho = lienzo.clientWidth;
    if (!ancho) return;
    const alto = Math.round(ancho / PROPORCION);
    render.setSize(ancho, alto, false);
    camara.aspect = ancho / alto;
    camara.updateProjectionMatrix();
  }
  window.addEventListener('resize', redimensionar);
  redimensionar();

  const escena3d: Escena3D = {
    THREE, escena, camara, render, controles,

    animar(paso, dibujar) {
      const pintar = dibujar ?? (() => render.render(escena, camara));
      const bucle = () => {
        paso((performance.now() - inicio) / 1000);
        pintar();
        animacion = requestAnimationFrame(bucle);
      };
      bucle();
    },

    visualizacion: {
      /**
       * Liberar DE VERDAD.
       *
       * Quitar el canvas del DOM no libera nada: el contexto WebGL sigue vivo, con sus texturas y
       * sus shaders, hasta que el navegador decide recogerlo. Y los navegadores limitan los
       * contextos simultáneos —del orden de ocho o dieciséis—, así que el que falla no es el
       * primero sino el noveno: el fallo aparece lejos de su causa, después de un rato navegando.
       * Por eso aquí hay dispose() en geometrías, materiales y texturas, y forceContextLoss() en el
       * renderer.
       */
      destruir(): void {
        cancelAnimationFrame(animacion);
        window.removeEventListener('resize', redimensionar);
        escena.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => {
              // Las texturas del material también: dispose() del material no las arrastra.
              for (const v of Object.values(m)) {
                if (v instanceof THREE.Texture) v.dispose();
              }
              m.dispose();
            });
          }
        });
        render.dispose();
        render.forceContextLoss();
        op.contenedor.replaceChildren();
      },
    },
  };

  return { escena3d };
}

/** Botón con el estilo del sistema, para no repetirlo en cada escena. */
export function boton(controles: HTMLElement, texto: string, alPulsar: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = texto;
  b.addEventListener('click', alPulsar);
  controles.append(b);
  return b;
}

/**
 * Carga un GLB preparado por scripts/optimizar-modelo.mjs.
 *
 * Va aquí y no en cada escena porque el decodificador de meshopt hay que registrarlo, y olvidarlo
 * da un error de carga que no dice lo que pasa. Loader y decodificador se importan en dinámico para
 * que no entren en el paquete de quien no abre ningún modelo.
 */
export async function cargarModelo(url: string): Promise<import('three').Group> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}
