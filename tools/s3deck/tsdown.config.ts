import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: false,
  dts: false,
  sourcemap: false,
  // Keep npm dependencies external; they are installed from package.json.
  deps: { neverBundle: true },
});
