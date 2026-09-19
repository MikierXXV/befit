import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages sirve un sitio de proyecto bajo /<repo>/, así que las rutas de los assets deben ser
  // relativas a esa base. El flujo de despliegue la pasa en BASE_PATH deducida del nombre del
  // repositorio; en desarrollo se queda en '/'.
  base: process.env.BASE_PATH ?? '/',
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
