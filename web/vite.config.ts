import { defineConfig } from 'vite';

export default defineConfig({
  base: '/rscout/', // GitHub Pages base path
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers'], // Let it load from CDN
  },
  worker: {
    format: 'es',
  },
});
