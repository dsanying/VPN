#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acquireRuntimeLock } from '../web/scripts/runtime-lock.mjs';

/** Only generated project output is disposable; never visit application data or other projects. */
export function candidateDirectories(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^(?:dist-validation\d*|dist-native-candidate|dist-package)$/.test(entry.name))
    .map(entry => path.join(root, entry.name));
}
export function registeredCandidates(root, dump) {
  const prefix = path.resolve(root) + path.sep;
  return [...new Set([...dump.matchAll(/^path:\s+(.+?\.app) \(0x[\da-f]+\)\s*$/gm)]
    .map(match => match[1])
    .filter(bundle => bundle.startsWith(prefix) && /^(?:dist-validation\d*|dist-native-candidate|dist-package)\/(?:mac(?:-(?:arm64|x64))?)\/暗影VPN\.app$/.test(bundle.slice(prefix.length))))];
}
export function unregisterCandidate(bundle, runner = spawnSync) {
  if (process.platform !== 'darwin') return;
  const registry = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  const result = runner(registry, ['-u', bundle], { encoding: 'utf8' });
  if (!result.error && result.status === 1 && /-10814\b/.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)) {
    const inventory = runner(registry, ['-dump'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (!inventory.error && inventory.status === 0 &&
      ![...inventory.stdout.matchAll(/^path:\s+(.+?\.app) \(0x[\da-f]+\)\s*$/gm)].some(match => match[1] === path.resolve(bundle))) return;
  }
  if (result.error || result.status !== 0) throw result.error ?? new Error(`Cannot unregister candidate: ${bundle}`);
}
export function cleanCandidates(root, { remove = false, runner = spawnSync } = {}) {
  root = fs.realpathSync(root);
  const directories = candidateDirectories(root);
  // Refuse removal while a candidate is still running. Caller must end its acceptance process first.
  if (remove && process.platform === 'darwin') {
    const processes = runner('ps', ['-axo', 'command='], { encoding: 'utf8' });
    if (processes.error || processes.status !== 0) throw new Error('Cannot verify candidate processes');
    if (directories.some(dir => processes.stdout.includes(`${dir}/`) || processes.stdout.includes(`${path.basename(dir)}/`)))
      throw new Error('A native candidate is still running; stop its acceptance process before cleaning');
  }
  for (const dir of directories) {
    if (remove) {
      const visit = folder => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const file = path.join(folder, entry.name);
          if (entry.name === '暗影VPN.app') unregisterCandidate(file, runner);
          else if (entry.name !== 'node_modules') visit(file);
        }
      };
      visit(dir);
      fs.rmSync(dir, { recursive: true });
    }
  }
  if (remove && process.platform === 'darwin') {
    const registry = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    const result = runner(registry, ['-dump'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error('Cannot inspect native application registrations');
    // Previously deleted bundles also leave entries; unregister only this project's exact candidate paths.
    for (const bundle of registeredCandidates(root, result.stdout)) unregisterCandidate(bundle, runner);
  }
  return directories;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(import.meta.dirname, '..');
  const remove = process.argv.includes('--remove');
  const release = remove ? acquireRuntimeLock(path.join(root, 'artifacts/native-candidate.lock')) : () => {};
  try {
    const dirs = cleanCandidates(root, { remove });
    console.log(`${remove ? 'Removed' : 'Disposable candidates'}: ${dirs.length}`);
    for (const dir of dirs) console.log(dir);
  } finally { release(); }
}
