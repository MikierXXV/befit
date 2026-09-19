/**
 * Visor del maniquí: escena, implementos, vistas fijas y reproducción de un ejercicio.
 *
 * UN SOLO RENDERER para todo. Cambiar de ejercicio cambia la ficha, no el contexto WebGL; y la hoja
 * de capturas pinta sus doce viñetas con este mismo renderer, copiándolas a un canvas 2D. Es la
 * regla de la plantilla —un contexto vivo a la vez— llevada a una app donde el 3D está en cada ficha.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { aplicarPose, poseEn, prepararEsqueleto } from './cinematica.js';

export type Vista = 'frontal' | 'lateral' | 'tres_cuartos' | 'detalle';
export const VISTAS: Vista[] = ['frontal', 'lateral', 'tres_cuartos'];

/**
 * Las vistas de un ejercicio: las tres de siempre, más un primer plano si la ficha dice de qué.
 * El agarre no se puede juzgar en un plano entero: la mano ocupa treinta píxeles.
 */
export function vistasDe(mov: Movimiento): Vista[] {
  return mov.camara.detalle ? [...VISTAS, 'detalle'] : VISTAS;
}

export interface Movimiento {
  duracion: number;
  camara: { vista: Vista; detalle?: string; proporcion?: string };
  implementos?: Record<string, { tipo: string; [k: string]: unknown }>;
  poses: Array<{ t: number; etiqueta?: string; [k: string]: unknown }>;
}

/*
 * Colores del maniquí. Van aquí y no en la escena de cada ejercicio: un cuerpo neutro, sin piel ni
 * ropa, para que lo único que destaque sea la postura. Pasarán a tokens en la plantilla.
 */
const COLOR = {
  cuerpo: 0xd9d4cc,
  articulaciones: 0x8c8479,
  metal: 0x3b3f45,
  disco: 0x22252a,
  banco: 0x4a4f57,
};

/**
 * El suelo se toma del tema, no de una constante.
 *
 * Con un color fijo claro, en tema oscuro quedaba una mancha blanca bajo el maniquí que parecía un
 * fallo de carga. Se lee del token en vez de duplicar la paleta aquí: si el sitio cambia de fondo,
 * la escena cambia con él.
 */
function colorDelTema(token: string, respaldo: number): THREE.Color {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return valor ? new THREE.Color(valor) : new THREE.Color(respaldo);
}

export async function crearVisor(lienzo: HTMLCanvasElement) {
  const render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, powerPreference: 'low-power', alpha: true });
  render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // ?sombras=0 para medir su coste. Ver scripts/medir.mjs.
  render.shadowMap.enabled = new URLSearchParams(location.search).get('sombras') !== '0';
  render.shadowMap.type = THREE.PCFSoftShadowMap;

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(35, 1, 0.05, 30);

  escena.add(new THREE.HemisphereLight(0xffffff, 0xb9b2a8, 1.6));
  const sol = new THREE.DirectionalLight(0xffffff, 2.2);
  sol.position.set(-1.5, 4, 2.5);
  sol.castShadow = true;
  // Mapa de sombra de 1024 y cámara de sombra ajustada al maniquí: la sombra solo tiene que decir
  // dónde está el suelo. Pendiente de medir en el móvil de gama baja si compensa o se quita.
  sol.shadow.mapSize.set(1024, 1024);
  Object.assign(sol.shadow.camera, { left: -1.5, right: 1.5, top: 2.2, bottom: -1, near: 0.5, far: 8 });
  escena.add(sol);

  /*
   * El suelo, con el color del tema. Y SIN suelo cuando se genera un cartel: el cartel se hace una
   * vez, en el tema que toque, y se mira en los dos. Con suelo, los carteles hechos en claro
   * enseñaban una mancha blanca bajo el maniquí en todo el catálogo en oscuro.
   */
  const paraCartel = new URLSearchParams(location.search).has('cartel');
  if (!paraCartel) {
    const suelo = new THREE.Mesh(
      new THREE.CircleGeometry(1.8, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: colorDelTema('--fondo-hundido', 0xe9e6e1), roughness: 1 }),
    );
    suelo.receiveShadow = true;
    escena.add(suelo);
  }
  render.shadowMap.enabled = render.shadowMap.enabled && !paraCartel;

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}modelos/maniqui.glb`);
  const modelo = gltf.scene;
  modelo.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const articulacion = (o.material as THREE.Material).name === 'M_Joints';
    o.material = new THREE.MeshStandardMaterial({
      color: articulacion ? COLOR.articulaciones : COLOR.cuerpo,
      roughness: 0.75,
    });
    o.castShadow = true;
    // La caja de recorte de una malla con piel se calcula en reposo (en T). Al agacharse, el cuerpo
    // sale de ella, y three.js descarta lo que cree fuera de cámara: sin esto, riesgo de maniquí a trozos.
    o.frustumCulled = false;
  });
  escena.add(modelo);
  const esq = prepararEsqueleto(modelo);

  let implementos = new THREE.Group();
  escena.add(implementos);
  let mallas: Record<string, THREE.Object3D> = {};
  let movimiento: Movimiento | null = null;

  function montarImplementos(mov: Movimiento) {
    escena.remove(implementos);
    liberar(implementos);
    implementos = new THREE.Group();
    mallas = {};
    for (const [nombre, def] of Object.entries(mov.implementos ?? {})) {
      const malla = crearImplemento(def);
      mallas[nombre] = malla;
      implementos.add(malla);
    }
    escena.add(implementos);
  }

  /**
   * Encuadre calculado, no escrito en la ficha. Con distancias a mano, la primera hoja de la
   * sentadilla cortaba la cabeza en las viñetas de pie: la ficha no sabe cuánto mide el maniquí.
   * Se recorre el ciclo entero, así la cámara no se mueve durante el ejercicio.
   */
  let centro = new THREE.Vector3(0, 0.9, 0);
  let medio = new THREE.Vector3(0.5, 0.9, 0.5);
  function medirCiclo(mov: Movimiento) {
    const caja = new THREE.Box3();
    for (let n = 0; n < 8; n += 1) {
      posar(n / 8);
      modelo.updateMatrixWorld(true);
      modelo.traverse((o) => {
        if (!(o instanceof THREE.SkinnedMesh)) return;
        o.computeBoundingBox();
        caja.union(o.boundingBox!.clone().applyMatrix4(o.matrixWorld));
      });
    }
    // Los implementos cuentan, salvo la barra entera: con sus 2,2 m el encuadre se abriría tanto que el maniquí quedaría diminuto.
    for (const [nombre, malla] of Object.entries(mallas)) {
      if ((mov.implementos?.[nombre]?.tipo) !== 'barra') caja.expandByObject(malla);
    }
    caja.getCenter(centro);
    // Se guardan las medias medidas de la caja, no el radio de una esfera: una plancha mide 1,9 m de
    // largo y 0,4 de alto, y encuadrarla por su esfera dejaba medio lienzo vacío arriba y abajo.
    caja.getSize(medio).multiplyScalar(0.5);
  }

  /**
   * Discos translúcidos cuando se interponen. De perfil, un disco de 45 cm tapa justo el tronco y
   * las caderas: en la hoja lateral de la sentadilla no se veía nada del movimiento.
   */
  const torax = esq.huesos.columna[2];
  function despejar() {
    const referencia = camara.position.distanceTo(torax.getWorldPosition(new THREE.Vector3())) - 0.1;
    implementos.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.userData.despejable) return;
      const delante = camara.position.distanceTo(o.getWorldPosition(new THREE.Vector3())) < referencia;
      const m = o.material as THREE.MeshStandardMaterial;
      // Cambiar `transparent` cambia el programa de sombreado, y three.js no se entera solo: sin
      // needsUpdate, la primera versión dejaba los discos opacos en todas las viñetas laterales.
      if (m.transparent !== delante) m.needsUpdate = true;
      m.transparent = delante;
      m.opacity = delante ? 0.22 : 1;
      m.depthWrite = !delante;
    });
  }

  function posar(fase: number) {
    if (!movimiento) return;
    const r = aplicarPose(esq, poseEn(movimiento, fase), movimiento);
    for (const [nombre, estado] of Object.entries(r.implementos) as Array<[string, { posicion: THREE.Vector3; orientacion: THREE.Quaternion }]>) {
      const malla = mallas[nombre];
      if (!malla) continue;
      malla.position.copy(estado.posicion);
      malla.quaternion.copy(estado.orientacion);
    }
  }

  function encuadrar(vista: Vista, ancho: number, alto: number) {
    if (!movimiento) return;
    // esq.huesos se rellena en bucle desde JS, así que TypeScript solo ve las claves fijas.
    const huesos = esq.huesos as unknown as Record<string, THREE.Object3D>;
    const detalle = vista === 'detalle' ? huesos[movimiento.camara.detalle!] : null;
    const objetivo = detalle ? detalle.getWorldPosition(new THREE.Vector3()) : centro;
    // El maniquí mira a +Z. "Lateral" es desde su derecha (−X): así la cara queda a la derecha de la
    // pantalla, que es como se lee de izquierda a derecha el avance de un movimiento.
    const desde = {
      frontal: new THREE.Vector3(0, 0.12, 1),
      lateral: new THREE.Vector3(-1, 0.12, 0),
      tres_cuartos: new THREE.Vector3(-0.72, 0.38, 0.72),
      detalle: new THREE.Vector3(-0.6, 0.45, 0.66),
    }[vista].clone();
    camara.aspect = ancho / alto;

    /*
     * Distancia: la que hace que la caja del movimiento quepa justo, mirada desde donde toca. Se
     * proyectan las medias medidas de la caja sobre los ejes de la cámara y se toma la que manda.
     */
    const haciaCamara = desde.clone().normalize();
    const derecha = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), haciaCamara).normalize();
    const arriba = new THREE.Vector3().crossVectors(haciaCamara, derecha).normalize();
    const proyectar = (eje: THREE.Vector3) =>
      Math.abs(eje.x) * medio.x + Math.abs(eje.y) * medio.y + Math.abs(eje.z) * medio.z;
    const tanY = Math.tan((camara.fov / 2) * (Math.PI / 180));
    const tanX = tanY * camara.aspect;
    const distancia = detalle
      ? 0.17 / tanY
      : Math.max(proyectar(arriba) / tanY, proyectar(derecha) / tanX) * 1.08 + proyectar(haciaCamara);

    camara.position.copy(objetivo).addScaledVector(haciaCamara, distancia);
    camara.lookAt(objetivo);
    camara.updateProjectionMatrix();
  }

  return {
    render,
    cargar(mov: Movimiento) {
      movimiento = mov;
      montarImplementos(mov);
      medirCiclo(mov);
      posar(0);
    },
    posar,
    pintar(vista: Vista, ancho: number, alto: number) {
      // Solo si cambia: setSize asigna canvas.width, y asignarlo —aunque sea el mismo valor— vacía y
      // vuelve a reservar el búfer de dibujo. (Se midió: no era la causa de los fotogramas lentos del
      // móvil, pero es trabajo tirado en cada fotograma.)
      const actual = render.getSize(new THREE.Vector2());
      if (actual.x !== ancho || actual.y !== alto) render.setSize(ancho, alto, false);
      encuadrar(vista, ancho, alto);
      despejar();
      render.render(escena, camara);
    },
    destruir() {
      liberar(escena);
      render.dispose();
      render.forceContextLoss();
    },
  };
}

export type Visor = Awaited<ReturnType<typeof crearVisor>>;

/* ------------------------------------------------------------------------ implementos -- */

function material(color: number, rugosidad = 0.5, metal = 0.2) {
  return new THREE.MeshStandardMaterial({ color, roughness: rugosidad, metalness: metal });
}

function cilindroX(radio: number, largo: number, mat: THREE.Material, x = 0, despejable = false) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, largo, 24).rotateZ(Math.PI / 2), mat);
  m.position.x = x;
  m.castShadow = true;
  m.userData.despejable = despejable;
  return m;
}

function crearImplemento(def: { tipo: string; [k: string]: unknown }): THREE.Object3D {
  const g = new THREE.Group();
  const metal = material(COLOR.metal, 0.35, 0.8);
  if (def.tipo === 'barra') {
    // Barra olímpica: 2,2 m, 28 mm de grosor. Los discos, de 45 cm: más pequeños y la barra en el
    // suelo del peso muerto quedaría a una altura que no es la real.
    g.add(cilindroX(0.014, 2.2, metal));
    for (const s of [-1, 1]) {
      g.add(cilindroX(0.025, 0.42, metal, s * 0.88));
      g.add(cilindroX(0.225, 0.045, material(COLOR.disco, 0.8, 0), s * 0.72, true));
      g.add(cilindroX(0.19, 0.035, material(COLOR.disco, 0.8, 0), s * 0.765, true));
    }
  } else if (def.tipo === 'barra_fija') {
    /*
     * Barra fija: la de las dominadas. Es otro tipo y no una barra con `discos: 0` porque no es una
     * barra a la que le falten discos: es más corta, más gruesa y está sujeta por arriba. Con la
     * barra olímpica de siempre, la dominada salía con dos discos de 45 cm colgando a los lados.
     */
    const ancho = (def.ancho as number) ?? 1.2;
    g.add(cilindroX(0.018, ancho, metal));
    for (const s of [-1, 1]) {
      const poste = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), metal);
      poste.position.set((s * ancho) / 2, 0.25, 0);
      poste.castShadow = true;
      g.add(poste);
    }
  } else if (def.tipo === 'mancuerna') {
    g.add(cilindroX(0.016, 0.14, metal));
    for (const s of [-1, 1]) g.add(cilindroX(0.06, 0.08, material(COLOR.disco, 0.8, 0), s * 0.11));
  } else if (def.tipo === 'banco') {
    const { largo, ancho, alto } = def as unknown as { largo: number; ancho: number; alto: number };
    const acolchado = new THREE.Mesh(new THREE.BoxGeometry(ancho, 0.08, largo), material(COLOR.banco, 0.9, 0));
    acolchado.position.y = alto - 0.04;
    const pata = new THREE.Mesh(new THREE.BoxGeometry(0.08, alto - 0.08, largo * 0.8), metal);
    pata.position.y = (alto - 0.08) / 2;
    for (const m of [acolchado, pata]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  }
  return g;
}

function liberar(raiz: THREE.Object3D) {
  raiz.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}
