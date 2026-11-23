import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  // Relative asset URLs so the built UI works under any proxy path prefix.
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@shared': here('../src/shared') },
  },
  build: {
    outDir: here('../dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    // `npm run dev` starts the API on 5050 with --no-auth.
    proxy: { '/api': 'http://127.0.0.1:5050' },
  },
});
