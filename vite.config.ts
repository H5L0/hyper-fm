import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@renderer': path.resolve('src/renderer/src'),
      '@shared': path.resolve('src/shared'),
      '@': path.resolve("src/renderer/src"),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: path.resolve('dist/renderer'),
    emptyOutDir: false,
  },
});
