import { defineConfig } from 'tsdown';

/**
 * Bundles the CLI + server into dist/cli.js. Runtime dependencies listed in
 * package.json stay external (installed by npm); the web UI is built
 * separately by Vite into dist/web, which is why `clean` is off here.
 */
export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: false,
  // Keep dist/cli.js (package is "type": "module") rather than cli.mjs.
  fixedExtension: false,
  hash: false,
  dts: false,
  sourcemap: false,
});
