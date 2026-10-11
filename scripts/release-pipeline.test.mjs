import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { load } = createRequire(import.meta.url)('js-yaml');
import { checkPlatforms } from './check-client-platforms.mjs';

const scripts = import.meta.dirname;
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-release-test-'));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function report(root, name, changes = {}) {
  const dir = path.join(root, name, 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'native-check.txt'), 'fixture only');
  fs.writeFileSync(path.join(dir, 'client-platform-evidence.json'), JSON.stringify({
    version: '1.0.0', commit: 'a'.repeat(40), targets: [{ platform: name, arch: 'arm64', files: ['artifacts/native-check.txt'] }], ...changes,
  }));
}
const collect = root => spawnSync(process.execPath, [path.join(scripts, 'collect-client-evidence.mjs'), root], { encoding: 'utf8' });
test('merges only existing reports and preserves each uploaded file reference', () => fixture(root => {
  report(root, 'macos'); report(root, 'android');
  const result = collect(root);
  assert.equal(result.status, 0, result.stderr);
  const merged = JSON.parse(fs.readFileSync(path.join(root, 'client-platform-evidence.json')));
  assert.equal(merged.targets.length, 2);
  for (const row of merged.targets) assert.ok(fs.existsSync(path.resolve(row.files[0])));
}));
test('does not fabricate native evidence from an installer alone', () => fixture(root => {
  fs.writeFileSync(path.join(root, 'installer.exe'), 'fixture');
  assert.notEqual(collect(root).status, 0);
  assert.equal(fs.existsSync(path.join(root, 'client-platform-evidence.json')), false);
}));
function releaseFixture(root) {
  fs.writeFileSync(path.join(root, 'client-platforms.json'), JSON.stringify({
    schemaVersion: 1, version: '1.0.0', commit: 'a'.repeat(40),
    targets: [{ platform: 'android', arch: 'arm64', host: 'capacitor', buildCommand: 'build' }],
    nativeChecks: ['launch', 'layout', 'operations'], evidenceFile: 'evidence.json',
  }));
  fs.writeFileSync(path.join(root, 'native.txt'), 'fixture only');
  const evidence = { version: '1.0.0', commit: 'a'.repeat(40), targets: [{
    platform: 'android', arch: 'arm64', host: 'capacitor', build: 'passed', native: true,
    checks: { launch: 'passed', layout: 'passed', operations: 'passed' }, files: ['native.txt'],
  }] };
  fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence));
  return evidence;
}
test('native release evidence cannot reference an outside file directly or through a symlink', () => fixture(root => {
  const evidence = releaseFixture(root);
  assert.deepEqual(checkPlatforms(root, { release: true }), []);
  const outside = path.join(os.tmpdir(), `shadow-outside-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(outside, 'unrelated evidence');
  try {
    for (const ref of [outside, path.relative(root, outside)]) {
      evidence.targets[0].files = [ref];
      fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence));
      assert.ok(checkPlatforms(root, { release: true }).some(error => /artifact/.test(error)));
    }
    // Windows CI may lack symlink privilege; exercise the escape check on Unix hosts.
    if (process.platform !== 'win32') {
      fs.symlinkSync(outside, path.join(root, 'linked.txt'));
      evidence.targets[0].files = ['linked.txt'];
      fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence));
      assert.ok(checkPlatforms(root, { release: true }).some(error => /escapes project/.test(error)));
    }
  } finally { fs.rmSync(outside, { force: true }); }
}));
test('release rejects source changes even when native evidence names HEAD', () => fixture(root => {
  releaseFixture(root);
  const gitRunner = (_command, args) => ({
    status: 0, stdout: args[0] === 'rev-parse' ? 'a'.repeat(40) : '?? changed-source.ts\n',
  });
  assert.ok(checkPlatforms(root, { release: true, gitRunner }).includes('Release requires a clean committed source tree'));
  const cleanGitRunner = (_command, args) => ({
    status: 0, stdout: args[0] === 'rev-parse' ? 'a'.repeat(40) : '',
  });
  assert.deepEqual(checkPlatforms(root, { release: true, gitRunner: cleanGitRunner }), []);
}));
test('rejects mixed builds and references outside the platform upload', () => fixture(root => {
  report(root, 'macos'); report(root, 'android', { commit: 'b'.repeat(40) });
  assert.notEqual(collect(root).status, 0);
  fs.rmSync(path.join(root, 'android'), { recursive: true });
  report(root, 'macos', { targets: [{ platform: 'macos', arch: 'arm64', files: ['../outside.txt'] }] });
  assert.notEqual(collect(root).status, 0);
}));
test('CI rejects a tag that differs from the packaged version', () => {
  const version = JSON.parse(fs.readFileSync(path.join(scripts, '../package.json'))).version;
  const run = tag => spawnSync(process.execPath, [path.join(scripts, 'check-release-version.mjs')], { env: { ...process.env, GITHUB_REF: tag } });
  assert.equal(run(`refs/tags/v${version}`).status, 0);
  assert.notEqual(run('refs/tags/v999.999.999').status, 0);
});
test('candidate builds cannot publish a release or bypass tag validation', () => {
  const script = path.join(scripts, 'check-release-version.mjs');
  const run = (event, ref, args = ['--candidate']) => spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref },
  });
  assert.equal(run('workflow_dispatch', 'refs/heads/main').status, 0);
  assert.notEqual(run('push', 'refs/heads/main').status, 0);
  assert.notEqual(run('workflow_dispatch', 'refs/tags/v999.999.999').status, 0);
  assert.notEqual(run('workflow_dispatch', 'refs/heads/main', []).status, 0);
  const release = load(fs.readFileSync(path.join(scripts, '../.github/workflows/release.yml'), 'utf8'));
  assert.ok(Object.hasOwn(release.on, 'workflow_dispatch'));
  assert.equal(release.jobs['create-release'].if, "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
  assert.ok(release.jobs['create-release'].steps.some(step => step.run?.includes('check-client-platforms.mjs --release')));
});
test('Android release setup does not request the retired SDK tools package', () => {
  const release = load(fs.readFileSync(path.join(scripts, '../.github/workflows/release.yml'), 'utf8'));
  const setup = release.jobs.release.steps.find(step => step.name === 'Setup Android SDK');
  assert.equal(setup.uses, 'android-actions/setup-android@v4');
  assert.equal(setup.with.packages, 'platform-tools');
});
test('clean CI prepares pinned native binaries before tests and uploads referenced native reports', () => {
  const workflow = name => load(fs.readFileSync(path.join(scripts, '../.github/workflows', name), 'utf8'));
  for (const [name, job] of [['ci.yml', 'test'], ['release.yml', 'release']]) {
    const jobs = workflow(name).jobs;
    const steps = (jobs[job] ?? Object.values(jobs).find(value => value.steps?.some(step => step.run?.includes('npm test')))).steps;
    const fetchAt = steps.findIndex(step => step.run?.includes('npm run fetch:core'));
    const testsAt = steps.findIndex(step => step.run?.includes('npm test'));
    assert.ok(fetchAt >= 0 && testsAt > fetchAt, `${name}: native fixtures must precede default tests`);
  }
  const upload = workflow('release.yml').jobs.release.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  const sourceArchive = 'sing-box-android-source-*.tar.gz';
  assert.ok(upload.with.path.includes(`android/app/libs/${sourceArchive}`));
  const publication = workflow('release.yml').jobs['create-release'].steps.find(step => step.uses?.startsWith('softprops/action-gh-release@'));
  assert.ok(publication.with.files.includes(`artifacts/**/${sourceArchive}`), 'Modified GPL source must accompany the distributed APK');
  const ignoredArchive = spawnSync('git', ['check-ignore', '--no-index', 'android/app/libs/sing-box-android-source-validation.tar.gz'], {
    cwd: path.resolve(scripts, '..'), encoding: 'utf8',
  });
  assert.equal(ignoredArchive.status, 0, 'Generated archive must not change the committed source identity during a clean build');
  for (const platform of ['mac-arm64', 'mac-x64', 'windows-x64', 'android-arm64'])
    assert.ok(upload.with.path.includes(`artifacts/${platform}/**`), `missing native evidence files: ${platform}`);
  const smoke = workflow('package.yml').jobs.package.steps.find(step => step.name?.includes('Package smoke')).run;
  assert.ok(smoke.indexOf('npm run prepare:package') > smoke.indexOf('npm run build &&'));
  assert.ok(smoke.indexOf('npx electron-builder') > smoke.indexOf('npm run prepare:package'));
  const release = workflow('release.yml');
  assert.ok(release.jobs['create-release'].needs.includes('native-mac'));
  assert.deepEqual(release.jobs['native-mac'].strategy.matrix.include.map(row => row.arch).sort(), ['arm64', 'x64']);
});
