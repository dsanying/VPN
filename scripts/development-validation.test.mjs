import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checks, fingerprint, reusable } from './validate-development.mjs';
import { candidateDirectories, cleanCandidates, registeredCandidates, unregisterCandidate } from './clean-native-candidates.mjs';

const context = { node: 'fixture', platform: 'darwin', arch: 'arm64' };
const hash = (id, entries, environment = context) => fingerprint(checks.find(check => check.id === id), entries, environment);
test('unrelated Android and documentation changes do not invalidate desktop development checks', () => {
  const base = [['src/main/index.ts', 'source'], ['android/app/MainActivity.java', 'native'], ['docs/report.md', 'report']];
  const changed = [base[0], [base[1][0], 'changed'], [base[2][0], 'changed']];
  for (const check of checks) assert.equal(hash(check.id, base), hash(check.id, changed));
});
test('shared source and lock changes invalidate affected checks, including type and core checks', () => {
  for (const file of ['src/shared/types.ts', 'package-lock.json']) {
    for (const check of checks) assert.notEqual(hash(check.id, [[file, 'before']]), hash(check.id, [[file, 'after']]));
  }
});
test('actual core binary and toolchain changes invalidate the exercised checks', () => {
  assert.notEqual(hash('core', [['resources/mac-arm64/sing-box', 'old']]), hash('core', [['resources/mac-arm64/sing-box', 'new']]));
  assert.notEqual(hash('tests', []), hash('tests', [], { ...context, node: 'updated' }));
});
test('deleted and new source paths invalidate cached checks', () => {
  const entries = [['src/main/first.ts', 'source']];
  assert.notEqual(hash('tests', entries), hash('tests', []));
  assert.notEqual(hash('tests', entries), hash('tests', [...entries, ['src/main/new.ts', 'source']]));
});
test('missing, modified, failed or mismatched result logs cannot be reused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-check-cache-'));
  try {
    const file = path.join(root, 'check.log'); fs.writeFileSync(file, 'passed');
    const record = { status: 'passed', fingerprint: 'input', logSha256: createHash('sha256').update('passed').digest('hex') };
    assert.equal(reusable(record, 'input', file), true);
    assert.equal(reusable({ ...record, status: 'failed' }, 'input', file), false);
    assert.equal(reusable(record, 'other', file), false);
    fs.writeFileSync(file, 'changed'); assert.equal(reusable(record, 'input', file), false);
    fs.rmSync(file); assert.equal(reusable(record, 'input', file), false);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('candidate cleanup is bounded to declared generated directories and ignores symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-candidate-clean-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-user-data-'));
  try {
    for (const name of ['dist-validation68', 'dist-native-candidate', 'dist-package', 'dist-validation-not-owned', 'src', 'user-data']) fs.mkdirSync(path.join(root, name));
    if (process.platform !== 'win32') fs.symlinkSync(external, path.join(root, 'dist-validation69'));
    assert.equal(candidateDirectories(root).length, 3);
    cleanCandidates(root, { remove: true, runner: () => ({ status: 0, stdout: '' }) });
    for (const name of ['src', 'user-data', 'dist-validation-not-owned']) assert.ok(fs.existsSync(path.join(root, name)));
    assert.ok(fs.existsSync(external));
    assert.equal(candidateDirectories(root).length, 0);
  } finally { fs.rmSync(root, { recursive: true }); fs.rmSync(external, { recursive: true }); }
});
test('stale registry cleanup excludes the real installation and other projects', () => {
  const root = '/Users/fixture/VPN';
  const dump = ['/Applications/暗影VPN.app', `${root}/dist-validation68/mac-arm64/暗影VPN.app`,
    `${root}/dist-validation/mac/暗影VPN.app`, '/Users/fixture/Other/dist-validation68/mac-arm64/暗影VPN.app',
    `${root}/dist-validation68/mac-arm64/Other.app`].map(bundle => `path: ${bundle} (0x1234)`).join('\n');
  assert.deepEqual(registeredCandidates(root, dump), [`${root}/dist-validation68/mac-arm64/暗影VPN.app`, `${root}/dist-validation/mac/暗影VPN.app`]);
});
test('already unregistered candidates are accepted only after confirming registry absence', { skip: process.platform !== 'darwin' }, () => {
  const bundle = '/Users/fixture/VPN/dist-native-candidate/mac-arm64/暗影VPN.app';
  const runner = present => (_command, args) => args[0] === '-u'
    ? { status: 1, stderr: 'failed to scan: -10814' }
    : { status: 0, stdout: present ? `path: ${bundle} (0x1234)` : '' };
  assert.doesNotThrow(() => unregisterCandidate(bundle, runner(false)));
  assert.throws(() => unregisterCandidate(bundle, runner(true)), /Cannot unregister/);
  assert.throws(() => unregisterCandidate(bundle, () => ({ status: 1, stderr: 'permission denied' })), /Cannot unregister/);
});
