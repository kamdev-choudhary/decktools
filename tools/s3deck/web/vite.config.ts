import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  // Relative asset URLs, so the UI works at a domain root or under any --base-path.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': r('./src'),
      '@shared': r('../src/shared'),
    },
  },
  server: {
    port: 47716,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:47715', changeOrigin: false },
      '/healthz': { target: 'http://127.0.0.1:47715' },
    },
  },
  build: {
    outDir: r('../dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
