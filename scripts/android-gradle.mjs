#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const candidates = [process.env.JAVA_HOME, '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'].filter(Boolean);
const javaHome = candidates.find(p => fs.existsSync(path.join(p, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')));
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk');
if (!javaHome || !fs.existsSync(sdk)) throw new Error('Android build requires JDK 21 and Android SDK; reuse installed tools or build in CI.');
const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', process.argv.slice(2), {
  cwd: path.join(root, 'android'), stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
