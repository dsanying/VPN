import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { androidHostTestEnvironment } from './android-host-toolchain.mjs';
const revision = '0d28acc44093df24b2526dea3d6ffefd6b0a54f0';

test('non-Linux builds retain their NDK environment without downloading another compiler', () => {
  const env = { ANDROID_NDK_HOME: '/ndk' };
  assert.equal(androidHostTestEnvironment('/source', '/cache', env, revision, 'darwin', () => assert.fail('unexpected command')), env);
});
test('Linux host tests use the pinned upstream compiler without mutating the Android build environment', () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-cronet-host-'));
  const env = { ANDROID_NDK_HOME: '/ndk', PATH: '/bin' };
  const commands = [];
  const execute = (command, args, options) => {
    commands.push([command, args, options.cwd]);
    let stdout = '';
    if (args[0] === 'mod') stdout = JSON.stringify({ Path: 'github.com/sagernet/cronet-go', Version: 'v0.0.0-20260912104727-0d28acc44093' });
    if (args[0] === 'rev-parse') stdout = revision;
    if (args[0] === 'env') stdout = 'amd64';
    if (args.at(-1) === 'env') stdout = 'CC=/compiler/clang --target=x86_64-linux-gnu\nCXX=/compiler/clang++ --target=x86_64-linux-gnu\nCGO_LDFLAGS=-fuse-ld=lld\nQEMU_LD_PREFIX=/sysroot';
    return { status: 0, stdout };
  };
  try {
    const result = androidHostTestEnvironment('/source', cache, env, revision, 'linux', execute);
    assert.equal(result.CC, '/compiler/clang --target=x86_64-linux-gnu');
    assert.equal(result.CGO_LDFLAGS, '-fuse-ld=lld');
    assert.equal(result.ANDROID_NDK_HOME, '/ndk');
    assert.equal(env.CC, undefined);
    assert.ok(commands.some(([command, args]) => command === 'git' && args.join(' ') === `fetch --depth=1 origin ${revision}`));
    assert.ok(commands.some(([, args]) => args.includes('download-toolchain')));
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
});
test('Linux refuses unpinned compiler metadata before creating a checkout', () => {
  assert.throws(() => androidHostTestEnvironment('/source', '/unused', {}, revision, 'linux', () => ({
    status: 0, stdout: JSON.stringify({ Path: 'github.com/sagernet/cronet-go', Version: 'latest' }),
  })), /pinned Cronet/);
});
