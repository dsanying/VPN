// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRuntimeLock } from './runtime-lock.mjs';
test('a browser run prevents another build from replacing its bundle until it releases ownership',()=>{
 const directory=mkdtempSync(join(tmpdir(),'shadow-runtime-lock-'));
 try {
  const file=join(directory,'runtime.lock');
  const release=acquireRuntimeLock(file);
  assert.throws(()=>acquireRuntimeLock(file),/already locked/);
  release();release();
  acquireRuntimeLock(file)();
  assert.equal(existsSync(file),false);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
test('stale or replaced locks cannot be silently removed by a different owner',()=>{
 const directory=mkdtempSync(join(tmpdir(),'shadow-runtime-lock-'));
 try {
  const file=join(directory,'runtime.lock');
  const release=acquireRuntimeLock(file);
  writeFileSync(file,'another run');
  assert.throws(release,/ownership changed/);
  assert.throws(()=>acquireRuntimeLock(file),/already locked/);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
