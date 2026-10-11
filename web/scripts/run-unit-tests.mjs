// SPDX-License-Identifier: MIT
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export function discoverUnitTests(directories=[path.join(root,'scripts'),path.join(root,'src')]) {
 return directories.flatMap(directory=>readdirSync(directory,{recursive:true,withFileTypes:true})
  .filter(entry=>entry.isFile()&&/\.unit\.test\.(mjs|tsx?)$/.test(entry.name))
  .map(entry=>path.join(entry.parentPath,entry.name))).sort();
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const files=discoverUnitTests();
 if(!files.length) throw new Error('No client unit tests discovered');
 process.exitCode=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'}).status??1;
}
