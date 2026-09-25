import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  external: ['playwright', 'playwright-core', 'chromium-bidi'],
  splitting: false,
  shims: false,
});