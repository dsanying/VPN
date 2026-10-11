import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=ts.createSourceFile('client-i18n.ts',fs.readFileSync(new URL('../src/i18n/index.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const declaration=source.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='tFragment');
assert.ok(declaration);
const compiled=ts.transpileModule(declaration.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const entry={};const globalCalls=[];
new Function('exports','i18n',compiled)(entry,{t:(...args)=>{globalCalls.push(args);return 'global';}});
test('fragment honors a fixed translation language without changing the caller options',()=>{
 const supplied={count:3,applyPostProcessor:true};let actual;
 const result=entry.tFragment('vpn.nodes',supplied,(key,options)=>{actual={key,options};return 'Nodes';});
 assert.equal(result,'Nodes');assert.equal(globalCalls.length,0);
 assert.deepEqual(actual,{key:'vpn.nodes',options:{count:3,applyPostProcessor:false}});
 assert.equal(supplied.applyPostProcessor,true);
});
test('default translator disables only fragment typography processing',()=>{
 assert.equal(entry.tFragment('common.vocab.region',{lng:'zh-CN'}),'global');
 assert.deepEqual(globalCalls.at(-1),['common.vocab.region',{lng:'zh-CN',applyPostProcessor:false}]);
});
