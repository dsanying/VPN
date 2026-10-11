#!/usr/bin/env node
// 发布 tag 必须对应当前已验证的签名提交。公开 tag 不允许强制覆盖。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (process.argv.some(arg => ['-h', '--help'].includes(arg))) {
  console.log('Usage: node scripts/push-release.js [--yes]\nRequires a clean signed dsanying commit and current native release evidence. Existing tags are immutable.');
  process.exit(0);
}
try {
  if (process.argv.some(arg => ['-u', '--update', '-f', '--force'].includes(arg))) {
    throw new Error('发布 tag 不允许强制覆盖，请使用新版本号。');
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('正式发布需要稳定版本号。');
  if (run(['status', '--porcelain'])) throw new Error('存在未提交内容，不能给旧提交发布新产物。');
  if (run(['show', '-s', '--format=%an', 'HEAD']) !== 'dsanying') throw new Error('发布提交作者必须是 dsanying。');
  run(['verify-commit', 'HEAD']);
  execFileSync(process.execPath, [path.join(__dirname, 'check-client-platforms.mjs'), '--project', root, '--release'], { cwd: root, stdio: 'inherit' });
  const tag = `v${version}`;
  if (run(['tag', '--list', tag]) || run(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])) throw new Error('版本 tag 已存在，请提升版本号。');
  execFileSync('git', ['tag', '-s', tag, '-m', `Release ${version}`], { cwd: root, stdio: 'inherit' });
  execFileSync('git', ['push', 'origin', tag], { cwd: root, stdio: 'inherit' });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
