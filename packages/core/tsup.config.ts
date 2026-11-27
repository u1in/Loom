import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/config.ts', 'src/plugin.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
