import { defineConfig } from 'tsdown'

// Single-file runtime bundle matching the published upstream layout:
// lib/index.js is the bundled entry; lib/types/* (tsc emit) carries types
// and the ./types, ./client subpath implementations.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  dts: false,
  clean: false,
  unbundle: false,
  outExtensions: () => ({ js: '.js' }),
})
