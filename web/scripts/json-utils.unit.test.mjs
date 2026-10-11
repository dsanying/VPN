import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseJsonText,formatJson,formatUnknownJson} from '../src/utils/json.ts';
test('protocol configuration round trips without deleting nested keys or arrays',()=>{
 const configuration={transport:{headers:{Host:'example.com'},alpn:['h2','http/1.1']},enabled:false,count:0};
 assert.deepEqual(parseJsonText(formatJson(configuration)),configuration);
 assert.equal(formatUnknownJson(JSON.stringify(configuration)),formatJson(configuration));
 assert.throws(()=>parseJsonText('{invalid'),SyntaxError);
});
test('read-only display preserves non-JSON and handles empty and circular values',()=>{
 for(const value of [null,undefined,'']) assert.equal(formatUnknownJson(value),'—');
 assert.equal(formatUnknownJson('unstructured note'),'unstructured note');
 const circular={};circular.self=circular;
 assert.equal(formatUnknownJson(circular),'[object Object]');
 assert.throws(()=>formatJson(circular),TypeError);
});
