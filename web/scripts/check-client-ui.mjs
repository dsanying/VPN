#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Independently maintained AST gate. Requires the target project's TypeScript compiler API.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const forbidden = new Set(['Collapse', 'Accordion', 'Disclosure', 'SecondarySection', 'details']);
export function inspectClientUi(ts, filename, source) {
 const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(filename) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(filename) ? ts.ScriptKind.TS : /\.jsx$/.test(filename) ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
 const failures = [];
 const aliases = new Set(forbidden);
 const issue = (node, rule, message) => {
  const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  failures.push({ file: filename, line: line + 1, column: character + 1, rule, message });
 };
 for (const diagnostic of tree.parseDiagnostics) issue(tree, 'SYNTAX', ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
 for (const statement of tree.statements) {
  if (!ts.isImportDeclaration(statement)) continue;
  const bindings = statement.importClause?.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
   if (forbidden.has((item.propertyName ?? item.name).text)) aliases.add(item.name.text);
  }
 }
 const componentName = (node) => node.getText(tree).split('.').pop();
 const visit = (node) => {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
   const tag = componentName(node.tagName);
   if (aliases.has(tag)) issue(node, 'CLIENT-EXPANDED', 'Client content must remain expanded.');
   for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute)) {
    const name = attribute.name.getText(tree);
    if (name === 'placeholder') issue(attribute, 'CLIENT-TOOLTIP', 'Place explanations beside the smallest field label in a question tooltip.');
    if (name === 'extra' && /(?:^|\.)Form\.Item$/.test(node.tagName.getText(tree)))
     issue(attribute, 'CLIENT-TOOLTIP', 'Form.Item extra is permanent explanatory text; use its label tooltip.');
   }
  }
  if (ts.isCallExpression(node) && componentName(node.expression) === 'createElement') {
   const component = node.arguments[0];
   if (component && aliases.has(ts.isStringLiteral(component) ? component.text : componentName(component))) issue(node, 'CLIENT-EXPANDED', 'Client content must remain expanded.');
  }
  // Also covers object props and JSX spread props; explanatory placeholders cannot bypass JSX checks.
  if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === 'placeholder')
   issue(node, 'CLIENT-TOOLTIP', 'Do not put explanatory placeholders in control props.');
  ts.forEachChild(node, visit);
 };
 visit(tree);
 return failures;
}
export function checkProject(project, sources) {
 const root = fs.realpathSync(project);
 if (!sources.length) throw new Error('Register every business UI source with --source.');
 const ts = createRequire(path.join(root, 'package.json'))('typescript');
 if (typeof ts.createSourceFile !== 'function') throw new Error('Target dependency must provide the TypeScript compiler API.');
 const files = new Set();
 const contained = (candidate) => {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('UI source escapes project.');
 };
 const walk = (candidate) => {
  contained(candidate);
  contained(fs.realpathSync(candidate));
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error('UI source symlinks require explicit ownership resolution.');
  if (stat.isDirectory()) for (const entry of fs.readdirSync(candidate)) {
   if (['node_modules', '.git', 'dist', 'build'].includes(entry)) continue;
   walk(path.join(candidate, entry));
  } else if (stat.isFile() && /\.[cm]?[jt]sx?$/.test(candidate) && !/\.d\.ts$/.test(candidate)) files.add(candidate);
 };
 sources.forEach(source => walk(path.resolve(root, source)));
 if (!files.size) throw new Error('No UI sources found; an empty scan is not a passing gate.');
 return { files: files.size, failures: [...files].sort().flatMap(file => inspectClientUi(ts, path.relative(root, file), fs.readFileSync(file, 'utf8'))) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
 try {
  let project; const sources = [];
  for (let i = 2; i < process.argv.length; i++) {
   const flag = process.argv[i], value = process.argv[++i];
   if (!value || !['--project', '--source'].includes(flag)) throw new Error('Usage: --project PATH --source PATH [--source PATH]');
   if (flag === '--project') project = value; else sources.push(value);
  }
  if (!project) throw new Error('--project is required.');
  const result = checkProject(project, sources);
  for (const failure of result.failures) console.error(`${failure.file}:${failure.line}:${failure.column} ${failure.rule}: ${failure.message}`);
  if (result.failures.length) process.exitCode = 1;
  else console.log(`Client UI AST gate passed: ${result.files} files. Verify explanatory prose and actual host behavior separately.`);
 } catch (error) { console.error(error.message); process.exitCode = 1; }
}
