/**
 * Service worker de befit: que la app funcione en el gimnasio aunque no haya cobertura.
 *
 * NO HAY LISTA DE PRECARGA, a propósito. Vite pone un hash en cada fichero compilado, así que una
 * lista escrita a mano se quedaría vieja en el siguiente build, y generarla exigiría un plugin. En
 * su lugar, todo lo que se pide una vez se guarda, con dos estrategias según lo que sea:
 *
 *  - LA PÁGINA (navegación): primero la red, y la copia guardada si no hay. Así una versión nueva se
 *    ve en cuanto hay conexión, y sin ella la app sigue abriendo en vez de enseñar el dinosaurio.
 *  - LO DEMÁS del propio sitio: primero la copia, y en segundo plano se refresca. Los ficheros de
 *    `assets/` llevan hash y no cambian nunca; los carteles, el modelo y las fuentes sí pueden
 *    cambiar de contenido con el mismo nombre, y el refresco en segundo plano los pone al día en la
 *    visita siguiente.
 *
 * Lo que la app necesita para abrir una ficha sin haberla visitado —Three.js, el visor, el modelo—
 * lo pide `main.ts` en segundo plano, y SOLO cuando la app está instalada: en una pestaña normal
 * sería cargar 150 kB de Three.js a quien a lo mejor solo mira el catálogo.
 *
 * Al cambiar VERSION, las cachés viejas se borran al activar el nuevo.
 */

const VERSION = 'befit-v1';

/*
 * Se busca en la caché IGNORANDO `Vary`. El servidor responde con `Vary: Origin` (vite preview) o
 * `Vary: Accept-Encoding` (GitHub Pages), y el <script type="module"> de la página pide con una
 * cabecera Origin que la copia guardada al instalar no llevaba: la caché tenía el fichero y decía que
 * no. Sin red, la página salía en blanco con tres ERR_FAILED. Lo que se guarda aquí es estático y no
 * cambia según quién lo pida, así que ignorarlo es seguro.
 */
const BUSQUEDA = { ignoreVary: true };

self.addEventListener('install', (evento) => {
  /*
   * Se guarda el ARRANQUE COMPLETO al instalar: la página y todo lo que enlaza —el JS y el CSS de
   * entrada, la fuente precargada, el manifiesto—, leído del propio index.html.
   *
   * Guardar solo la página no bastaba, y se vio probándolo: el JS de entrada se descarga ANTES de
   * que el service worker tome el control, así que nunca pasaba por él, y sin red la página
   * cargaba de la caché pero su script no existía. La app se quedaba en blanco sin un error.
   */
  evento.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const respuesta = await fetch('./index.html', { cache: 'reload' });
    const html = await respuesta.clone().text();
    await cache.put('./index.html', respuesta);
    const enlazados = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map((m) => new URL(m[1], self.location.href))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => url.href);
    await cache.addAll([...new Set(enlazados)]);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nombre of await caches.keys()) if (nombre !== VERSION) await caches.delete(nombre);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  const url = new URL(peticion.url);
  // Solo GET y del propio sitio: lo de fuera no es nuestro para guardarlo.
  if (peticion.method !== 'GET' || url.origin !== self.location.origin) return;

  if (peticion.mode === 'navigate') {
    evento.respondWith((async () => {
      try {
        const respuesta = await fetch(peticion);
        const cache = await caches.open(VERSION);
        await cache.put('./index.html', respuesta.clone());
        return respuesta;
      } catch {
        return (await caches.match('./index.html', BUSQUEDA)) ?? Response.error();
      }
    })());
    return;
  }

  evento.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const guardada = await cache.match(peticion, BUSQUEDA);
    const deRed = fetch(peticion).then((respuesta) => {
      if (respuesta.ok) void cache.put(peticion, respuesta.clone());
      return respuesta;
    }).catch(() => undefined);
    if (guardada) {
      evento.waitUntil(deRed);
      return guardada;
    }
    return (await deRed) ?? Response.error();
  })());
});
