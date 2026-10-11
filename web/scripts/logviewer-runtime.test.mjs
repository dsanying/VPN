import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLogRuntime } from './check-runtime-patches.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=createRequire(path.join(root,'package.json')).resolve('@melloware/react-logviewer/package.json');
for(const kind of ['esm','cjs'])test(`${kind}: actual installed observer defers and coalesces measurements, then cleans up`,()=>{
 const source=readFileSync(path.join(path.dirname(manifest),`dist/${kind}/index.js`),'utf8');
 const start=source.indexOf('M = e => {\n    // Shadow VPN:');
 const end=source.indexOf(', T =',start);assert.ok(start>=0&&end>start);
 let observer;const frames=new Map();let count=0;
 class RO { constructor(callback){this.callback=callback;observer=this;}observe(){}unobserve(){}disconnect(){this.disconnected=true;} }
 const create=new Function('I','z','requestAnimationFrame','cancelAnimationFrame',`return (${source.slice(start+4,end)});`)(()=>({ResizeObserver:RO}),x=>x,callback=>{frames.set(++count,callback);return count;},id=>frames.delete(id));
 const received=[];const wrapper=create(entries=>received.push(entries));const target={};wrapper.A(target);
 observer.callback([{target,contentRect:{height:20}}]);observer.callback([{target,contentRect:{height:28}}]);
 assert.equal(received.length,0);assert.equal(frames.size,1);const callback=[...frames.values()][0];frames.clear();callback();
 assert.equal(received.length,1);assert.equal(received[0][0].contentRect.height,28);
 observer.callback([{target}]);wrapper.B(target);const next=[...frames.values()][0];frames.clear();next();assert.equal(received.length,1);
 observer.callback([{target}]);wrapper.X();assert.equal(frames.size,0);assert.equal(observer.disconnected,true);
});
test('installed release and both entrypoint hashes match the audited patch',()=>assert.deepEqual(auditLogRuntime(root),[]));
