import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nestHiddenRoutes,matchMenuChain,selectedMenuKey,hasVisibleChildren} from '../src/routes/menuMatch.ts';
test('node management remains under Nodes; routes do not mutate the supplied contract',()=>{
 const input=[{path:'/nodes'},{path:'/nodes/groups',hideInMenu:true},{path:'/rules'},{path:'/*',hideInMenu:true}];
 const original=JSON.stringify(input);const tree=nestHiddenRoutes(input);
 const chain=matchMenuChain(tree,'/nodes/groups');
 assert.deepEqual(chain.map(item=>item.path),['/nodes','/nodes/groups']);
 assert.equal(selectedMenuKey(chain),'/nodes');
 assert.equal(hasVisibleChildren(tree[0]),false);
 assert.equal(JSON.stringify(input),original);
 assert.equal(matchMenuChain(tree,'/unknown/deep').at(-1).path,'/*');
});
test('literal routes outrank parameter and wildcard routes; unknown paths have no selected item',()=>{
 const entries=[{path:'/:id'},{path:'/*',hideInMenu:true},{path:'/settings'}];
 assert.equal(selectedMenuKey(matchMenuChain(entries,'/settings')),'/settings');
 assert.equal(selectedMenuKey(matchMenuChain(entries,'/random/path')),undefined);
 assert.equal(selectedMenuKey([]),undefined);
});
