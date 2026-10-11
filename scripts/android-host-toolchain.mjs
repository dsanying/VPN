import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Cronet's Linux archives contain LLVM objects. GNU ld cannot link them.
// Use the toolchain prescribed by the pinned upstream dependency for host tests;
// gomobile still receives the Android NDK environment separately.
export function androidHostTestEnvironment(source, cache, env, revision, platform = process.platform, execute = spawnSync) {
  if (platform !== 'linux') return env;
  function run(command, args, cwd, capture = false) {
    const result = execute(command, args, { cwd, env, ...(capture ? { encoding: 'utf8' } : { stdio: 'inherit' }) });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
    return capture ? result.stdout.trim() : undefined;
  }
  const metadata = JSON.parse(run('go', ['mod', 'download', '-json', 'github.com/sagernet/cronet-go'], source, true));
  const shortRevision = metadata.Version?.match(/^v\d+\.\d+\.\d+-\d{14}-([a-f0-9]{12})$/)?.[1];
  if (metadata.Path !== 'github.com/sagernet/cronet-go' || !/^[a-f0-9]{40}$/.test(revision ?? '') || shortRevision !== revision.slice(0, 12)) throw new Error('Expected a pinned Cronet source revision');
  const checkout = path.join(cache, `cronet-host-${revision}`);
  fs.mkdirSync(checkout, { recursive: true });
  if (!fs.existsSync(path.join(checkout, '.git'))) {
    run('git', ['init', checkout], source);
    run('git', ['remote', 'add', 'origin', 'https://github.com/sagernet/cronet-go.git'], checkout);
    run('git', ['fetch', '--depth=1', 'origin', revision], checkout);
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout);
  }
  if (run('git', ['rev-parse', 'HEAD'], checkout, true) !== revision) throw new Error('Cronet compiler source revision mismatch');
  run('git', ['diff', '--exit-code', 'HEAD'], checkout);
  run('git', ['submodule', 'update', '--init', '--depth=1', 'naiveproxy'], checkout);
  const target = `linux/${run('go', ['env', 'GOARCH'], source, true)}`;
  run('go', ['run', './cmd/build-naive', `--target=${target}`, 'download-toolchain'], checkout);
  const variables = run('go', ['run', './cmd/build-naive', `--target=${target}`, 'env'], checkout, true);
  const hostEnv = { ...env };
  for (const line of variables.split('\n')) {
    const match = line.match(/^(CC|CXX|CGO_LDFLAGS|QEMU_LD_PREFIX)=(.+)$/);
    if (!match) throw new Error(`Unexpected Cronet compiler environment: ${line}`);
    hostEnv[match[1]] = match[2];
  }
  if (!hostEnv.CC || !hostEnv.CXX || !hostEnv.CGO_LDFLAGS) throw new Error('Incomplete Cronet host compiler environment');
  return hostEnv;
}
