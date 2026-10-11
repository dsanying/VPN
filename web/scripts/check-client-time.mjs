import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const timeFields = new Set(['timestamp', 'createdAt', 'updatedAt', 'lastUpdated', 'checkedAt', 'expiresAt']);
export function checkTimeSource(ts, text, filename = 'example.tsx') {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings = [];
  const report = (node, message) => findings.push(`${filename}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);
  const rawTime = node => node && (
    ts.isPropertyAccessExpression(node) && timeFields.has(node.name.text) ||
    ts.isIdentifier(node) && timeFields.has(node.text) ||
    ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'toISOString'
  );
  const visit = node => {
    if (ts.isIdentifier(node) && node.text === 'BUSINESS_TIME_ZONE') report(node, '客户端禁止固定业务展示时区，使用 getDeviceTimeZone');
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['tz', 'setDefault'].includes(node.expression.name.text)) {
      if (node.arguments.some(arg => ts.isStringLiteralLike(arg) && /^(?:[A-Za-z_]+\/|UTC$)/.test(arg.text))) report(node, '时间展示不能硬编码时区，已知来源时区通过 parseServerTime 的显式参数解析');
    }
    if (ts.isJsxExpression(node) && rawTime(node.expression)) report(node, '可见时间必须经过统一 formatDateTime 等展示函数，禁止原样时间或 ISO 序列化值');
    if (ts.isObjectLiteralExpression(node)) {
      const dataIndex = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'dataIndex');
      if (dataIndex && ts.isStringLiteralLike(dataIndex.initializer) && timeFields.has(dataIndex.initializer.text) && !node.properties.some(p => p.name?.getText(source) === 'render')) report(node, '时间列必须显式使用统一 formatter，不直接显示原字段');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
function main() {
  const args = process.argv.slice(2); let project = process.cwd(); const roots = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; const value = args[++i];
    if (!value || !['--project', '--source'].includes(flag)) throw new Error('用法：--project 项目目录 --source UI/时间工具目录（可重复）');
    if (flag === '--project') project = path.resolve(value); else roots.push(value);
  }
  if (!roots.length) throw new Error('必须登记 UI 和统一时间工具范围');
  const ts = createRequire(path.join(project, 'package.json'))('typescript');
  const files = new Set();
  function collect(directory) {
    if (!fs.statSync(directory).isDirectory()) throw new Error('来源须为目录');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('来源禁止符号链接');
      if (entry.isDirectory()) collect(target); else if (/\.[jt]sx?$/.test(entry.name)) files.add(target);
    }
  }
  for (const root of roots) {
    const directory = path.resolve(project, root);
    if (!directory.startsWith(project + path.sep)) throw new Error('来源须在项目内');
    collect(directory);
  }
  if (!files.size) throw new Error('检查范围为空');
  const findings = [...files].flatMap(file => checkTimeSource(ts, fs.readFileSync(file, 'utf8'), path.relative(project, file)));
  if (findings.length) throw new Error(findings.join('\n'));
  console.log(`客户端时间检查通过：${files.size} 文件；格式与时区转换仍须专项测试。`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
