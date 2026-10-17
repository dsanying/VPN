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
test('skeleton screens fail in every import form', () => {
 for (const source of ['import {Skeleton} from "antd"; const View=()=> <Skeleton/>;', 'import {Skeleton} from "antd"; const View=()=> <Skeleton.Button/>;', 'import * as antd from "antd"; const View=()=> <antd.Skeleton/>;']) assert.ok(check(source).some(item => item.rule==='CLIENT-LOADING'), source);
 assert.deepEqual(check('import {Spin} from "antd"; const View=()=> <Spin/>;'), []);
});
test('switch forms follow the three-layer contract', () => {
 assert.ok(check('import {Radio} from "antd"; const View=()=> <Radio.Group buttonStyle="solid"/>;').some(item => item.rule==='CLIENT-COMPONENTS'));
 assert.ok(check('import {Switch} from "antd"; const View=()=> <Switch checkedChildren="开" unCheckedChildren="关"/>;').some(item => item.rule==='CLIENT-COMPONENTS'));
 assert.deepEqual(check('import {Radio,Switch,Segmented,Tabs} from "antd"; const View=()=> <div><Radio.Group optionType="button"/><Switch/><Segmented/><Tabs/></div>;'), []);
});
test('danger actions require explicit variant and no type', () => {
 for (const source of ['import {Button} from "antd"; const View=()=> <Button danger>删除</Button>;', 'import {Button} from "antd"; const View=()=> <Button danger type="primary">删除</Button>;']) assert.ok(check(source).some(item => item.rule==='CLIENT-ACTIONS'), source);
 assert.deepEqual(check('import {Button} from "antd"; const View=()=> <Button color="danger" variant="outlined">删除</Button>;'), []);
});
test('table row selection and batch writes are rejected', () => {
 assert.ok(check('import {Table} from "antd"; const View=()=> <Table rowSelection={selection}/>;').some(item => item.rule==='CLIENT-TABLE'));
});
test('static modal dialogs and App.useApp modal are rejected', () => {
 for (const source of [
  'import {Modal} from "antd"; const f=()=> Modal.confirm({title:"x"});',
  'import {Modal} from "antd"; const f=()=> Modal.useModal();',
  'import * as antd from "antd"; const f=()=> antd.Modal.warning({title:"x"});',
  'import {App} from "antd"; const f=()=> {const {modal}=App.useApp();modal.confirm({title:"x"});};',
 ]) assert.ok(check(source).some(item => item.rule==='CLIENT-CONFIRM'), source);
 assert.deepEqual(check('import {Modal,Popconfirm} from "antd"; const View=()=> <div><Modal open={open}/><Popconfirm title="确定"><Button/></Popconfirm></div>;'), []);
});
test('notifications outside user handlers and outside the shared entry are rejected', () => {
 for (const source of [
  'import {message} from "antd"; const f=()=> message.success("x");',
  'import * as antd from "antd"; const f=()=> antd.notification.open({});',
  'import {App} from "antd"; const f=()=> {const {message}=App.useApp();message.error("x");};',
  'import {App} from "antd"; const f=()=> App.useApp();',
  'const f=()=> {useEffect(()=> {notifyActionSuccess();},[]);};',
  'const f=()=> {useMemo(()=> notifyWarning("x"),[]);};',
  'const f=async()=> {try{await save()}catch(e){notifyActionSuccess();}};',
 ]) assert.ok(check(source).some(item => item.rule==='CLIENT-FEEDBACK'), source);
 assert.deepEqual(check('const onSave=async()=> {try{await save();notifyActionSuccess()}catch(e){notifyActionFailed(e)}};'), []);
 assert.deepEqual(check('const onSave=()=> useCallback(()=> {notifyActionSuccess()},[]);'), []);
 const shared = check('import {message} from "antd"; const f=()=> message.success("x");');
 assert.ok(shared.length > 0);
 assert.deepEqual(inspectClientUi(ts, 'feedback.ts', 'import {message} from "antd"; export const f=()=> message.success("x");', {feedbackAllowed: true}), []);
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
