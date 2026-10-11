#!/usr/bin/env node
// Exercises only the installed app's public business IPC, never a mocked Electron host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyInstalledUi } from './installed-ui-checks.mjs';
import { candidateDirectories, unregisterCandidate } from './clean-native-candidates.mjs';

if (!['darwin', 'win32'].includes(process.platform)) throw new Error('A native desktop runner is required');
const at = process.argv.indexOf('--exe');
if (at < 0) throw new Error('Supply the installed --exe path');
const executable = path.resolve(process.argv[at + 1]);
if (!fs.statSync(executable).isFile()) throw new Error('Installed executable is missing');
const root = process.cwd();
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Acceptance source commit is missing');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-installed-'));
const output = path.join(root, 'artifacts', process.platform === 'win32' ? 'windows-x64' : `mac-${process.arch}`);
fs.mkdirSync(output, { recursive: true });
const reportFile = path.join(output, 'installed-business.json');
fs.writeFileSync(reportFile, JSON.stringify({ version, commit, passed: false, status: 'running', checkedAt: new Date().toISOString() }) + '\n');
const log = fs.openSync(path.join(output, 'installed-business.log'), 'w');
const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const selected = server.address().port; server.close(() => resolve(selected)); });
});
const args = [`--validation-profile=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`];
let nativeApplication;
let child;
let launchError;
let socket;
let invoke;
let originalAutostart;
const checks = {};
try {
  if (process.argv.includes('--layout')) {
    const { _electron } = createRequire(path.resolve('web/package.json'))('@playwright/test');
    nativeApplication = await _electron.launch({ executablePath: executable, args, timeout: 90_000 });
    child = nativeApplication.process();
    const stream = fs.createWriteStream(null, { fd: log, autoClose: false });
    child.stdout?.pipe(stream); child.stderr?.pipe(stream);
  } else child = spawn(executable, args, { stdio: ['ignore', log, log] });
  child.on('error', error => { launchError = error; });
  let target;
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Installed application exited: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      target = (await response.json()).find(value => value.type === 'page' && value.url.startsWith('file:'));
      if (target) break;
    } catch { /* The actual process has not exposed its application target yet. */ }
    await delay(250);
  }
  if (!target) throw new Error('Installed application target never became ready');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    const waiting = pending.get(message.id);
    if (waiting) { pending.delete(message.id); waiting(message); }
  });
  const evaluate = async expression => {
    const id = ++sequence;
    const response = new Promise(resolve => pending.set(id, resolve));
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    let timer;
    try {
      const reply = await Promise.race([response, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Installed IPC timed out')), 30_000); })]);
      if (reply.error || reply.result?.exceptionDetails) throw new Error('Installed IPC execution failed');
      return reply.result.result.value;
    } finally { clearTimeout(timer); pending.delete(id); }
  };
  invoke = async (channel, args) => {
    const result = await evaluate(`window.electron.ipcRenderer.invoke(${JSON.stringify(channel)},${JSON.stringify(args) ?? 'undefined'})`);
    assert.equal(result?.success, true, `Native IPC failed: ${channel}`);
    return result.data;
  };
  let identity;
  for (let retry = 0; retry < 40; retry++) {
    try { identity = await invoke('version:getInfo'); break; } catch (error) { if (retry === 39) throw error; await delay(250); }
  }
  assert.equal(identity.appVersion, version);
  assert.equal(identity.buildCommit, commit, 'Installed binary must have the source commit embedded during its build');
  if (process.env.CI === 'true') assert.equal(identity.buildDirty, false, 'CI acceptance requires a clean-source binary');
  assert.equal(identity.platform, process.platform);
  assert.equal(identity.arch, process.arch);
  assert.match(identity.singBoxVersion, /^\d+\.\d+/);
  checks.launch = 'passed';
  const before = await invoke('config:get');
  assert.equal(before.autoStart, false, 'Disposable acceptance profile must start without autostart');
  await invoke('config:save', { ...before, language: 'en-US' });
  assert.equal((await invoke('config:get')).language, 'en-US');
  await invoke('config:save', before);
  checks.operations = 'passed';
  originalAutostart = (await invoke('autoStart:getStatus')).enabled;
  assert.equal(await invoke('autoStart:set', { enabled: true }), true);
  assert.equal((await invoke('autoStart:getStatus')).enabled, true);
  assert.equal(await invoke('autoStart:set', { enabled: false }), true);
  assert.equal((await invoke('autoStart:getStatus')).enabled, false);
  checks.autostart = 'passed';
  const ui = process.argv.includes('--layout') ? await verifyInstalledUi(nativeApplication, output) : undefined;
  if (ui) checks.layout = 'passed';
  const archive = path.resolve(path.dirname(executable), process.platform === 'darwin' ? '../Resources/app.asar' : 'resources/app.asar');
  fs.writeFileSync(reportFile, JSON.stringify({
    version, commit: identity.buildCommit, dirty: identity.buildDirty,
    passed: true, status: 'passed',
    executableSha256: createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    applicationArchiveSha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    platform: identity.platform, arch: identity.arch, native: true, checkedAt: new Date().toISOString(), checks, ui,
    excludes: [...(ui ? [] : ['layout']), 'network', 'updates', 'login-after-reboot', 'version-upgrade'],
  }, null, 2) + '\n');
} finally {
  if (invoke && originalAutostart !== undefined) {
    try { assert.equal(await invoke('autoStart:set', { enabled: originalAutostart }), true); }
    catch (error) { console.error('Failed to restore acceptance autostart state'); process.exitCode = 1; }
  }
  socket?.close();
  if (nativeApplication) await nativeApplication.close().catch(() => {});
  if (child?.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  // Isolated native acceptance must not leave another product entry in LaunchServices.
  if (process.platform === 'darwin') {
    const bundle = path.resolve(path.dirname(executable), '../..');
    if (candidateDirectories(root).some(directory => bundle.startsWith(directory + path.sep))) unregisterCandidate(bundle);
  }
  fs.closeSync(log);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  if (report.status === 'running' || process.exitCode) {
    report.passed = false; report.status = 'failed'; report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  }
}
console.log('Installed native business checks passed; remaining platform checks are explicitly excluded.');
