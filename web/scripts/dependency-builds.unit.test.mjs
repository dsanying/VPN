import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAllowBuilds,classifyDependencyBuilds,collectInstallScriptPackages} from './check-ignored-builds.mjs';
test('approval parser accepts equal indentation and stops before another document field',()=>{
 for(const spaces of ['  ','    ']) {
  const config=`allowBuilds:\n${spaces}approved: true\n${spaces}blocked: false\nother:\n${spaces}leak: true\n`;
  assert.deepEqual([...parseAllowBuilds(config)],[['approved',true],['blocked',false]]);
 }
 assert.deepEqual([...parseAllowBuilds('packages: []')],[]);
});
test('install scripts require a declared decision and orphan decisions are rejected',()=>{
 const decision=new Map([['native',true],['optional',false]]);
 const dependencies=new Map([['native',['install']],['optional',['postinstall']]]);
 assert.deepEqual(classifyDependencyBuilds({allowBuilds:decision,packages:dependencies}),[]);
 assert.match(classifyDependencyBuilds({allowBuilds:new Map(),packages:dependencies}).join('\n'),/native.*未审计/);
 assert.match(classifyDependencyBuilds({allowBuilds:decision,packages:new Map()}).join('\n'),/optional.*残留/);
 assert.throws(()=>collectInstallScriptPackages('/nonexistent-shadow-store'),/missing/);
});
