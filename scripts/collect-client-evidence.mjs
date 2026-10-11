#!/usr/bin/env node
// 汇总原生测试生成的报告，不生成或推断通过状态。
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? 'artifacts');
const reports = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Evidence cannot contain symlinks');
    if (entry.isDirectory()) walk(file);
    else if (entry.name === 'client-platform-evidence.json' && path.dirname(file) !== root) reports.push(file);
  }
}
walk(root);
if (!reports.length) throw new Error('No native platform reports were produced');
let result;
for (const file of reports) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(report.targets) || !report.targets.length) throw new Error('Empty native report');
  if (!result) result = { version: report.version, commit: report.commit, targets: [] };
  if (report.version !== result.version || report.commit !== result.commit) throw new Error('Mixed native versions or commits');
  // CI 上传保留项目内 artifacts/ 与安装包目录，相对引用以该平台的上传根为基准。
  const uploadRoot = path.dirname(path.dirname(file));
  for (const target of report.targets) {
    if (result.targets.some(row => row.platform === target.platform && row.arch === target.arch)) throw new Error('Duplicate platform report');
    result.targets.push({ ...target, files: (target.files ?? []).map(ref => {
      if (typeof ref !== 'string' || path.isAbsolute(ref)) throw new Error('Invalid evidence reference');
      const actual = path.resolve(uploadRoot, ref);
      if (!actual.startsWith(uploadRoot + path.sep) || !fs.statSync(actual).isFile()) throw new Error('Evidence artifact escapes upload root or is missing');
      return path.relative(process.cwd(), actual);
    }) });
  }
}
fs.writeFileSync(path.join(root, 'client-platform-evidence.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Collected ${result.targets.length} native platform reports`);
