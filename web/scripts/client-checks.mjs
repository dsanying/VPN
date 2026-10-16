// SPDX-License-Identifier: MIT
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
export const checks = [
 {id:'client-ui',phase:'static',command:['scripts/check-client-ui.mjs','--project','.','--source','src','--source','update-popup']},
 {id:'expanded',phase:'static',command:['scripts/check-expanded.mjs','--project','.','--source','src','--source','update-popup']},
 {id:'query-contract',phase:'static',command:['scripts/check-query-contract.mjs','.']},
 {id:'tokens',phase:'static',command:['scripts/generate-client-tokens.mjs','--check']},
 {id:'translations',phase:'static',command:['scripts/check-client-i18n.mjs']},
 {id:'client-ui-negative-fixtures',phase:'static',command:['--test','scripts/client-ui.test.mjs','scripts/check-expanded.test.mjs','scripts/check-client-time.test.mjs']},
 {id:'unit',phase:'static',command:['scripts/run-unit-tests.mjs']},
 {id:'time',phase:'static',command:['scripts/check-client-time.mjs','--project','.','--source','src','--source','update-popup']},
 {id:'dependency-builds',phase:'static',command:['scripts/check-ignored-builds.mjs']},
 {id:'runtime-patches',phase:'static',command:['scripts/check-runtime-patches.mjs']},
 {id:'logviewer',phase:'static',command:['--test','scripts/logviewer-runtime.test.mjs']},
 {id:'types',phase:'static',command:['node_modules/typescript/bin/tsc','-b','--pretty','false']},
 {id:'eslint',phase:'static',command:['node_modules/eslint/bin/eslint.js','src','update-popup','--max-warnings','0']},
 {id:'production-build',phase:'build',command:['node_modules/vite/bin/vite.js','build']},
 {id:'ui-build',phase:'ui',command:['scripts/run-runtime.mjs','build-ui']},
 {id:'browser-contracts',phase:'ui',command:['scripts/run-runtime.mjs','ui']},
];
export function verifyManifest(manifest) {
 const expected=checks.map(check=>({...check,command:['node',...check.command],cwd:'web'}));
 if(manifest.schemaVersion!==2 || JSON.stringify(manifest.checks)!==JSON.stringify(expected)) {
  throw new Error('Client check manifest differs from executable checks');
 }
}
export function selectChecks(args, changedPaths) {
 let phase;
 for(let index=0;index<args.length;index++) {
  if(args[index]==='--phase') {
   if(phase) throw new Error('Duplicate phase');
   phase=args[++index];
   if(!['static','build','ui'].includes(phase)) throw new Error('Expected static, build or ui');
  } else if(!['--affected','--staged'].includes(args[index])) throw new Error(`Unknown check argument: ${args[index]}`);
 }
 if(phase)return checks.filter(check=>check.phase===phase);
 if(!args.length)return checks;
 const fast=checks.filter(check=>check.phase==='static');
 // Unknown baseline and shared contracts affect every quick check.
 if(!changedPaths || changedPaths.some(file=>/^web\/(scripts|package|pnpm|tsconfig|src\/(components\/client|design|config|i18n))/.test(file)))return fast;
 const ui=changedPaths.some(file=>/^web\/(src|update-popup|tests)/.test(file));
 const dependencies=changedPaths.some(file=>/lock|package|patches/.test(file));
 if(dependencies)return fast;
 return ui?fast.filter(check=>['client-ui','expanded','query-contract','translations','unit','time','types','eslint'].includes(check.id)):[];
}
export function runChecks(selected, execute) {
 if(!selected.length) throw new Error('No client checks selected');
 for(const check of selected) {
  console.log(`[client:${check.id}] START`);
  const status=execute(check.command);
  if(status!==0) throw new Error(`${check.id} failed (${status ?? 'no exit status'})`);
  console.log(`[client:${check.id}] PASS`);
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 try {
  const root=fileURLToPath(new URL('../',import.meta.url));
  verifyManifest(JSON.parse(readFileSync(new URL('../../docs/规范/manifest.json',import.meta.url),'utf8')));
  const args=process.argv.slice(2);
  let changed;
  if(args.some(arg=>arg==='--affected'||arg==='--staged')) {
   const repository=spawnSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'});
   if(repository.status===0){
    const cwd=repository.stdout.trim();
    const diff=spawnSync('git',['diff','--name-only',...(args.includes('--staged')?['--cached']:['HEAD'])],{cwd,encoding:'utf8'});
    const untracked=args.includes('--staged')?{status:0,stdout:''}:spawnSync('git',['ls-files','--others','--exclude-standard'],{cwd,encoding:'utf8'});
    if(diff.status===0&&untracked.status===0)changed=(diff.stdout+'\n'+untracked.stdout).split('\n').filter(Boolean);
   }
  }
  const selected=selectChecks(args,changed);
  if(!selected.length)console.log('[client:affected] No changed client inputs; full delivery checks remain required.');
  else runChecks(selected,args=>spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:process.env}).status);
 } catch(error) {console.error(error.message);process.exitCode=1;}
}
