#!/usr/bin/env node
// Bundle the Homebrew openconnect binary and every transitive /opt/homebrew (or
// /usr/local) dylib into a platform resource directory so the packaged app ships a
// self-contained OpenConnect engine. macOS only; x64 uses the pure-Go runtime and
// has no C adapter to bundle.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
if (process.platform !== 'darwin') throw new Error('bundle-openconnect is macOS only');
const dirArg = process.argv.indexOf('--dir');
const output = path.resolve(root, dirArg > 0 ? process.argv[dirArg + 1] : 'resources/mac-arm64');
const libsDir = path.join(output, 'libs');
const binPrefix = /^\/(?:opt\/homebrew|usr\/local)\//;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
function dependencies(file) {
  return run('otool', ['-L', file])
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(' ')[0])
    .filter((l) => l && binPrefix.test(l));
}
function brewRoot(file) {
  const resolved = fs.realpathSync(file);
  const m = resolved.match(/^(\/opt\/homebrew|\/usr\/local)\//);
  if (!m) throw new Error(`openconnect not provided by Homebrew: ${resolved}`);
  return resolved;
}

const openconnectSrc = brewRoot(
  spawnSync('which', ['openconnect'], { encoding: 'utf8' }).stdout.trim()
);
fs.mkdirSync(libsDir, { recursive: true });
fs.copyFileSync(openconnectSrc, path.join(output, 'openconnect'));
fs.chmodSync(path.join(output, 'openconnect'), 0o755);

// Collect the transitive closure of Homebrew dylibs from both bundled executables.
const pending = [openconnectSrc, path.join(output, 'openconnect-auth')].filter((f) =>
  fs.existsSync(f)
);
const names = new Map();
while (pending.length) {
  const file = pending.pop();
  for (const dep of dependencies(file)) {
    const real = fs.realpathSync(dep);
    const name = path.basename(real);
    if (!names.has(name)) {
      names.set(name, real);
      pending.push(real);
    }
  }
}
for (const [name, real] of names) {
  fs.copyFileSync(real, path.join(libsDir, name));
  fs.chmodSync(path.join(libsDir, name), 0o755);
  run('install_name_tool', ['-id', `@executable_path/libs/${name}`, path.join(libsDir, name)]);
}
// Repoint every Homebrew reference inside executables and bundled dylibs.
const targets = [path.join(output, 'openconnect'), path.join(output, 'openconnect-auth')]
  .filter((f) => fs.existsSync(f))
  .concat([...names.keys()].map((n) => path.join(libsDir, n)));
for (const target of targets) {
  for (const dep of dependencies(target)) {
    const name = path.basename(fs.realpathSync(dep));
    if (!names.has(name)) throw new Error(`Unbundled Homebrew dependency: ${dep}`);
    run('install_name_tool', ['-change', dep, `@executable_path/libs/${name}`, target]);
  }
}
// install_name_tool 会使原有签名失效；统一 ad-hoc 重签，最终由打包步骤 --deep 覆盖。
for (const target of targets) run('codesign', ['--force', '--sign', '-', target]);
// Fail loudly instead of shipping a broken bundle.
for (const target of targets) {
  const remaining = dependencies(target);
  if (remaining.length)
    throw new Error(`Residual Homebrew references in ${path.basename(target)}: ${remaining}`);
}
run(path.join(output, 'openconnect'), ['--version']);
console.log(`Bundled openconnect with ${names.size} libraries into ${libsDir}`);
