import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checks,runChecks,selectChecks,verifyManifest} from './client-checks.mjs';
test('manifest must include every executable check and the updater UI source',()=>{
 const manifest={schemaVersion:2,checks:checks.map(check=>({...check,command:['node',...check.command],cwd:'web'}))};
 verifyManifest(manifest);
 assert.ok(checks.find(check=>check.id==='client-ui').command.includes('update-popup'));
 assert.throws(()=>verifyManifest({...manifest,checks:manifest.checks.slice(1)}),/differs/);
});
test('default gate covers static, build and actual browser contracts; partial mode remains explicit',()=>{
 assert.deepEqual(selectChecks([]),checks);
 assert.ok(selectChecks(['--affected']).every(check=>check.phase==='static'));
 assert.ok(selectChecks(['--phase','ui']).some(check=>check.id==='browser-contracts'));
 for(const args of [['--phase'],['--phase','unknown'],['--unknown'],['--phase','static','--phase','ui']]) assert.throws(()=>selectChecks(args));
});
test('first failure stops dependent work and missing exit status never becomes success',()=>{
 let calls=0;
 assert.throws(()=>runChecks(checks,()=>++calls===2?1:0),/failed/);
 assert.equal(calls,2);
 assert.throws(()=>runChecks([],()=>0),/No client checks/);
 assert.throws(()=>runChecks(checks.slice(0,1),()=>null),/failed/);
});
