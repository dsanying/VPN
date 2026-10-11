#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export function checkPlatforms(root, { release = false, evidencePath, gitRunner = spawnSync } = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'client-platforms.json'), 'utf8'));
  const errors = [];
  const allowed = new Set(['macos', 'windows', 'linux', 'android', 'ios']);
  if (config.schemaVersion !== 1) errors.push('Unsupported platform contract schema');
  if (!Array.isArray(config.targets) || !config.targets.length) errors.push('Explicit target platforms are required');
  const targets = Array.isArray(config.targets) ? config.targets : [];
  const identities = new Set();
  for (const target of targets) {
    const identity = `${target.platform}/${target.arch}`;
    if (!allowed.has(target.platform) || !/^[a-z0-9_-]+$/.test(target.arch ?? '')) errors.push(`Invalid target: ${identity}`);
    if (identities.has(identity)) errors.push(`Duplicate target: ${identity}`);
    identities.add(identity);
    if (!['electron', 'capacitor', 'existing'].includes(target.host)) errors.push(`Invalid host: ${identity}`);
    if (target.host === 'electron' && ['android', 'ios'].includes(target.platform)) errors.push('Electron cannot be used as the mobile host');
    if (target.host === 'capacitor' && !['android', 'ios'].includes(target.platform)) errors.push('Capacitor target must be mobile');
    if (typeof target.buildCommand !== 'string' || !target.buildCommand.trim()) errors.push(`Missing build command: ${identity}`);
  }
  if (!Array.isArray(config.nativeChecks) || !['launch', 'layout', 'operations'].every(check => config.nativeChecks.includes(check))) {
    errors.push('Required native checks must include launch, layout and operations');
  }
  if (release) {
    let packageVersion;
    try { packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { /* standalone artifact may supply version */ }
    const head = gitRunner('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    const actualCommit = head.status === 0 ? head.stdout.trim() : undefined;
    if (actualCommit) {
      const status = gitRunner('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' });
      if (status.status !== 0 || status.stdout.trim()) errors.push('Release requires a clean committed source tree');
    }
    const expectedVersion = packageVersion ?? config.version;
    const expectedCommit = actualCommit ?? config.commit;
    if (config.version && packageVersion && config.version !== packageVersion) errors.push('Contract version does not match package version');
    if (config.commit && actualCommit && config.commit !== actualCommit) errors.push('Contract commit does not match HEAD');
    if (typeof expectedVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(expectedVersion)) errors.push('Release version must be stable semver');
    if (typeof expectedCommit !== 'string' || !/^[a-f0-9]{40}$/.test(expectedCommit)) errors.push('Release commit must be a full SHA');
    const file = evidencePath ?? config.evidenceFile;
    if (typeof file !== 'string' || !file.trim()) errors.push('Missing evidence path');
    else {
      let evidence;
      try { evidence = JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8')); }
      catch { errors.push('Evidence file cannot be read'); }
      if (evidence) {
        if (evidence.version !== expectedVersion || evidence.commit !== expectedCommit) errors.push('Evidence does not match release version and commit');
        for (const target of targets) {
          const rows = (Array.isArray(evidence.targets) ? evidence.targets : []).filter(row => row.platform === target.platform && row.arch === target.arch);
          if (rows.length !== 1) { errors.push(`Expected one evidence row: ${target.platform}/${target.arch}`); continue; }
          const row = rows[0];
          if (row.host !== target.host || row.build !== 'passed' || row.native !== true) errors.push(`Native build not verified: ${target.platform}/${target.arch}`);
          for (const check of config.nativeChecks ?? []) {
            if (row.checks?.[check] !== 'passed') errors.push(`Missing native check ${check}: ${target.platform}/${target.arch}`);
          }
          if (!Array.isArray(row.files) || !row.files.length) errors.push('Evidence must reference actual files');
          for (const ref of row.files ?? []) {
            if (typeof ref !== 'string' || path.isAbsolute(ref)) {
              errors.push(`Invalid evidence artifact: ${ref}`);
              continue;
            }
            const artifact = path.resolve(root, ref);
            const realRoot = fs.realpathSync(root);
            try {
              const realArtifact = fs.realpathSync(artifact);
              if (!realArtifact.startsWith(realRoot + path.sep) || !fs.statSync(realArtifact).isFile()) {
                errors.push(`Evidence artifact escapes project or is not a file: ${ref}`);
              }
            } catch { errors.push(`Missing evidence artifact: ${ref}`); }
          }
        }
      }
    }
  }
  return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const rootAt = args.indexOf('--project');
  const evidenceAt = args.indexOf('--evidence');
  try {
    const errors = checkPlatforms(path.resolve(rootAt < 0 ? '.' : args[rootAt + 1]), {
      release: args.includes('--release'), evidencePath: evidenceAt < 0 ? undefined : args[evidenceAt + 1]
    });
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log('Declared client platform contract passed; this gate does not replace native testing.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
