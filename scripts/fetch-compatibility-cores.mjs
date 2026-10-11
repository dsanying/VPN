import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  existsSync,
  chmodSync,
  renameSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  readFileSync(join(root, 'src/shared/compatibility-core-manifest.json'), 'utf8')
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const platform = process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1];
if (platform && !['mac-arm64', 'mac-x64', 'linux', 'win'].includes(platform))
  throw new Error(`Unsupported platform: ${platform}`);
// Fetch only official, pinned release assets. Executable files stay outside Git.
for (const [engine, spec] of Object.entries(manifest)) {
  for (const [key, asset] of Object.entries(spec.assets)) {
    if (platform && platform !== key) continue;
    if (!/^[a-f0-9]{64}$/.test(asset.binarySha256))
      throw new Error(`Missing executable hash: ${engine}/${key}`);
    const bin = engine + (key === 'win' ? '.exe' : '');
    const dir = join(root, 'resources', key);
    const dest = join(dir, bin);
    if (asset.binarySha256 && existsSync(dest) && hash(readFileSync(dest)) === asset.binarySha256) {
      console.log(`${engine} ${key}: verified ${spec.version}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256))
      throw new Error(`Missing archive hash: ${engine}/${key}`);
    const work = mkdtempSync(join(tmpdir(), 'shadowvpn-core-'));
    try {
      const archive = join(work, asset.name);
      execFileSync('curl', [
        '-fsSL',
        '--retry',
        '3',
        '--connect-timeout',
        '15',
        '--max-time',
        '180',
        '-o',
        archive,
        `https://github.com/${spec.repository}/releases/download/v${spec.version}/${asset.name}`,
      ]);
      const bytes = readFileSync(archive);
      if (hash(bytes) !== asset.sha256) throw new Error(`Archive hash mismatch: ${engine}/${key}`);
      let binary;
      if (asset.name.endsWith('.gz')) binary = gunzipSync(bytes);
      else {
        execFileSync('unzip', ['-q', archive, '-d', join(work, 'extracted')]);
        const files = readdirSync(join(work, 'extracted'));
        const name = files.find((f) => f === bin || (engine === 'mihomo' && f.endsWith('.exe')));
        if (!name) throw new Error(`Missing executable: ${engine}/${key}`);
        binary = readFileSync(join(work, 'extracted', name));
      }
      const digest = hash(binary);
      if (asset.binarySha256 && asset.binarySha256 !== digest)
        throw new Error(`Binary hash mismatch: ${engine}/${key}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dest}.tmp`, binary, { mode: 0o755 });
      chmodSync(`${dest}.tmp`, 0o755);
      renameSync(`${dest}.tmp`, dest);
      console.log(`${engine} ${key}: ${spec.version}, binarySha256=${digest}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(`${dest}.tmp`, { force: true });
    }
  }
}
