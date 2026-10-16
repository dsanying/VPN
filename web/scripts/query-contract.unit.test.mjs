import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {inspectQueryContract,checkQueryProject} from './check-query-contract.mjs';
const ts=createRequire(import.meta.url)('typescript');
const inspect=(source)=>inspectQueryContract(ts,'fixture.tsx',source,value=>value==='./columns#name',new Set(['record.name']));
test('semantic enum binding and full collection order are accepted',()=>{assert.deepEqual(inspect(`import {QueryForm,FilterSelect,Table} from '@/components/client';const view=<><QueryForm mode="local"><Form.Item data-filter-column="./columns#name"><FilterSelect kind="enum"/></Form.Item></QueryForm><Table orderBy={row=>row.name}/></>`),[]);});
test('aliased native select and unbound query fields cannot bypass the contract',()=>{const failures=inspect(`import {Select as Native} from 'antd';import {QueryForm} from '@/components/client';const Alias=Native;const view=<QueryForm mode="local"><Form.Item><Alias/></Form.Item></QueryForm>`);assert.ok(failures.some(f=>f.rule==='CLIENT-FILTER'));assert.ok(failures.some(f=>f.rule==='CLIENT-FILTER-BINDING'));});
test('nonexistent columns, unknown fields and unordered tables fail',()=>{const failures=inspect(`<QueryForm><Form.Item data-filter-column="./columns#missing"/><Form.Item data-filter-field="record.missing"/></QueryForm>`);assert.equal(failures.filter(f=>f.rule==='CLIENT-FILTER-BINDING').length,2);assert.ok(inspect('<Table/>').some(f=>f.rule==='CLIENT-TABLE-ORDER'));});
test('ordinary editing select and a configured rule order remain legal',()=>{assert.deepEqual(inspect(`<Form><Form.Item><Select/></Form.Item></Form><Table order="given"/>`),[]);});

test('table inventory resolves imported aliases rather than JSX spelling',()=>{
 const seen=[];
 const failures=inspectQueryContract(ts,'alias.tsx',`import {Table as Records} from '@/components/client';const view=<Records orderBy={r=>r.name}/>`,()=>false,new Set(),node=>seen.push(node));
 assert.deepEqual(failures,[]);assert.equal(seen.length,1);
});

test('binding another existing table does not qualify as an actual column binding',()=>{
 const root=mkdtempSync(join(tmpdir(),'client-column-binding-'));
 try{
  mkdirSync(join(root,'scripts'));mkdirSync(join(root,'src'));writeFileSync(join(root,'package.json'),'{}');symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
  writeFileSync(join(root,'scripts/design-system.project.json'),JSON.stringify({collections:{},sources:['src'],tables:[{source:'src/View.tsx',reason:'name ordering'}]}));
  for(const file of ['columns','unrelated'])writeFileSync(join(root,'src',file+'.tsx'),`export const build=()=>[{key:'name',title:'Name',dataIndex:'name'}];`);
  const view=binding=>`import {Table,QueryForm,FilterSelect} from '@/components/client';import {build} from './columns';const view=<><QueryForm><Form.Item data-filter-column="${binding}#name"><FilterSelect kind="enum"/></Form.Item></QueryForm><Table columns={build()} orderBy={r=>r.name}/></>`;
  writeFileSync(join(root,'src/View.tsx'),view('./columns'));assert.deepEqual(checkQueryProject(root),[]);
  writeFileSync(join(root,'src/View.tsx'),view('./unrelated'));assert.ok(checkQueryProject(root).some(f=>f.rule==='CLIENT-FILTER-BINDING'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
