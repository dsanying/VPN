import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export function checkSource(ts, text, filename = 'example.tsx') {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const forbidden = new Set(['Collapse', 'Accordion', 'AccordionSummary', 'Disclosure', 'SecondarySection']);
  const aliases = new Set(forbidden);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause?.name && forbidden.has(clause.name.text)) aliases.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if (forbidden.has((item.propertyName ?? item.name).text)) aliases.add(item.name.text);
      }
    }
  }
  const findings = [];
  const visit = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const tail = tag.split('.').at(-1);
      if (aliases.has(tag) || forbidden.has(tail) || ['details', 'summary'].includes(tag)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        findings.push(`${filename}:${line}: 客户端内容必须直接显示，禁止 ${tag}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function main() {
  const argv = process.argv.slice(2);
  let project = process.cwd(); const roots = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]; const value = argv[++i];
    if (!value || !['--project', '--source'].includes(flag)) throw new Error('用法：--project 项目目录 --source 业务目录（可重复）');
    if (flag === '--project') project = path.resolve(value); else roots.push(value);
  }
  if (!roots.length) throw new Error('必须登记所有业务 UI 来源，禁止空范围通过');
  const ts = createRequire(path.join(project, 'package.json'))('typescript');
  const files = new Set();
  function collect(directory) {
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) throw new Error(`业务来源不是目录：${directory}`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`业务来源禁止用符号链接跳过：${filename}`);
      if (entry.isDirectory()) collect(filename);
      else if (/\.[jt]sx?$/.test(entry.name)) files.add(filename);
    }
  }
  for (const root of roots) {
    const directory = path.resolve(project, root);
    if (!directory.startsWith(project + path.sep)) throw new Error('业务来源须在项目内');
    collect(directory);
  }
  if (!files.size) throw new Error('没有找到业务 UI 源码');
  const findings = [...files].flatMap(filename => checkSource(ts, fs.readFileSync(filename, 'utf8'), path.relative(project, filename)));
  if (findings.length) throw new Error(findings.join('\n'));
  console.log(`客户端常显检查通过：${files.size} 个文件；仍须验证真实界面。`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
