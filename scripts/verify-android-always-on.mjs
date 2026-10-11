#!/usr/bin/env node
// Reboot only the explicitly named disposable emulator. No physical device or host network changes.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { emulatorIdentity, instrumentationPassed } from './verify-android-release.mjs';

const serial = process.env.ANDROID_SERIAL;
const sdk = process.env.ANDROID_HOME;
if (!serial || !sdk) throw new Error('Explicit ANDROID_SERIAL and ANDROID_HOME are required');
const adb = path.join(sdk, 'platform-tools/adb');
const logs = [];
const device = (args, timeout = 60_000) => {
  const result = spawnSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  logs.push(output);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Dedicated emulator command failed: ${args[0]}`);
  return output.trim();
};
if (!emulatorIdentity(serial, device(['shell', 'getprop', 'ro.kernel.qemu'])))
  throw new Error('Actual reboot verification is restricted to a disposable emulator');
const packageId = 'com.dsanying.shadowvpn.app';
const settings = ['always_on_vpn_app', 'always_on_vpn_lockdown'];
const before = settings.map(key => device(['shell', 'settings', 'get', 'secure', key]));
if (before[0] !== 'null' && before[0] !== packageId)
  throw new Error('Do not replace another VPN on the validation device');
const output = path.resolve('artifacts/android-arm64');
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, 'always-on-reboot.json');
const git = args => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Cannot identify native test source');
  return result.stdout.trim();
};
const commit = git(['rev-parse', 'HEAD']);
const dirty = !!git(['status', '--porcelain']);
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const report = { version, commit, dirty, passed: false, status: 'running', checkedAt: new Date().toISOString(), previousVpnSettings: Object.fromEntries(settings.map((key, index) => [key, before[index]])) };
fs.writeFileSync(reportPath, JSON.stringify(report) + '\n');
const instrument = phase => {
  const result = device(['shell', 'am', 'instrument', '-w', '-e', 'bootPhase', phase,
    '-e', 'expectedCommit', commit, '-e', 'expectedDirty', String(dirty),
    '-e', 'class', `${packageId}.NativeAlwaysOnDeviceTest`,
    `${packageId}.test/androidx.test.runner.AndroidJUnitRunner`]);
  if (!instrumentationPassed(result)) throw new Error(`Native boot ${phase} assertion failed`);
  return result;
};
try {
  device(['install', '-r', 'android/app/build/outputs/apk/release/app-release.apk']);
  device(['install', '-r', 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk']);
  device(['shell', 'appops', 'set', packageId, 'ACTIVATE_VPN', 'allow']);
  instrument('seed');
  device(['shell', 'settings', 'put', 'secure', settings[1], '0']);
  device(['shell', 'settings', 'put', 'secure', settings[0], packageId]);
  const boot = device(['shell', 'cat', '/proc/sys/kernel/random/boot_id']);
  device(['reboot']);
  // A cold emulator can expose boot_completed before a restarted system_server
  // registers its Binder services. This is OS test readiness, not VPN confirmation.
  const deadline = Date.now() + 300_000;
  let rebooted = false;
  while (Date.now() < deadline) {
    try {
      const next = device(['shell', 'cat', '/proc/sys/kernel/random/boot_id'], 5_000);
      if (next !== boot &&
          device(['shell', 'getprop', 'sys.boot_completed'], 5_000) === '1' &&
          device(['shell', 'service', 'check', 'activity'], 5_000) === 'Service activity: found' &&
          device(['shell', 'service', 'check', 'settings'], 5_000) === 'Service settings: found') {
        rebooted = true; break;
      }
    } catch { /* The OS is offline during the requested reboot; no application status polling. */ }
    await delay(1_000);
  }
  if (!rebooted) throw new Error('The emulator did not complete an actual reboot');
  if (device(['shell', 'settings', 'get', 'secure', settings[0]]) !== packageId)
    throw new Error('The system did not retain this application as its always-on VPN');
  instrument('verify');
  report.passed = true;
  report.status = 'passed';
  report.apkSha256 = createHash('sha256').update(fs.readFileSync('android/app/build/outputs/apk/release/app-release.apk')).digest('hex');
  report.scope = ['actual-system-reboot', 'system-always-on-vpn', 'committed-tunnel-restoration', 'real-tun-https'];
  report.excludes = ['physical-device-vendor-background-policies', 'desktop-login-autostart'];
} finally {
  try {
    instrument('cleanup');
    report.tunnelCleaned = true;
  } catch (error) {
    report.passed = false; report.status = 'failed';
    logs.push(`Owned tunnel cleanup failed: ${error.message}`);
  }
  try {
    for (let index = 0; index < settings.length; index++) {
      if (before[index] === 'null') device(['shell', 'settings', 'delete', 'secure', settings[index]]);
      else device(['shell', 'settings', 'put', 'secure', settings[index], before[index]]);
    }
    report.settingsRestored = settings.every((key, index) => device(['shell', 'settings', 'get', 'secure', key]) === before[index]);
    if (!report.settingsRestored) throw new Error('The emulator VPN settings were not restored');
  } catch (error) {
    report.passed = false; report.status = 'failed'; throw error;
  } finally {
    if (report.status === 'running') report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'always-on-reboot.log'), logs.join('\n'));
    if (!report.passed) process.exitCode = 1;
  }
}
