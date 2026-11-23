import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  // dist/web is produced by Vite first; don't wipe it.
  clean: false,
  splitting: false,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
