import { defineConfig } from 'tsdown'

// lib/index.js is the single bundled runtime entry (upstream layout);
// types come from the tsc declaration emit in lib/types.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  dts: false,
  clean: false,
  unbundle: false,
  outExtensions: () => ({ js: '.js' }),
})
