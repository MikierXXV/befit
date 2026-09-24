import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/*
 * LAS PROPORCIONES DEL LIENZO, SIN LOS MOVIMIENTOS.
 *
 * Los movimientos iban todos en el JS inicial, porque la ficha lee la proporción del lienzo de su
 * movimiento para reservar el hueco antes de montar el maniquí. Con seis ejercicios más, el JS
 * crítico pasó de 92,8 a 104,6 kB: a ese ritmo, con cien ejercicios no cabía en su presupuesto de
 * 200. Los movimientos se cargan ahora al abrir la ficha, y lo único que hace falta antes —la
 * proporción de cada uno— sale de este módulo virtual, que se genera al compilar leyendo los JSON:
 * unos bytes por ejercicio en vez de unos kilobytes.
 */
function proporcionesDeMovimientos(): Plugin {
  const id = 'virtual:proporciones';
  const dir = 'content/movimientos';
  return {
    name: 'proporciones-de-movimientos',
    resolveId: (fuente) => (fuente === id ? `\0${id}` : undefined),
    load(modulo) {
      if (modulo !== `\0${id}`) return undefined;
      const proporciones: Record<string, string> = {};
      for (const fichero of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        this.addWatchFile(`${dir}/${fichero}`);
        const mov = JSON.parse(readFileSync(`${dir}/${fichero}`, 'utf8')) as { camara?: { proporcion?: string } };
        if (mov.camara?.proporcion) proporciones[fichero.replace(/\.json$/, '')] = mov.camara.proporcion;
      }
      return `export default ${JSON.stringify(proporciones)};`;
    },
  };
}

export default defineConfig({
  // GitHub Pages sirve un sitio de proyecto bajo /<repo>/, así que las rutas de los assets deben ser
  // relativas a esa base. El flujo de despliegue la pasa en BASE_PATH deducida del nombre del
  // repositorio; en desarrollo se queda en '/'.
  base: process.env.BASE_PATH ?? '/',
  plugins: [proporcionesDeMovimientos()],
  build: {
    target: 'es2022',
    // Three.js supera los 500 kB sin comprimir y el aviso por defecto salta siempre. Aquí es
    // esperado: va en su propio chunk y solo lo descarga quien abre una escena. Lo que sí se vigila
    // es el JS crítico, y de eso se encarga scripts/auditar.mjs con un presupuesto medido.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Three.js en su propio chunk: separarlo es lo que permite que no bloquee el primer pintado.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
