import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  // Relative asset URLs so the built UI works under any proxy path prefix.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': here('./src'),
      '@shared': here('../src/shared'),
    },
    // @deck/ui is a separate workspace package; make sure it shares our React.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: here('../dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 47816,
    strictPort: true,
    // `pnpm dev` starts the API on its default port 47815 with --no-auth.
    proxy: { '/api': { target: 'http://127.0.0.1:47815' } },
  },
});
