#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/android-core-manifest.json')));
const cache = process.env.SHADOW_TOOLCHAIN_CACHE || path.join(os.homedir(), '.local/share/shadowvpn-toolchains');
const source = path.join(cache, 'sing-box-source');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
function output(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}
fs.mkdirSync(cache, { recursive: true });
if (!fs.existsSync(source)) run('git', ['clone', '--depth', '1', '--branch', `v${manifest.version}`, `https://github.com/${manifest.repository}.git`, source]);
if (output('git', ['rev-parse', 'HEAD'], source) !== manifest.commit) throw new Error('Android engine source does not match pinned commit');
run('git', ['diff', '--exit-code', 'HEAD'], { cwd: source });
if (output('git', ['status', '--porcelain', '--untracked-files=normal'], source)) throw new Error('Android engine source tree must be clean');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk');
const javaHome = [process.env.JAVA_HOME, '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'].filter(Boolean).find(p => fs.existsSync(path.join(p, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')));
const ndk = path.join(sdk, 'ndk', manifest.ndkVersion);
if (!javaHome || !fs.existsSync(ndk)) throw new Error(`Build requires JDK 21 and Android NDK ${manifest.ndkVersion}; use installed CLI tools or CI`);
const license = path.join(source, 'LICENSE');
fs.copyFileSync(license, path.join(root, 'licenses/sing-box-android-LICENSE.txt'));
const licenseAssets = path.join(root, 'android/app/src/main/assets/licenses');
fs.mkdirSync(licenseAssets, { recursive: true });
fs.copyFileSync(license, path.join(licenseAssets, 'sing-box-LICENSE.txt'));
const outputDir = path.join(root, 'android/app/libs'); fs.mkdirSync(outputDir, { recursive: true });
const aar = path.join(outputDir, 'libbox.aar');
const receipt = path.join(outputDir, 'libbox-build.json');
const sourceArchive = path.join(outputDir, `sing-box-android-source-${manifest.version}.tar.gz`);
const overlay = path.join(root, 'android/core-overlay');
const overlayFiles = fs.readdirSync(overlay).filter(name => name.endsWith('.go')).sort();
const overlayDigest = crypto.createHash('sha256');
for (const name of overlayFiles) overlayDigest.update(name).update(fs.readFileSync(path.join(overlay, name)));
const overlaySha256 = overlayDigest.digest('hex');
const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).update(overlaySha256).update(fs.readFileSync(import.meta.filename)).digest('hex');
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
if (fs.existsSync(aar) && fs.existsSync(receipt)) {
  const previous = JSON.parse(fs.readFileSync(receipt));
  if (previous.fingerprint === fingerprint && previous.sha256 === digest(aar) && fs.existsSync(sourceArchive) && previous.sourceSha256 === digest(sourceArchive)) { console.log('Pinned Android engine already verified'); process.exit(0); }
}
const goBin = path.join(cache, 'go-bin'); fs.mkdirSync(goBin, { recursive: true });
const env = { ...process.env, GOBIN: goBin, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_NDK_HOME: ndk, PATH: goBin + path.delimiter + process.env.PATH };
run('go', ['install', `github.com/sagernet/gomobile/cmd/gomobile@${manifest.gomobileVersion}`, `github.com/sagernet/gomobile/cmd/gobind@${manifest.gomobileVersion}`], { env });
// Build an owned overlay in an ordinary staging directory; the pinned source checkout stays clean.
const stagedSource = fs.mkdtempSync(path.join(cache, 'libbox-build-'));
fs.cpSync(source, stagedSource, { recursive: true, filter: file => !file.split(path.sep).includes('.git') });
for (const name of overlayFiles) fs.copyFileSync(path.join(overlay, name), path.join(stagedSource, 'experimental/libbox', name));
const temporary = path.join(outputDir, `libbox-${process.pid}.aar`);
try {
  run('go', ['test', '-ldflags=-checklinkname=0', '-tags', manifest.tags.join(','), './experimental/libbox', '-run', '^TestShadowProbe', '-count=1'], { cwd: stagedSource, env });
  run(path.join(goBin, process.platform === 'win32' ? 'gomobile.exe' : 'gomobile'), [
    'bind', '-o', temporary, '-target', manifest.target, '-androidapi', String(manifest.androidApi),
    '-javapkg=io.nekohasekai', '-libname=box', '-trimpath', '-buildvcs=false',
    '-ldflags', `-s -w -buildid= -checklinkname=0 -X github.com/sagernet/sing-box/constant.Version=${manifest.version}`,
    '-tags', manifest.tags.join(','), './experimental/libbox',
  ], { cwd: stagedSource, env });
  const bindArguments = [
    'bind', '-o', 'libbox.aar', '-target', manifest.target, '-androidapi', String(manifest.androidApi),
    '-javapkg=io.nekohasekai', '-libname=box', '-trimpath', '-buildvcs=false',
    '-ldflags', `-s -w -buildid= -checklinkname=0 -X github.com/sagernet/sing-box/constant.Version=${manifest.version}`,
    '-tags', manifest.tags.join(','), './experimental/libbox',
  ];
  fs.writeFileSync(path.join(stagedSource, 'SHADOWVPN-BUILD.json'), JSON.stringify({ ...manifest, overlaySha256, fingerprint, bindArguments, overlayDirectory: 'experimental/libbox', sourceLicense: 'GPL-3.0-or-later' }, null, 2) + '\n');
  fs.writeFileSync(path.join(stagedSource, 'build-shadow-libbox.mjs'), `// Build from this unpacked modified source. Requires Node.js, Go, JDK 21, Android SDK and pinned NDK.\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport { spawnSync } from 'node:child_process';\nconst manifest = JSON.parse(fs.readFileSync(new URL('./SHADOWVPN-BUILD.json', import.meta.url)));\nconst source = import.meta.dirname;\nif (!process.env.JAVA_HOME || !process.env.ANDROID_HOME) throw new Error('Set JAVA_HOME and ANDROID_HOME');\nconst env = { ...process.env, ANDROID_NDK_HOME: path.join(process.env.ANDROID_HOME, 'ndk', manifest.ndkVersion) };\nfunction run(command, args) { const result = spawnSync(command, args, { cwd: source, env, stdio: 'inherit' }); if (result.error) throw result.error; if (result.status !== 0) throw new Error(command + ' failed'); }\nrun('go', ['install', 'github.com/sagernet/gomobile/cmd/gomobile@' + manifest.gomobileVersion, 'github.com/sagernet/gomobile/cmd/gobind@' + manifest.gomobileVersion]);\n// Ensure the Go bin directory is present in PATH (go env GOPATH + /bin, or GOBIN).\nrun('go', ['test', '-ldflags=-checklinkname=0', '-tags', manifest.tags.join(','), './experimental/libbox', '-run', '^TestShadowProbe', '-count=1']);\nrun('gomobile', manifest.bindArguments);\n`);
  run('tar', ['-czf', sourceArchive, '-C', stagedSource, '.']);
  fs.renameSync(temporary, aar);
  fs.writeFileSync(receipt, JSON.stringify({ ...manifest, overlaySha256, fingerprint, sha256: digest(aar), sourceSha256: digest(sourceArchive), sourceArchive: path.basename(sourceArchive) }, null, 2) + '\n');
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(root, 'licenses/sing-box-android-LICENSE.txt'));
  console.log(`Android engine ${manifest.version}: ${manifest.target}, SHA-256 verified`);
} finally {
  fs.rmSync(stagedSource, { recursive: true, force: true });
  fs.rmSync(temporary, { force: true });
  fs.rmSync(temporary.replace(/\.aar$/, '-sources.jar'), { force: true });
}
