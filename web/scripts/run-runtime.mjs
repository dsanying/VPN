// SPDX-License-Identifier: MIT
import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {acquireRuntimeLock} from './runtime-lock.mjs';
const [task,...extra]=process.argv.slice(2);
const targets={
 'build-ui':['node_modules/vite/bin/vite.js','build','--outDir','.playwright/app'],
 ui:['node_modules/@playwright/test/cli.js','test','--project=chromium'],
 'ui-full':['node_modules/@playwright/test/cli.js','test'],
};
if(!Object.hasOwn(targets,task)) throw new Error(`Unsupported client task: ${task}`);
const release = acquireRuntimeLock(resolve('.playwright/runtime.lock'));
const environment={...process.env};
if(task==='build-ui') environment.FRONTEND_UI_TEST='1';
if(task==='ui-full') environment.FRONTEND_UI_FULL='1';
const processHandle=spawn(process.execPath,[...targets[task],...extra],{stdio:'inherit',env:environment,detached:process.platform!=='win32'});
processHandle.once('error',error=>{release();process.stderr.write(error.message+'\n');process.exitCode=1;});
processHandle.once('exit',code=>{release();process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
 if(!processHandle.pid) return;
 if(process.platform==='win32') spawnSync('taskkill',['/PID',String(processHandle.pid),'/T','/F'],{stdio:'ignore'});
 else { try { process.kill(-processHandle.pid,signal); } catch(error) { if(error.code!=='ESRCH') throw error; } }
});
