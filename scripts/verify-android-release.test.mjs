import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { instrumentationPassed, emulatorIdentity, parseApkIdentity } from './verify-android-release.mjs';
test('ADB zero exit does not substitute for a completed successful instrumentation report', () => {
  assert.equal(instrumentationPassed('\nOK (12 tests)\n'), true);
  assert.equal(instrumentationPassed('\nOK (1 test)\n'), true);
  for (const output of ['OK (0 tests)\n', 'INSTRUMENTATION_CODE: -1', 'FAILURES!!!\nOK (2 tests)\n', 'INSTRUMENTATION_FAILED\nOK (2 tests)\n', 'OK (0 tests unfinished)', 'Error in test run'])
    assert.equal(instrumentationPassed(output), false, output);
});
test('reset and permission fixtures never target a physical or ambiguously identified device', () => {
  assert.equal(emulatorIdentity('emulator-5554', '1\n'), true);
  for (const [serial, property] of [['real-device', '1'], ['emulator-5554', '0'], ['emulator-5554-extra', '1'], [undefined, '1']])
    assert.equal(emulatorIdentity(serial, property), false);
});

test('baseline identity accepts only the app stable version and Android numeric version code', () => {
  assert.deepEqual(parseApkIdentity("package: name='com.dsanying.shadowvpn.app' versionCode='1000' versionName='0.1.0' platformBuildVersionName='16'"), { versionCode: 1000, version: '0.1.0' });
  for (const line of ["package: name='another.app' versionCode='1000' versionName='0.1.0'", "package: name='com.dsanying.shadowvpn.app' versionCode='1000' versionName='debug'", ''])
    assert.throws(() => parseApkIdentity(line), /identity/);
});
