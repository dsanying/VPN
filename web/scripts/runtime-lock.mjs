// SPDX-License-Identifier: MIT
import { mkdirSync, openSync, writeFileSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** The served bundle must remain immutable for the complete browser run. */
export function acquireRuntimeLock(file) {
 mkdirSync(dirname(file), { recursive: true });
 const record = JSON.stringify({ pid: process.pid, token: randomUUID() });
 let descriptor;
 try { descriptor = openSync(file, 'wx', 0o600); }
 catch (error) {
  if (error.code !== 'EEXIST') throw error;
  throw new Error('Client runtime is already locked. Finish the active build/browser run before starting another; inspect a stale lock before removing it.');
 }
 try { writeFileSync(descriptor, record); } finally { closeSync(descriptor); }
 let released = false;
 return () => {
  if (released) return;
  if (readFileSync(file, 'utf8') !== record) throw new Error('Client runtime lock ownership changed');
  unlinkSync(file);
  released = true;
 };
}
