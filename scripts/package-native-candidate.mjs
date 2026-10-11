#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireRuntimeLock } from '../web/scripts/runtime-lock.mjs';
import { cleanCandidates } from './clean-native-candidates.mjs';
import { validateDevelopment } from './validate-development.mjs';
const root = path.resolve(import.meta.dirname, '..');
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('This local candidate entry requires a supported Mac host');
const release = acquireRuntimeLock(path.join(root, 'artifacts/native-candidate.lock'));
try {
  cleanCandidates(root, { remove: true });
  validateDevelopment(root);
  for (const args of [ ['run', 'prepare:package'], ['exec', '--', 'electron-builder', '--mac', `--${process.arch}`, '--dir', '--config.mac.target=dir', '--config.directories.output=dist-native-candidate'] ]) {
    const result = spawnSync('npm', args, { cwd: root, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw result.error ?? new Error('Native candidate packaging failed');
  }
} finally { release(); }
