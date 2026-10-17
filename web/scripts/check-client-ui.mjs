#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Independently maintained AST gate. Requires the target project's TypeScript compiler API.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const forbidden = new Set(['Collapse', 'Accordion', 'Disclosure', 'SecondarySection', 'details']);
// Hooks whose callbacks must never emit notifications: they are render-phase or
// scheduled work, not user action handlers. useCallback is intentionally absent
// because a memoized click handler is still a user handler.
const passiveHooks = new Set(['useEffect', 'useLayoutEffect', 'useMemo', 'useInsertionEffect']);
const modalStatics = new Set(['confirm', 'info', 'success', 'error', 'warning', 'useModal']);
const appStatics = new Set(['useApp', 'useMessage', 'useNotification']);
export function inspectClientUi(ts, filename, source, options = {}) {
 const feedbackAllowed = options.feedbackAllowed === true;
 const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(filename) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(filename) ? ts.ScriptKind.TS : /\.jsx$/.test(filename) ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
 const failures = [];
 const aliases = new Set(forbidden);
 const antdStatics = new Set(); // message/notification/Modal/App/Skeleton bound from antd
 const issue = (node, rule, message) => {
  const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  failures.push({ file: filename, line: line + 1, column: character + 1, rule, message });
 };
 for (const diagnostic of tree.parseDiagnostics) issue(tree, 'SYNTAX', ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
 for (const statement of tree.statements) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
  const bindings = statement.importClause?.namedBindings;
  const isAntd = statement.moduleSpecifier.text === 'antd';
  if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
   const original = (item.propertyName ?? item.name).text;
   if (forbidden.has(original)) aliases.add(item.name.text);
   if (isAntd && ['message', 'notification', 'Modal', 'App', 'Skeleton'].includes(original)) antdStatics.add(item.name.text);
  }
  if (isAntd && bindings && ts.isNamespaceImport(bindings)) antdStatics.add(bindings.name.text);
 }
 const appBound = new Map(); // identifiers destructured from App.useApp(): modal/message/notification
 const collectAppBound = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
   const expr = node.initializer.expression;
   if (appStatics.has(expr.getText(tree).split('.').pop())) for (const element of node.name.elements) {
    if (ts.isIdentifier(element.name)) appBound.set(element.name.text, (element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName : element.name).text);
   }
  }
  ts.forEachChild(node, collectAppBound);
 };
 collectAppBound(tree);
 const componentName = (node) => node.getText(tree).split('.').pop();
 const rootName = (node) => node.getText(tree).split('.')[0];
 // Raw antd message/notification usage is banned outside the shared feedback entry;
 // the shared notify* helpers themselves are legal in user action handlers.
 const isNotificationCall = (node) => {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  const text = expr.getText(tree);
  const root = ts.isPropertyAccessExpression(expr) ? rootName(expr) : undefined;
  if (!root || !antdStatics.has(root)) return false;
  if (root === 'message' || root === 'notification') return true;
  // Namespace import: antd.message.x / antd.notification.x
  return /\.(message|notification)\./.test(text);
 };
 const isNotifyHelper = (callee) => /^notify[A-Z]/.test(callee) || callee === 'notify';
 const isHookCallback = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
   if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && passiveHooks.has(parent.expression.text)) return true;
   if (ts.isSourceFile(parent)) return false;
  }
  return false;
 };
 const insideCatch = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (ts.isCatchClause(parent)) return true;
  return false;
 };
 const visit = (node) => {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
   const tag = componentName(node.tagName);
   const rootTag = rootName(node.tagName);
   const attrs = new Map();
   for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute)) attrs.set(attribute.name.getText(tree), attribute);
   if (aliases.has(tag)) issue(node, 'CLIENT-EXPANDED', 'Client content must remain expanded.');
   if (rootTag === 'Skeleton' || (tag === 'Skeleton' && antdStatics.has(rootTag)))
    issue(node, 'CLIENT-LOADING', 'Loading uses the Spin-based shared states; skeleton screens and shimmer blocks are forbidden.');
   if (/^(Radio\.Group|RadioGroup)$/.test(node.tagName.getText(tree)) && attrs.has('buttonStyle'))
    issue(node, 'CLIENT-COMPONENTS', 'Value button groups use the default outlined Radio.Group form; buttonStyle variants are forbidden.');
   if (tag === 'Switch' && (attrs.has('checkedChildren') || attrs.has('unCheckedChildren')))
    issue(node, 'CLIENT-COMPONENTS', 'Switches use the default bare form; do not embed text via checkedChildren/unCheckedChildren.');
   if (attrs.has('danger') && (attrs.has('type') || !attrs.has('variant')))
    issue(node, 'CLIENT-ACTIONS', 'Danger actions require color="danger" with an explicit variant and no type; the boolean danger API is forbidden.');
   if (attrs.has('rowSelection') && /^(Table|DataTable|ClientTable)$/.test(tag))
    issue(node, 'CLIENT-TABLE', 'Tables do not provide row selection or front-end batch writes; operations stay per-row.');
   if (attrs.has('placeholder')) issue(attrs.get('placeholder'), 'CLIENT-TOOLTIP', 'Place explanations beside the smallest field label in a question tooltip.');
   if (attrs.has('extra') && /(?:^|\.)Form\.Item$/.test(node.tagName.getText(tree)))
    issue(attrs.get('extra'), 'CLIENT-TOOLTIP', 'Form.Item extra is permanent explanatory text; use its label tooltip.');
  }
  if (ts.isCallExpression(node)) {
   const expr = node.expression;
   if (componentName(expr) === 'createElement') {
    const component = node.arguments[0];
    if (component && aliases.has(ts.isStringLiteral(component) ? component.text : componentName(component))) issue(node, 'CLIENT-EXPANDED', 'Client content must remain expanded.');
   }
   const callee = expr.getText(tree);
   const calleeRoot = rootName(expr);
   const calleeLeaf = componentName(expr);
   const boundSource = appBound.get(calleeRoot);
   const isModalCall =
    (calleeRoot === 'Modal' && modalStatics.has(calleeLeaf)) ||
    (boundSource === 'modal' && modalStatics.has(calleeLeaf)) ||
    (antdStatics.has(calleeRoot) && /\.Modal\.(confirm|info|success|error|warning|useModal)$/.test(callee));
   if (isModalCall)
    issue(node, 'CLIENT-CONFIRM', 'Dangerous confirmations use the anchored shared Popconfirm only; Modal static dialogs are forbidden in business code.');
   if (!feedbackAllowed && boundSource && (boundSource === 'message' || boundSource === 'notification'))
    issue(node, 'CLIENT-FEEDBACK', 'Notifications come only from the shared feedback entry.');
   if (!feedbackAllowed && antdStatics.has(calleeRoot) && appStatics.has(calleeLeaf))
    issue(node, 'CLIENT-FEEDBACK', 'Notifications come only from the shared feedback entry; do not consume antd App/message hooks in business code.');
   if (!feedbackAllowed && isNotificationCall(node))
    issue(node, 'CLIENT-FEEDBACK', 'Notifications come only from the shared feedback entry.');
   if (isNotificationCall(node) || isNotifyHelper(callee)) {
    if (isHookCallback(node)) issue(node, 'CLIENT-FEEDBACK', 'Notifications belong to user action handlers, never render-phase or scheduled hooks.');
    if (insideCatch(node) && /Success/.test(callee)) issue(node, 'CLIENT-FEEDBACK', 'A catch branch must not report success.');
   }
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
 let feedbackModules = [];
 try {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'design-system.project.json'), 'utf8'));
  if (Array.isArray(config.feedbackModules)) feedbackModules = config.feedbackModules.map((entry) => path.resolve(root, String(entry)));
 } catch { /* project config is optional */ }
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
 const failures = [...files].sort().flatMap(file => {
  const absolute = path.resolve(root, file);
  const allowed = feedbackModules.some((entry) => absolute === entry || absolute.startsWith(entry + path.sep));
  return inspectClientUi(ts, path.relative(root, file), fs.readFileSync(file, 'utf8'), { feedbackAllowed: allowed });
 });
 return { files: files.size, failures };
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
