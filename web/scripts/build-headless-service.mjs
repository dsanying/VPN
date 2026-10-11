// SPDX-License-Identifier: MIT
import path from 'node:path';
import { build } from 'vite';
const web = path.resolve(import.meta.dirname, '..');
await build({
  configFile: false,
  root: web,
  resolve: { alias: { '@shared': path.resolve(web, '../src/shared'), '@': path.join(web, 'src') } },
  build: {
    outDir: path.resolve(web, '../android/app/src/main/assets/headless'),
    emptyOutDir: true,
    lib: { entry: path.join(web, 'src/mobile/headless/entry.ts'), name: 'ShadowHost', formats: ['iife'], fileName: () => 'service.js' },
    sourcemap: false,
    minify: true,
  },
});
