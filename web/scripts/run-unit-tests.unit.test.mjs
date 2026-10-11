import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {discoverUnitTests} from './run-unit-tests.mjs';
test('discover client tests recursively, excluding production and browser specs',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'shadow-test-discovery-'));
 try {
  mkdirSync(path.join(root,'nested'));
  for(const name of ['first.unit.test.mjs','nested/second.unit.test.ts','nested/view.unit.test.tsx','ordinary.ts','browser.spec.ts']) writeFileSync(path.join(root,name),'');
  const paths=discoverUnitTests([root]);
  assert.deepEqual(paths.map(file=>path.relative(root,file)),['first.unit.test.mjs','nested/second.unit.test.ts','nested/view.unit.test.tsx']);
  assert.deepEqual(discoverUnitTests([]),[]);
 } finally {rmSync(root,{recursive:true,force:true});}
});
