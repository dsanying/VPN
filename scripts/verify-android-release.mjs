#!/usr/bin/env node
// Validate installed signed artifacts on an explicitly disposable emulator, not a user's device.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export function instrumentationPassed(output) {
  return /(?:^|\n)OK \([1-9]\d* tests?\)(?:\r?\n|$)/.test(output) &&
    !/INSTRUMENTATION_FAILED|FAILURES!!!|Error in test run/.test(output);
}
export function emulatorIdentity(serial, property) {
  return /^emulator-\d+$/.test(serial ?? '') && property.trim() === '1';
}
function execute(command, args, options = {}) {
  // TCG-accelerated emulators run instrumentation and APK installs far slower than hardware; 15 minutes is the bound for a genuinely stuck ADB call.
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 900_000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}): ${result.stdout}${result.stderr}`);
  return result.stdout + result.stderr;
}
export function parseApkIdentity(badging) {
  const match = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging);
  if (!match || match[1] !== 'com.dsanying.shadowvpn.app' || !/^\d+\.\d+\.\d+$/.test(match[3]))
    throw new Error('APK has an invalid application or release identity');
  return { versionCode: Number(match[2]), version: match[3] };
}
export function verifyAndroidRelease({ root = process.cwd(), serial, sdk, javaHome, reset = false, baselineApk }) {
  const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const device = args => execute(adb, ['-s', serial, ...args]);
  if (!emulatorIdentity(serial, device(['shell', 'getprop', 'ro.kernel.qemu'])))
    throw new Error('This runner requires an explicitly named disposable emulator');
  const apk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
  const tests = path.join(root, 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk');
  const signer = path.join(sdk, 'build-tools/35.0.0', process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
  const signerOptions = { env: { ...process.env, JAVA_HOME: javaHome }, shell: process.platform === 'win32' };
  const certificateOf = file => {
    const report = execute(signer, ['verify', '--print-certs', file], signerOptions);
    const certificate = /^Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})$/m.exec(report)?.[1];
    if (!certificate) throw new Error('Missing APK signer certificate');
    return certificate;
  };
  const certificate = certificateOf(apk);
  if (certificateOf(tests) !== certificate) throw new Error('Instrumentation and release APK signing identities differ');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const commit = execute('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
  const dirty = !!execute('git', ['status', '--porcelain'], { cwd: root }).trim();
  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(apk), 'output-metadata.json'), 'utf8'));
  if (metadata.elements?.[0]?.versionName !== version) throw new Error('APK version differs from source version');
  let baseline;
  if (baselineApk) {
    if (certificateOf(baselineApk) !== certificate) throw new Error('Baseline APK signing identity differs');
    const aapt = path.join(sdk, 'build-tools/35.0.0', process.platform === 'win32' ? 'aapt.exe' : 'aapt');
    baseline = parseApkIdentity(execute(aapt, ['dump', 'badging', baselineApk]));
    if (baseline.versionCode >= metadata.elements[0].versionCode)
      throw new Error('Version upgrade requires a strictly older baseline APK');
  }
  const output = path.join(root, 'artifacts/android-arm64');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'signed-native-checks.json'), JSON.stringify({ version, certificate, passed: false, status: 'running', checkedAt: new Date().toISOString() }) + '\n');
  const logs = [];
  const act = args => { const result = device(args); logs.push(result); return result; };
  const runner = 'com.dsanying.shadowvpn.app.test/androidx.test.runner.AndroidJUnitRunner';
  const packageId = 'com.dsanying.shadowvpn.app';
  const marker = `fictional-retention-${Date.now()}`;
  const common = ['shell', 'am', 'instrument', '-w', '-e', 'expectedVersion', version,
    '-e', 'expectedCertificate', certificate, '-e', 'retentionMarker', marker];
  const instrument = (stage, classes, expectedVersion = version) => {
    const arguments_ = [...common]; arguments_[arguments_.indexOf('expectedVersion') + 1] = expectedVersion;
    if (!baseline || stage !== 'seed') arguments_.push('-e', 'expectedCommit', commit, '-e', 'expectedDirty', String(dirty));
    const result = act([...arguments_, '-e', 'retentionStage', stage, '-e', 'class', classes.map(name => packageId + '.' + name).join(','), runner]);
    if (!instrumentationPassed(result)) throw new Error('Native instrumentation did not pass');
  };
  try {
    // Reset is opt-in and restricted to the dedicated emulator, before installing any artifacts.
    if (reset) {
      const installed = device(['shell', 'pm', 'list', 'packages']);
      for (const id of [packageId + '.test', packageId])
        if (installed.split(/\r?\n/).includes('package:' + id)) act(['uninstall', id]);
    }
    act(['install', '-r', baselineApk ?? apk]);
    act(['install', '-r', tests]);
    instrument('seed', ['NativeSignedReleaseTest'], baseline?.version ?? version);
    act(['install', '-r', apk]);
    instrument('verify', ['NativeSignedReleaseTest', 'NativeBackendTest', 'NativeNetworkDeviceTest', 'NativeBackgroundEngineTest', 'NativeBusinessHostTest', 'NativeVpnLaunchTest', 'NativeBackgroundLifecycleTest']);
    act(['shell', 'appops', 'set', packageId, 'ACTIVATE_VPN', 'allow']);
    instrument('verify', ['NativeVpnDeviceTest', 'NativeUpdateChannelsTest']);
    fs.writeFileSync(path.join(output, 'signed-native-checks.json'), JSON.stringify({
      version, commit, dirty, certificate, checkedAt: new Date().toISOString(),
      apkSha256: createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),
      scope: ['release-identity', 'package-replacement-retains-database', 'database-and-jni', 'https', 'native-tun-start-stop', 'authenticated-download-channels', 'headless-engine-capability', 'headless-shared-business', 'private-large-launch', 'durable-background-cadence'],
      ...(baseline ? { upgrade: { from: baseline.version, to: version, databaseRetained: true } } : {}),
      passed: true,
      excludes: [...(baseline ? [] : ['version-upgrade']), 'public-update-chain', 'native-layout', 'background-full-cycle', 'autostart'],
    }, null, 2) + '\n');
    // Release evidence collected by create-release; refs are repo-relative paths inside the same artifact tree.
    fs.writeFileSync(path.join(root, 'artifacts', 'client-platform-evidence.json'), JSON.stringify({
      version, commit,
      targets: [{
        platform: 'android', arch: 'arm64', host: 'capacitor', build: 'passed', native: true,
        checks: { launch: 'passed', operations: 'passed', network: 'passed', updates: 'passed' },
        environment: 'disposable arm64 emulator',
        files: ['artifacts/android-arm64/signed-native-checks.json', 'artifacts/android-arm64/signed-native-checks.log'],
      }],
    }, null, 2) + '\n');
  } finally {
    fs.writeFileSync(path.join(output, 'signed-native-checks.log'), logs.join('\n'));
    const reportPath = path.join(output, 'signed-native-checks.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.status === 'running') {
      report.status = 'failed';
      report.finishedAt = new Date().toISOString();
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const get = key => process.argv[process.argv.indexOf(key) + 1];
  const serial = process.argv.includes('--serial') ? get('--serial') : process.env.ANDROID_SERIAL;
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const javaHome = process.env.JAVA_HOME;
  if (!serial || !sdk || !javaHome) throw new Error('Set ANDROID_SERIAL, ANDROID_HOME and JAVA_HOME; no toolchain is installed by this runner');
  verifyAndroidRelease({ serial, sdk, javaHome, reset: process.argv.includes('--reset-fixture'), baselineApk: process.argv.includes('--baseline-apk') ? path.resolve(get('--baseline-apk')) : undefined });
}
