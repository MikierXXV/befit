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
import { aplicarPose, geometriaBanco, geometriaKettlebell, geometriaMaquina, geometriaParalelas, poseEn, prepararEsqueleto } from './cinematica.js';

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
  /* En qué punto del ciclo se le ve mejor, para la imagen fija del catálogo. Por defecto el
     principio, que es lo que vale para casi todos; pero hay movimientos cuyo primer fotograma no
     dice nada —el press Pallof empieza con las manos pegadas al pecho, igual que estar de pie—. */
  cartel?: { fase?: number };
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
  /*
   * SE DIBUJA A MÁS RESOLUCIÓN DE LA QUE TIENE LA PANTALLA, y luego el navegador lo reduce.
   *
   * En un monitor normal —un píxel de pantalla por píxel de CSS— el maniquí salía dentado: es un
   * modelo de pocos polígonos, con lo que los bordes son rectas largas, y ahí el antialias del
   * propio WebGL no llega. Dibujando a 1,6× y dejando que el navegador encoja, cada píxel final es
   * la media de dos y medio: es supermuestreo de toda la vida y se nota muchísimo.
   *
   * El tope de 2 sigue mandando, así que en una pantalla de alta densidad —los móviles— no se
   * dibuja ni un píxel de más: ahí ya sobra resolución y lo que falta es batería.
   */
  render.setPixelRatio(Math.min(Math.max(window.devicePixelRatio, 1.6), 2));
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
    /*
     * Los implementos cuentan, con dos excepciones, y las dos por lo mismo: encuadrar por algo muy
     * largo deja al maniquí del tamaño de un sello.
     *
     *  - La barra olímpica entera, con sus 2,2 m.
     *  - El cable de una polea, que llega hasta el anclaje: a metro y medio en el press Pallof y a
     *    dos metros y medio de altura en el jalón. Los carteles de los dos salían en blanco.
     */
    for (const [nombre, malla] of Object.entries(mallas)) {
      if ((mov.implementos?.[nombre]?.tipo) === 'barra') continue;
      for (const pieza of malla.children) {
        if (pieza.name !== 'cable') caja.expandByObject(pieza);
      }
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
      if (malla.userData.maquina) moverMaquina(malla, estado as unknown as Record<string, unknown>);
      estirarCable(malla, movimiento.implementos?.[nombre]?.ancla as number[] | undefined, estado.posicion);
    }
  }

  /*
   * El cable de una polea va del agarre al anclaje, y su largo cambia en cada fotograma. Se estira
   * una geometría de largo 1 en vez de rehacerla: el cilindro se crea mirando a +Y y con su centro
   * en el origen, así que hay que llevarlo a la mitad del recorrido y girarlo hacia el anclaje.
   *
   * Todo en coordenadas LOCALES del implemento, porque el cable es hijo suyo: el agarre ya está
   * colocado y girado, y el anclaje está en el mundo.
   */
  const estirarCable = (malla: THREE.Object3D, puntoAncla: number[] | undefined, donde: THREE.Vector3) => {
    const cable = malla.getObjectByName('cable');
    if (!cable || !puntoAncla) return;
    const ancla = new THREE.Vector3(puntoAncla[0], puntoAncla[1], puntoAncla[2]);
    const largo = ancla.distanceTo(donde);
    cable.scale.set(1, largo, 1);
    const medio = ancla.clone().add(donde).multiplyScalar(0.5);
    cable.position.copy(malla.worldToLocal(medio));
    const haciaAncla = ancla.clone().sub(donde).normalize().applyQuaternion(malla.quaternion.clone().invert());
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), haciaAncla);
  };

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
  } else if (def.tipo === 'polea') {
    /*
     * POLEA: un agarre atado por un cable a un punto fijo. Es lo que abre los ejercicios que no
     * caben con pesos libres —el jalón, el press Pallof— y de paso los únicos huecos que quedaban
     * en el catálogo: un tirón vertical para quien no hace dominadas, y un antirrotación de core.
     *
     * El cable se dibuja aquí con largo 1 y se ESTIRA en cada fotograma, porque su largo cambia con
     * el movimiento: es lo único de la escena que no es un sólido rígido. La alternativa —recalcular
     * su geometría cada vez— reserva memoria sesenta veces por segundo para nada.
     */
    const mango = (def.mango as string) ?? 'barra';
    const ancho = (def.ancho as number) ?? (mango === 'barra' ? 1.1 : 0.2);
    g.add(cilindroX(mango === 'barra' ? 0.016 : 0.014, ancho, metal));
    if (mango === 'barra') {
      // Los extremos caídos de una barra de jalón: es lo que la distingue de una barra olímpica.
      for (const s2 of [-1, 1]) {
        const punta = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 16), metal);
        punta.position.set((s2 * ancho) / 2, -0.06, 0);
        punta.rotation.z = (s2 * Math.PI) / 5;
        punta.castShadow = true;
        g.add(punta);
      }
    }
    /* 9 mm y no 6: a 6 el cable se veía como un pelo y el press Pallof parecía alguien sujetando un
       palo. Un cable de gimnasio es grueso de verdad, y aquí además tiene que contar algo. */
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1, 8), material(COLOR.metal, 0.4, 0.6));
    cable.name = 'cable';
    g.add(cable);
  } else if (def.tipo === 'mancuerna') {
    g.add(cilindroX(0.016, 0.14, metal));
    for (const s of [-1, 1]) g.add(cilindroX(0.06, 0.08, material(COLOR.disco, 0.8, 0), s * 0.11));
  } else if (def.tipo === 'banco') {
    // La forma sale de `geometriaBanco`, la misma que usa el validador: ver allí qué es cada medida.
    const { ancho, alto, asiento, respaldo } = geometriaBanco(def);
    const largo = asiento.z1 - asiento.z0;
    const cojin = material(COLOR.banco, 0.9, 0);
    const piezas: THREE.Mesh[] = [];
    const acolchado = new THREE.Mesh(new THREE.BoxGeometry(ancho, 0.08, largo), cojin);
    acolchado.position.set(0, alto - 0.04, (asiento.z0 + asiento.z1) / 2);
    const pata = new THREE.Mesh(new THREE.BoxGeometry(0.08, alto - 0.08, largo * 0.8), metal);
    pata.position.set(0, (alto - 0.08) / 2, (asiento.z0 + asiento.z1) / 2);
    piezas.push(acolchado, pata);
    if (respaldo) {
      /*
       * El respaldo: una caja girada alrededor de X. Girar `inclinacion` lleva su largo (el Z de la
       * caja) a la dirección en que sube y su cara de arriba (el Y) a la normal, hacia la espalda.
       * Se centra medio largo más allá del pivote y medio grosor por debajo de la superficie.
       */
      const { largo: lr, pivote, d, n, inclinacion } = respaldo;
      const tabla = new THREE.Mesh(new THREE.BoxGeometry(ancho, 0.08, lr), cojin);
      tabla.rotation.x = inclinacion * (Math.PI / 180);
      tabla.position.set(0, pivote.y + d.y * lr / 2 - n.y * 0.04, pivote.z + d.z * lr / 2 - n.z * 0.04);
      /*
       * Y lo que lo sostiene: un poste del suelo a la cara de abajo del respaldo, a poco más de la
       * mitad de su largo, y un larguero por el suelo desde la pata del asiento hasta el poste. Sin
       * él, un respaldo a 30° parecía flotar detrás del maniquí.
       */
      const u = lr * 0.55;
      const apoyoY = pivote.y + d.y * u - n.y * 0.08;
      const apoyoZ = pivote.z + d.z * u - n.z * 0.08;
      const poste = new THREE.Mesh(new THREE.BoxGeometry(0.06, apoyoY, 0.06), metal);
      poste.position.set(0, apoyoY / 2, apoyoZ);
      const larguero = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, asiento.z0 - apoyoZ + 0.06), metal);
      larguero.position.set(0, 0.025, (asiento.z0 + apoyoZ) / 2);
      piezas.push(tabla, poste, larguero);
    }
    for (const m of piezas) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  } else if (def.tipo === 'paralelas') {
    /*
     * PARALELAS: dos barras a lo largo de Z sobre cuatro postes. La forma sale de
     * `geometriaParalelas`, la misma que usan la cinemática para llevar cada mano a su barra y el
     * validador para saber dónde son sólidas: ver allí qué es cada medida.
     */
    const { radio, alto, largo, barras, postes } = geometriaParalelas(def);
    for (const b of Object.values(barras) as Array<{ x: number; y: number }>) {
      const barra = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, largo, 24).rotateX(Math.PI / 2), metal);
      barra.position.set(b.x, b.y, 0);
      barra.castShadow = true;
      g.add(barra);
    }
    for (const p of postes as Array<{ x: number; z: number; radio: number }>) {
      // Del suelo a la cara de abajo de la barra: si asomara por encima, la mano lo agarraría.
      const poste = new THREE.Mesh(new THREE.CylinderGeometry(p.radio, p.radio, alto - radio, 16), metal);
      poste.position.set(p.x, (alto - radio) / 2, p.z);
      poste.castShadow = true;
      g.add(poste);
    }
  } else if (def.tipo === 'kettlebell') {
    /*
     * KETTLEBELL: una bola con la base aplanada y un asa en arco encima. La forma sale de
     * `geometriaKettlebell`, la misma que usan la cinemática para llevar las manos al asa o a los
     * cuernos y el validador para saber dónde es sólida: ver allí qué es cada medida y por qué el
     * origen está en el asa y no en el suelo.
     */
    const { radio, bola, base, asa } = geometriaKettlebell(def);
    const hierro = material(COLOR.disco, 0.8, 0);
    // La esfera, abierta por abajo donde la corta la base (el ángulo se cuenta desde el polo de arriba).
    const corte = Math.acos((base - bola.y) / bola.radio);
    const cuerpo = new THREE.Mesh(new THREE.SphereGeometry(bola.radio, 32, 20, 0, Math.PI * 2, 0, corte), hierro);
    cuerpo.position.y = bola.y;
    const suela = new THREE.Mesh(
      new THREE.CircleGeometry(bola.radio * Math.sin(corte), 32).rotateX(Math.PI / 2),
      hierro,
    );
    suela.position.y = base;
    const curva = new THREE.CatmullRomCurve3(asa as THREE.Vector3[]);
    const tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 48, radio, 14, false), metal);
    for (const m of [cuerpo, suela, tubo]) { m.castShadow = true; g.add(m); }
  } else if (def.tipo === 'maquina') {
    /*
     * MÁQUINA GUIADA: una lista de cajas y cilindros que sale de `geometriaMaquina`, la misma que usan
     * la cinemática para llevar las manos a las asas y el validador para saber dónde es sólida, dónde
     * se apoya el cuerpo y dónde tiene que tocarlo la parte móvil. Ver allí cada modelo.
     *
     * Acolchado con el material del banco y bastidor de metal. Las piezas móviles (palanca y rodillo,
     * o carro y plataforma) se recolocan en cada fotograma con `moverMaquina`. Las `despejable` se
     * hacen translúcidas cuando quedan delante, como los discos: la columna y el asa derecha, en la
     * vista lateral, taparían justo la cadera y la rodilla; el carril de la prensa, los muslos; y
     * su plataforma, en la frontal, el tronco entero.
     */
    const cojin = material(COLOR.banco, 0.9, 0);
    for (const p of geometriaMaquina(def).piezas as PiezaMaquina[]) {
      const geo = p.forma === 'caja'
        ? new THREE.BoxGeometry(p.medio!.x * 2, p.medio!.y * 2, p.medio!.z * 2)
        : new THREE.CylinderGeometry(p.radio!, p.radio!, p.medio_largo! * 2, 24).rotateZ(Math.PI / 2);
      // Un material por pieza: `despejar` cambia la opacidad de cada una por separado.
      const m = new THREE.Mesh(geo, p.material === 'acolchado' ? cojin.clone() : metal.clone());
      m.name = p.nombre;
      m.position.copy(p.centro);
      m.quaternion.copy(p.q);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.despejable = Boolean(p.despejable);
      g.add(m);
    }
    g.userData.maquina = true;
  } else if (def.tipo === 'pared') {
    /*
     * Una pared es una caja de pie, y hace falta como tipo propio: usar un banco puesto vertical
     * dibuja su tablero horizontal a la altura `alto` más una pata, y de perfil parece una farola.
     * Se apoya en el suelo, así que crece hacia arriba desde `posicion`.
     */
    const { ancho, alto, grosor } = def as unknown as { ancho: number; alto: number; grosor: number };
    const muro = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto, grosor), material(COLOR.banco, 0.95, 0));
    muro.position.y = alto / 2;
    muro.castShadow = true;
    muro.receiveShadow = true;
    g.add(muro);
  }
  return g;
}

interface PiezaMaquina {
  nombre: string;
  forma: 'caja' | 'cilindro';
  centro: THREE.Vector3;
  q: THREE.Quaternion;
  medio?: THREE.Vector3;
  radio?: number;
  medio_largo?: number;
  material: string;
  movil?: boolean;
  despejable?: boolean;
}

/**
 * Recoloca las piezas móviles de una máquina con el `angulo` o el `recorrido` de este fotograma. Se
 * rehace la lista entera —son veinte piezas, y es la misma cuenta que hace el validador— en vez de
 * girar aquí la palanca a mano: una segunda versión del giro acabaría no coincidiendo con la suya.
 */
function moverMaquina(g: THREE.Object3D, estado: Record<string, unknown>) {
  for (const p of geometriaMaquina(estado).piezas as PiezaMaquina[]) {
    if (!p.movil) continue;
    const m = g.getObjectByName(p.nombre);
    if (!m) continue;
    m.position.copy(p.centro);
    m.quaternion.copy(p.q);
  }
}

function liberar(raiz: THREE.Object3D) {
  raiz.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}
