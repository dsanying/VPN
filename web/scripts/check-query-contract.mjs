// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
/** Resolve imported controls and their immutable aliases, not identifier spelling alone. */
export function inspectQueryContract(ts,file,source,resolveColumn=()=>false,fields=new Set(),onTable=()=>{}) {
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const failures=[];const imports=new Map();const aliases=new Map();
 for(const node of tree.statements)if(ts.isImportDeclaration(node)&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings))for(const binding of node.importClause.namedBindings.elements)imports.set(binding.name.text,{name:(binding.propertyName??binding.name).text,module:node.moduleSpecifier.text});
 const name=(node)=>{
  if(ts.isIdentifier(node)){const value=aliases.get(node.text);return value?name(value):imports.get(node.text)?.name??node.text;}
  if(ts.isPropertyAccessExpression(node))return `${name(node.expression)}.${node.name.text}`;
  return node.getText(tree);
 };
 const issue=(node,rule,message)=>{const p=tree.getLineAndCharacterOfPosition(node.getStart(tree));failures.push({file,line:p.line+1,rule,message});};
 const props=(node)=>Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a=>[a.name.getText(tree),a.initializer&&ts.isStringLiteral(a.initializer)?a.initializer.text:a.initializer?.getText(tree)]));
 const inQuery=(node)=>{for(let p=node.parent;p;p=p.parent)if(ts.isJsxElement(p)&&name(p.openingElement.tagName)==='QueryForm')return true;return false;};
 const visit=(node)=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&ts.isIdentifier(node.initializer))aliases.set(node.name.text,node.initializer);
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
   const component=name(node.tagName),attributes=props(node);
   if(component==='Table'||component==='DataTable'||component==='ClientTable') {
    onTable(node);
    if(!attributes.order && !attributes.orderBy && !attributes.ordering)issue(node,'CLIENT-TABLE-ORDER','Declare full-collection ordering or meaningful configured order.');
   }
   if(inQuery(node)) {
    let operation=false;for(let parent=node.parent;parent;parent=parent.parent)if(ts.isJsxElement(parent)&&name(parent.openingElement.tagName)==='Form.Item'&&['operation','ordering'].includes(props(parent.openingElement)['data-query-control']))operation=true;
    if(!operation&&(component==='Select'||component==='MultiSelect'))issue(node,'CLIENT-FILTER','Use FilterSelect with an explicit semantic kind in a query.');
    if(component==='FilterSelect'&&!['enum','pair','scope'].includes(attributes.kind))issue(node,'CLIENT-FILTER','Declare enum/pair/scope semantics.');
    if(component==='Form.Item') {
     const binding=attributes['data-filter-column'];const field=attributes['data-filter-field'];
     if(binding && !resolveColumn(binding))issue(node,'CLIENT-FILTER-BINDING','Filter column must resolve to a real titled column.');
     if(field && !fields.has(field))issue(node,'CLIENT-FILTER-BINDING','Collection field is not registered.');
     if(!binding&&!field&&!attributes['data-filter-purpose']&&!attributes['data-query-control'])issue(node,'CLIENT-FILTER-BINDING','Declare the actual column, collection field, purpose or operation.');
    }
   }
  }
  ts.forEachChild(node,visit);
 };
 visit(tree);return failures;
}
export function checkQueryProject(root) {
 const config=JSON.parse(fs.readFileSync(path.join(root,'scripts/design-system.project.json'),'utf8'));
 const ts=createRequire(path.join(root,'package.json'))('typescript');
 const registered=new Set(Object.entries(config.collections).flatMap(([name,value])=>value.fields.map(field=>`${name}.${field}`)));
 const tables=new Set();const failures=[];
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(dir,item.name)):item.name.endsWith('.tsx')?[path.join(dir,item.name)]:[]);
 for(const full of config.sources.flatMap(source=>walk(path.join(root,source)))) {
  const file=path.relative(root,full),text=fs.readFileSync(full,'utf8');
  const bindingTree=ts.createSourceFile(full,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const importsByName=new Map();const variables=new Map();const usedColumns=new Set();
  for(const statement of bindingTree.statements)if(ts.isImportDeclaration(statement)&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings))for(const item of statement.importClause.namedBindings.elements)importsByName.set(item.name.text,statement.moduleSpecifier.text);
  const collect=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)variables.set(node.name.text,node.initializer);ts.forEachChild(node,collect);};collect(bindingTree);
  const dependencies=(node,seen=new Set())=>{if(ts.isIdentifier(node)&&!seen.has(node.text)){seen.add(node.text);const imported=importsByName.get(node.text);if(imported)usedColumns.add(imported);const value=variables.get(node.text);if(value)dependencies(value,seen);}ts.forEachChild(node,child=>dependencies(child,seen));};
  const findColumns=node=>{if(ts.isJsxAttribute(node)&&node.name.getText(bindingTree)==='columns'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression)dependencies(node.initializer.expression);ts.forEachChild(node,findColumns);};findColumns(bindingTree);
  const resolveColumn=binding=>{
   const [module,key]=binding.split('#');if(!key||!usedColumns.has(module))return false;
   const base=module.startsWith('@/')?path.join(root,'src',module.slice(2)):path.resolve(path.dirname(full),module||path.basename(full));
   const target=[base,`${base}.tsx`,`${base}.ts`].find(fs.existsSync);if(!target)return false;
   const columnTree=ts.createSourceFile(target,fs.readFileSync(target,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
   let found=false;const visit=node=>{if(ts.isObjectLiteralExpression(node)) {const entries=new Map(node.properties.filter(ts.isPropertyAssignment).map(prop=>[prop.name.getText(columnTree).replace(/['"]/g,''),prop.initializer]));const candidate=entries.get('key')??entries.get('dataIndex');if(candidate&&ts.isStringLiteral(candidate)&&candidate.text===key&&entries.has('title'))found=true;}ts.forEachChild(node,visit);};visit(columnTree);return found;
  };
  failures.push(...inspectQueryContract(ts,file,text,resolveColumn,registered,()=>tables.add(file)));
 }
 for(const source of tables)if(!config.tables.some(table=>table.source===source&&table.reason.trim()))failures.push({file:source,line:1,rule:'CLIENT-TABLE-INVENTORY',message:'Register the real table and ordering purpose.'});
 for(const table of config.tables)if(!tables.has(table.source))failures.push({file:table.source,line:1,rule:'CLIENT-TABLE-INVENTORY',message:'Stale table registration.'});
 return failures;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const root=path.resolve(process.argv[2]??'.');const failures=checkQueryProject(root);for(const failure of failures)console.error(`${failure.file}:${failure.line} ${failure.rule}: ${failure.message}`);if(failures.length)process.exitCode=1;else console.log('Client query bindings and complete table inventory passed.');}
