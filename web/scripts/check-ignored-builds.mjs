// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function parseAllowBuilds(text) {
 const result=new Map();let active=false;let depth;
 for(const line of text.split(/\r?\n/)) {
  if(line==='allowBuilds:') {active=true;continue;}
  if(!active||!line.trim()||line.trimStart().startsWith('#')) continue;
  const entry=line.match(/^( +)([^\s:#]+):\s*(true|false)\s*$/);
  if(!entry) break;
  depth??=entry[1].length;
  if(entry[1].length!==depth) break;
  result.set(entry[2],entry[3]==='true');
 }
 return result;
}
export function classifyDependencyBuilds({allowBuilds,packages}) {
 const errors=[];
 for(const name of packages.keys()) if(!allowBuilds.has(name)) errors.push(`${name} 构建脚本未审计`);
 for(const name of allowBuilds.keys()) if(!packages.has(name)) errors.push(`${name} 构建脚本登记残留`);
 return errors.sort();
}
export function collectInstallScriptPackages(store) {
 if(!fs.existsSync(store)) throw new Error('Dependency store missing; install the locked dependencies first');
 const result=new Map();
 const readPackages=directory=>{
  for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
   if(!item.isDirectory()||item.name.startsWith('.')) continue;
   const location=path.join(directory,item.name);
   if(item.name.startsWith('@')) {readPackages(location);continue;}
   const manifest=path.join(location,'package.json');
   if(!fs.existsSync(manifest)) continue;
   const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
   const stages=Object.keys(pkg.scripts??{}).filter(stage=>['install','preinstall','postinstall'].includes(stage));
   if(stages.length) result.set(pkg.name,stages);
  }
 };
 for(const item of fs.readdirSync(store,{withFileTypes:true})) {
  const directory=path.join(store,item.name,'node_modules');
  if(item.isDirectory()&&fs.existsSync(directory)) readPackages(directory);
 }
 return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const root=fileURLToPath(new URL('../',import.meta.url));
 const errors=classifyDependencyBuilds({allowBuilds:parseAllowBuilds(fs.readFileSync(path.join(root,'pnpm-workspace.yaml'),'utf8')),packages:collectInstallScriptPackages(path.join(root,'node_modules/.pnpm'))});
 if(errors.length) {console.error(errors.join('\n'));process.exitCode=1;}
 else console.log('Dependency install scripts match the explicit approval manifest');
}
