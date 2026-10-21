#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acquireRuntimeLock } from '../web/scripts/runtime-lock.mjs';

const tooling = file => /^(?:package(?:-lock)?\.json|jest\.config\.js|tsconfig.*\.json|vite\.config\.|\.oxlintrc|eslint|\.eslint|scripts\/validate-development)/.test(file);
export const checks = [
  { id: 'tests', command: ['test', '--', '--runInBand'], includes: file => tooling(file) || /^(src\/|web\/|scripts\/|resources\/)/.test(file) },
  { id: 'lint', command: ['run', 'lint'], includes: file => tooling(file) || file.startsWith('src/') },
  { id: 'renderer-types', command: ['run', 'typecheck:renderer'], includes: file => tooling(file) || /^(src\/shared\/|web\/src\/domain\/|web\/)/.test(file) },
  { id: 'core', command: ['run', 'test:core-gate'], includes: file => tooling(file) || /^(src\/main\/|src\/shared\/|resources\/|scripts\/.*core)/.test(file) },
  { id: 'build', command: ['run', 'build'], includes: file => tooling(file) || /^(src\/|web\/|scripts\/gen-build-info)/.test(file) },
];

export function fingerprint(check, entries, context) {
  const hash = createHash('sha256').update(JSON.stringify({ schema: 1, id: check.id, command: check.command, context }));
  for (const [name, bytes] of entries.filter(([name]) => check.includes(name)).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(JSON.stringify(name)); hash.update(createHash('sha256').update(bytes).digest());
  }
  return hash.digest('hex');
}
export function reusable(record, hash, output) {
  return record?.status === 'passed' && record.fingerprint === hash &&
    typeof record.logSha256 === 'string' && fs.existsSync(output) &&
    createHash('sha256').update(fs.readFileSync(output)).digest('hex') === record.logSha256;
}

function fileDigest(file) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest();
}

function buildDigest(root) {
  const entries = [];
  const visit = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link in build output');
      if (entry.isDirectory()) visit(file);
      else entries.push([path.relative(root, file), fileDigest(file)]);
    }
  };
  if (!['dist/main/main/index.js', 'dist/renderer/index.html'].every(file => fs.existsSync(path.join(root, file)))) return undefined;
  visit(path.join(root, 'dist'));
  return fingerprint({ id: 'outputs', command: [], includes: () => true }, entries, {});
}

function runDevelopmentChecks(root, { full = false, plan = false, only } = {}) {
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw result.error ?? new Error('Cannot enumerate source files');
    return result.stdout;
  };
  // Include new, non-ignored source and deleted paths; ignored outputs are separately hashed below.
  const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))];
  const entries = files.map(file => [file, fs.existsSync(path.join(root, file)) ? fileDigest(path.join(root, file)) : Buffer.from('deleted')]);
  // Core gates exercise actual ignored binaries, not only their pinned manifest.
  for (const dir of fs.readdirSync(path.join(root, 'resources'), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    for (const binary of ['sing-box', 'sing-box.exe', 'xray', 'xray.exe', 'mihomo', 'mihomo.exe']) {
      const file = `resources/${dir.name}/${binary}`;
      if (fs.existsSync(path.join(root, file))) entries.push([file, fileDigest(path.join(root, file))]);
    }
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmVersion = spawnSync(npm, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (npmVersion.status !== 0) throw new Error('Cannot identify npm toolchain');
  const installedLocks = ['node_modules/.package-lock.json', 'web/node_modules/.modules.yaml'];
  if (installedLocks.some(file => !fs.existsSync(path.join(root, file)))) throw new Error('Install the locked main and frontend dependencies first');
  const context = { node: process.version, npm: npmVersion.stdout.trim(), platform: process.platform, arch: process.arch,
    installedLocks: installedLocks.map(file => fileDigest(path.join(root, file)).toString('hex')) };
  const folder = path.join(root, 'artifacts/development-validation');
  fs.mkdirSync(folder, { recursive: true });
  const cachePath = path.join(folder, 'cache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { /* First run or corrupt cache reruns every check. */ }
  const selected = only ? checks.filter(check => only.includes(check.id)) : checks;
  if (only?.some(id => !checks.some(check => check.id === id))) throw new Error('Unknown development check');
  const commit = git(['rev-parse', 'HEAD']).trim();
  const dirty = !!git(['status', '--porcelain']).trim();
  for (const check of selected) {
    const hash = fingerprint(check, entries, check.id === 'build' ? { ...context, commit, dirty } : context);
    const log = path.join(folder, `${check.id}.log`);
    const outputDigest = check.id === 'build' ? buildDigest(root) : undefined;
    const outputsPresent = check.id !== 'build' || (outputDigest && outputDigest === cache[check.id]?.outputDigest);
    if (!full && outputsPresent && reusable(cache[check.id], hash, log)) {
      console.log(`${check.id}: unchanged inputs; reused passed development check from ${cache[check.id].commit}`);
      continue;
    }
    console.log(`${check.id}: ${plan ? 'would run' : 'running'} npm ${check.command.join(' ')}`);
    if (plan) continue;
    delete cache[check.id];
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    const fd = fs.openSync(log, 'w');
    let result;
    try { result = spawnSync(npm, check.command, { cwd: root, stdio: ['ignore', fd, fd], shell: process.platform === 'win32' }); }
    finally { fs.closeSync(fd); }
    if (result.error || result.status !== 0) throw result.error ?? new Error(`${check.id} failed; see ${log}`);
    cache[check.id] = { status: 'passed', fingerprint: hash, commit, checkedAt: new Date().toISOString(),
      logSha256: createHash('sha256').update(fs.readFileSync(log)).digest('hex'),
      ...(check.id === 'build' ? { outputDigest: buildDigest(root) } : {}) };
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    console.log(`${check.id}: passed`);
  }
  console.log('Development validation only; cached results are not native release evidence.');
}
export function validateDevelopment(root, options = {}) {
  const release = acquireRuntimeLock(path.join(root, 'artifacts/development-validation/run.lock'));
  try { return runDevelopmentChecks(root, options); } finally { release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  try {
    validateDevelopment(path.resolve(import.meta.dirname, '..'), {
      full: args.includes('--full'), plan: args.includes('--plan'),
      only: args.includes('--only') ? args[args.indexOf('--only') + 1]?.split(',') : undefined,
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
