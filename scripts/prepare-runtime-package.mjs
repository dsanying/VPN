#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname,'..');
const destination = path.join(root,'dist-package','app-source');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const runtimePackage = Object.fromEntries(['name','version','description','main','author','license','productName','dependencies','overrides'].filter(key=>sourcePackage[key]!==undefined).map(key=>[key,sourcePackage[key]]));
const lock = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
lock.packages[''] = { name: runtimePackage.name, version: runtimePackage.version, license: runtimePackage.license, dependencies: runtimePackage.dependencies };
// An independent, clean application directory prevents stale developer modules from becoming runtime dependencies.
fs.rmSync(destination,{recursive:true,force:true});
fs.mkdirSync(destination,{recursive:true});
for (const entry of ['dist','LICENSE.txt','NOTICE.md','licenses']) {
  const source = path.join(root,entry);
  if (fs.existsSync(source)) fs.cpSync(source,path.join(destination,entry),{recursive:true});
}
if (!fs.existsSync(path.join(destination,runtimePackage.main))) throw new Error('Build the application before preparing its runtime package');
fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify(runtimePackage,null,2)+'\n');
fs.writeFileSync(path.join(destination,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
const installed = spawnSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:destination,stdio:'inherit',shell:process.platform==='win32'});
if(installed.error)throw installed.error;
if(installed.status!==0)process.exit(installed.status??1);
for (const dependency of Object.keys(sourcePackage.devDependencies??{})) {
  if (Object.hasOwn(runtimePackage.dependencies,dependency)) continue;
  const entry = path.join(destination,'node_modules',dependency,'package.json');
  if (fs.existsSync(entry)) {
    // A development dependency may also be a real production transitive dependency.
    const record = lock.packages[`node_modules/${dependency}`];
    if (record?.dev === true) throw new Error(`Developer-only dependency present in runtime package: ${dependency}`);
  }
}
console.log('Prepared an isolated application package with production dependencies only.');
