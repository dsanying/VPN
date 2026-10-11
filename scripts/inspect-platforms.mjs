#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function inspectPlatforms(root) {
  const exists = name => fs.existsSync(path.join(root, name));
  const read = name => exists(name) ? JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')) : {};
  const pkg = read('package.json');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const contract = read('client-platforms.json');
  const builder = read('electron-builder.json');
  return {
    declaredTargets: contract.targets ?? [],
    hosts: ['electron', '@capacitor/core'].filter(name => Boolean(deps[name])),
    projects: ['android', 'ios', 'src-tauri', 'client/android', 'client/macos', 'client/windows'].filter(exists),
    installerTargets: ['mac', 'win', 'linux'].filter(name => Boolean(builder[name])),
    note: 'Only explicit declaredTargets set task scope; detected projects and dependencies are evidence, not authorization.'
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.argv[2] ?? '.');
  try { console.log(JSON.stringify(inspectPlatforms(root), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
