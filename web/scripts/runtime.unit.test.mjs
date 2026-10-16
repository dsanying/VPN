// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('./run-runtime.mjs',import.meta.url));
function invoke(t,task,args=[],environment={}) {
 const root=mkdtempSync(join(tmpdir(),'shadow-cli-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const reporter="console.log(JSON.stringify({arguments:process.argv.slice(2),ui:process.env.FRONTEND_UI_TEST,full:process.env.FRONTEND_UI_FULL}));process.exit(Number(process.env.CHILD_RESULT??0));";
 for(const relative of ['vite/bin/vite.js','@playwright/test/cli.js']) {
  const location=join(root,'node_modules',relative);
  mkdirSync(dirname(location),{recursive:true});writeFileSync(location,reporter);
 }
 return spawnSync(process.execPath,[entry,task,...args],{cwd:root,encoding:'utf8',env:{...process.env,...environment}});
}
test('build uses UI mode and preserves literal arguments',t=>{
 const result=invoke(t,'build-ui',['--base','/client path/'],{FRONTEND_UI_TEST:'0'});
 assert.equal(result.status,0);
 assert.deepEqual(JSON.parse(result.stdout),{arguments:['build','--outDir','.playwright/app','--base','/client path/'],ui:'1'});
});
test('browser selection and full-matrix environment reach Playwright',t=>{
 assert.deepEqual(JSON.parse(invoke(t,'ui').stdout).arguments,['test']);
 const full=JSON.parse(invoke(t,'ui-full',['--project=firefox']).stdout);
 assert.equal(full.full,'1');assert.deepEqual(full.arguments,['test','--project=firefox']);
});
test('failure status is propagated and unsupported commands fail closed',t=>{
 assert.equal(invoke(t,'ui',[],{CHILD_RESULT:'9'}).status,9);
 assert.notEqual(invoke(t,'invalid').status,0);
});
