// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {auditAntRuntime} from './check-runtime-patches.mjs';

function graph(t) {
 const root=mkdtempSync(join(tmpdir(),'shadow-dependency-graph-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const ant=join(root,'node_modules/antd');
 const drawer=join(ant,'node_modules/@rc-component/drawer');
 const util=join(drawer,'node_modules/@rc-component/util');
 const picker=join(ant,'node_modules/@rc-component/picker');
 const paths={drawer,util,picker};
 const targets={drawer:['es/Drawer.js','lib/Drawer.js'],util:['es/Dom/focus.js','lib/Dom/focus.js'],picker:['es/PickerTrigger/index.js','lib/PickerTrigger/index.js']};
 const put=(file,value)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,value);};
 put(join(root,'package.json'),'{}');put(join(ant,'package.json'),'{"name":"antd"}');
 const contract={};
 for(const [name,directory] of Object.entries(paths)) {
  put(join(directory,'package.json'),JSON.stringify({version:'1.0.0',...(name==='picker'?{exports:'./lib/index.js'}:{})}));
  contract[name]={version:'1.0.0',files:{}};
  for(const relative of targets[name]) {
   const content=`verified ${name}: ${relative}`;
   put(join(directory,relative),content);
   contract[name].files[relative]=createHash('sha256').update(content).digest('hex');
  }
 }
 put(join(picker,'lib/index.js'),'export {};');
 return {root,paths,contract,put};
}
test('valid nested resolution passes, exported picker entry is supported',t=>{
 const fixture=graph(t);assert.deepEqual(auditAntRuntime(fixture.root,fixture.contract),[]);
});
test('unused top-level dependency cannot hide the version loaded by Drawer',t=>{
 const {root,paths,contract,put}=graph(t);
 put(join(root,'node_modules/@rc-component/util/package.json'),'{"version":"1.0.0"}');
 put(join(paths.util,'package.json'),'{"version":"0.9.0"}');
 assert.match(auditAntRuntime(root,contract).join('\n'),/util 0.9.0/);
});
for(const [name,relative] of [['util','lib/Dom/focus.js'],['drawer','es/Drawer.js'],['picker','lib/PickerTrigger/index.js']]) {
 test(`${name} rejects changed installed bytes in ${relative}`,t=>{
  const {root,paths,contract,put}=graph(t);put(join(paths[name],relative),'unexpected');
  assert.match(auditAntRuntime(root,contract).join('\n'),new RegExp(name+'.*'+relative.replaceAll('.','\\.')));
 });
}
test('missing actual dependency manifest fails closed',t=>{
 const {root,paths,contract}=graph(t);rmSync(join(paths.util,'package.json'));
 assert.match(auditAntRuntime(root,contract).join('\n'),/依赖不完整/);
});
