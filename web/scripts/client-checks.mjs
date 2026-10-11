// SPDX-License-Identifier: MIT
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
export const checks = [
 {id:'client-ui',phase:'static',command:['scripts/check-client-ui.mjs','--project','.','--source','src','--source','update-popup']},
 {id:'tokens',phase:'static',command:['scripts/generate-client-tokens.mjs','--check']},
 {id:'translations',phase:'static',command:['scripts/check-client-i18n.mjs']},
 {id:'client-ui-negative-fixtures',phase:'static',command:['--test','scripts/client-ui.test.mjs','scripts/check-expanded.test.mjs','scripts/check-client-time.test.mjs']},
 {id:'unit',phase:'static',command:['scripts/run-unit-tests.mjs']},
 {id:'time',phase:'static',command:['scripts/check-client-time.mjs','--project','.','--source','src/pages','--source','src/components/vpn','--source','src/utils']},
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
export function selectChecks(args) {
 let phase;
 for(let index=0;index<args.length;index++) {
  if(args[index]==='--phase') {
   if(phase) throw new Error('Duplicate phase');
   phase=args[++index];
   if(!['static','build','ui'].includes(phase)) throw new Error('Expected static, build or ui');
  } else if(!['--affected','--staged'].includes(args[index])) throw new Error(`Unknown check argument: ${args[index]}`);
 }
 // The client has one shared foundation. Affected/staged runs safely retain all static checks.
 return checks.filter(check=>phase ? check.phase===phase : args.length ? check.phase==='static' : true);
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
  runChecks(selectChecks(process.argv.slice(2)),args=>spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:process.env}).status);
 } catch(error) {console.error(error.message);process.exitCode=1;}
}
