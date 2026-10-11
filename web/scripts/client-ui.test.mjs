// SPDX-License-Identifier: MIT
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectClientUi, checkProject } from './check-client-ui.mjs';
const require = createRequire(path.join(process.cwd(), 'package.json'));
const ts = require('typescript');
const check = source => inspectClientUi(ts, 'View.tsx', source);
test('visible status, errors, headings and label tooltips remain allowed', () => {
 assert.deepEqual(check('const View=()=> <Card title="设置" extra={<Button>导出</Button>}><Form.Item label="端口" tooltip="本地代理监听端口" help={error} validateStatus="error"><Input/></Form.Item><HelpTip text={explanation}/><p>{status}</p></Card>;'), []);
});
test('aliased, namespace, native and createElement folds fail', () => {
 for (const source of ['import {Collapse as Fold} from "antd"; const View=()=> <Fold/>;', 'const View=()=> <Ant.Collapse/>;', 'const View=()=> <details><summary>高级</summary></details>;', 'const View=()=> React.createElement("details", null);']) assert.ok(check(source).some(item => item.rule==='CLIENT-EXPANDED'), source);
});
test('placeholders, spread props and permanent field explanations fail', () => {
 for (const source of ['const View=()=> <Input placeholder="example"/>;', 'const props={placeholder:"example"};const View=()=> <Input {...props}/>;', 'const View=()=> <Form.Item extra="每行一个值"><Input/></Form.Item>;']) assert.ok(check(source).some(item => item.rule==='CLIENT-TOOLTIP'), source);
});
test('empty sources and escaping sources never pass', () => {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'client-gate-'));
 try {
  assert.throws(()=>checkProject(directory,[]), /Register/);
  fs.writeFileSync(path.join(directory,'package.json'),'{}');
  fs.symlinkSync(path.join(process.cwd(),'node_modules'),path.join(directory,'node_modules'),'dir');
  fs.mkdirSync(path.join(directory,'ui'));
  assert.throws(()=>checkProject(directory,['ui']), /No UI/);
  assert.throws(()=>checkProject(directory,['../outside']), /escapes/);
  fs.writeFileSync(path.join(directory,'ui','View.tsx'),'const View=()=> <Input/>;');
  assert.deepEqual(checkProject(directory,['ui']),{files:1,failures:[]});
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('ordinary TypeScript generics parse without JSX false positives', () => { assert.deepEqual(inspectClientUi(ts, 'utility.ts', 'export const clone = <T>(value: T): T => value;'), []); });

test('explicit paths below an outside symlink cannot bypass ownership boundaries', () => {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'client-gate-root-'));
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'client-gate-outside-'));
 try {
  fs.writeFileSync(path.join(directory,'package.json'),'{}');
  fs.symlinkSync(path.join(process.cwd(),'node_modules'),path.join(directory,'node_modules'),'dir');
  fs.writeFileSync(path.join(outside,'View.tsx'),'const View=()=> <Input/>;');
  fs.symlinkSync(outside,path.join(directory,'linked'),'dir');
  assert.throws(()=>checkProject(directory,['linked/View.tsx']), /escapes/);
 } finally { fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true}); }
});
