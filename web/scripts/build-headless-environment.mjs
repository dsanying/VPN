// SPDX-License-Identifier: MIT
// Package the exact shared host foundation for native-engine instrumentation, without a UI.
import path from 'node:path';
import { build } from 'vite';
const web = path.resolve(import.meta.dirname, '..');
await build({
  configFile: false,
  root: web,
  build: {
    outDir: path.resolve(web, '../android/app/src/androidTest/assets/headless'),
    emptyOutDir: true,
    lib: { entry: path.join(web, 'src/mobile/headless/environment.ts'), name: 'ShadowEnvironment', formats: ['iife'], fileName: () => 'environment.js' },
    sourcemap: false,
    minify: true,
  },
});
