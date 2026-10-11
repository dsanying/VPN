import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flatten,inspectCatalogs,resolveText} from './check-client-i18n.mjs';
test('flattened client text retains parameters after dependency pruning',()=>{
 const catalog=flatten({shared:{save:'保存'},message:{ok:'$t(shared.save) {count} 条成功'}});
 assert.equal(resolveText('message.ok',catalog),'保存 {count} 条成功');
 const retained={'message.ok':resolveText('message.ok',catalog)};
 assert.deepEqual(inspectCatalogs({zh:retained,en:{'message.ok':'Saved {count} items'}},new Set(['message.ok'])),[]);
});
test('missing used keys, mismatched parameters and nesting cycles fail closed',()=>{
 assert.match(inspectCatalogs({zh:{action:'{count}'},en:{action:'{total}'}},new Set(['missing'])).join('\n'),/parameters differ[\s\S]*missing used key/);
 assert.throws(()=>resolveText('a',{a:'$t(b)',b:'$t(a)'}),/cycle/);
 assert.throws(()=>resolveText('a',{a:'$t(missing)'}),/Missing translation/);
 assert.throws(()=>flatten({label:42}),/Invalid translation/);
 assert.throws(()=>resolveText('toString',{}),/Missing translation/);
 assert.match(inspectCatalogs({zh:{a:'{{count}}'},en:{a:'{count}'}},new Set(['a'])).join('\n'),/double-brace/);
});
