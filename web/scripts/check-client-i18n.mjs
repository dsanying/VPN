// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
export function flatten(object, prefix = '', output = {}) {
 for (const [name, value] of Object.entries(object)) {
  const key = prefix ? `${prefix}.${name}` : name;
  if (typeof value === 'string') output[key] = value;
  else if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, key, output);
  else throw new Error(`Invalid translation: ${key}`);
 }
 return output;
}
export function resolveText(key, catalog, ancestors = []) {
 if (ancestors.includes(key)) throw new Error(`Translation cycle: ${[...ancestors, key].join(' -> ')}`);
 if (!Object.hasOwn(catalog,key)) throw new Error(`Missing translation: ${key}`);
 return catalog[key].replace(/\$t\(([^(),]+)\)/g, (_, child) => resolveText(child.trim(), catalog, [...ancestors, key]));
}
function sources(directory) {
 return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file=path.join(directory,entry.name);
  return entry.isDirectory() ? sources(file) : /\.[jt]sx?$/.test(file) ? [file] : [];
 });
}
export function inspectCatalogs(catalogs, used) {
 const errors=[]; const locales=Object.keys(catalogs);
 const keys=new Set(Object.values(catalogs).flatMap(value=>Object.keys(value)));
 for(const key of keys) {
  const parameterSets=[];
  for(const locale of locales) {
   try {
    const text=resolveText(key,catalogs[locale]);
    if(/\{\{/.test(text)) errors.push(`Unsupported double-brace interpolation: ${locale}:${key}`);
    parameterSets.push([...new Set([...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match=>match[1]))].sort().join(','));
   } catch(error) {errors.push(`${locale}: ${error.message}`);}
  }
  if(new Set(parameterSets).size>1) errors.push(`Translation parameters differ: ${key}`);
 }
 for(const key of used) for(const locale of locales) if(!Object.hasOwn(catalogs[locale],key)) errors.push(`${locale}: missing used key ${key}`);
 return errors;
}
function main() {
 const filenames=['zh-CN','en-US'];
 const catalogs=Object.fromEntries(filenames.map(locale=>[locale,flatten(JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales',locale+'.json'),'utf8')))]));
 const used=new Set();
 for(const file of [...sources(path.join(root,'src')),...sources(path.join(root,'update-popup'))]) {
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(node) {
   if(ts.isStringLiteralLike(node) && (Object.hasOwn(catalogs['zh-CN'],node.text) || Object.hasOwn(catalogs['en-US'],node.text))) used.add(node.text);
   if(ts.isCallExpression(node) && /^(t|tFragment)$/.test(node.expression.getText(source).split('.').at(-1)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) used.add(node.arguments[0].text);
   ts.forEachChild(node,visit);
  }
  visit(source);
 }
 if(!used.size) throw new Error('No client translation keys found');
 const errors=inspectCatalogs(catalogs,used);
 if(errors.length) throw new Error(errors.join('\n'));
 if(process.argv.includes('--prune')) {
  // Flatten composition before pruning: a retained phrase must not lose its vocabulary dependencies.
  for(const locale of filenames) {
   const output={};
   for(const key of [...used].sort()) {
    const segments=key.split('.');let owner=output;
    for(const name of segments.slice(0,-1)) owner=owner[name]??=( {} );
    owner[segments.at(-1)]=resolveText(key,catalogs[locale]);
   }
   fs.writeFileSync(path.join(root,'src/i18n/locales',locale+'.json'),JSON.stringify(output,null,2)+'\n');
  }
 }
 console.log(`Client i18n: ${used.size} keys, ${filenames.length} languages`);
}
if(process.argv[1]===fileURLToPath(import.meta.url)) main();
