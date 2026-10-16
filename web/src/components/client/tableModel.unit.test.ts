import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderRows,fittedColumnWidth} from './tableModel.ts';
test('whole collection ordering is natural, stable and keeps empty names last in both directions',()=>{
 const rows=[{id:'b',name:'node 10'},{id:'a',name:'node 2'},{id:'z',name:null},{id:'c',name:'NODE 2'},{id:'d',name:' '}];
 assert.deepEqual(orderRows(rows,row=>row.name,row=>row.id).map(row=>row.id),['a','c','b','d','z']);
 assert.deepEqual(orderRows(rows,row=>row.name,row=>row.id,'descend').map(row=>row.id),['b','a','c','d','z']);
 assert.deepEqual(rows.map(row=>row.id),['b','a','z','c','d']);
});
test('short columns fit without scroll and long main values do not force a wide table',()=>{
 assert.equal(fittedColumnWidth(42,80),120);
 assert.equal(fittedColumnWidth(42,900,true),200);
 assert.equal(fittedColumnWidth(310,80),340);
});
