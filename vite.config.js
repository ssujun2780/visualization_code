import { defineConfig } from "vite";
import animationExamples from './scripts/animation/example-api.mjs';

export default defineConfig({
  plugins: [animationExamples()],
  build: { rollupOptions: { input: {workbench: 'index.html', animation: 'animation.html'} } },
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
