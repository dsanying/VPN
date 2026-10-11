import {test as playwright,expect,type Page,type Locator} from '@playwright/test';
import {APP_ORIGIN} from './app-origin';
import {inspectSidebarRegions} from './sidebar-contract';
type ExpectedReport={level:'warning'|'error';message:string;count?:number};
const expected=new WeakMap<Page,Map<string,number>>();
const browserOnly=new WeakMap<Page,Set<string>>();
function ledger(page:Page) {
 let entries=expected.get(page);
 if(!entries) {entries=new Map();expected.set(page,entries);}
 return entries;
}
export function registerExpectedConsoleReport(page:Page,report:ExpectedReport) {
 const count=report.count??1;
 if(!Number.isInteger(count)||count<1||!report.message.trim()) throw new Error('Invalid diagnostic expectation');
 const key=JSON.stringify([report.level,report.message]);
 const entries=ledger(page);entries.set(key,(entries.get(key)??0)+count);
}
/** Firefox can emit this engine diagnostic when Ant Design repositions a scrolled tooltip.
 * It is not an application console call. Permit at most one exact report in a declared test,
 * retain it as an artifact, and keep all other warnings/errors subject to the normal gate.
 */
export function registerFirefoxPopupPositioningDiagnostic(page:Page) {
 if(page.context().browser()?.browserType().name()!=='firefox') return;
 const message=`[JavaScript Warning: "This site appears to use a scroll-linked positioning effect. This may not work well with asynchronous panning; see https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html for further details and to join the discussion on related tools and features!" {file: "${page.url()}" line: 0}]`;
 registerExpectedConsoleReport(page,{level:'warning',message});
 const entries=browserOnly.get(page)??new Set<string>();
 entries.add(JSON.stringify(['warning',message]));browserOnly.set(page,entries);
}
export const test=playwright.extend<{clientDiagnostics:void}>({
 clientDiagnostics:[async({page},use,testInfo)=>{
  const issues:string[]=[];
  const engineReports:string[]=[];
  page.on('console',message=>{
   if(!['warning','error'].includes(message.type())) return;
   const entries=ledger(page);
   const text=message.text();
   const lines=text.split('\n');
   // Error objects append variable stack frames; declared message and count remain exact.
   const stable=lines.length>1&&lines.slice(1).every(line=>/^\s+at\s/.test(line))?lines[0]:text;
   const exactKey=JSON.stringify([message.type(),text]);
   const key=entries.has(exactKey)?exactKey:JSON.stringify([message.type(),stable]);
   const remaining=entries.get(key)??0;
    if(remaining>0) {if(browserOnly.get(page)?.has(key)) engineReports.push(text);if(remaining===1) entries.delete(key);else entries.set(key,remaining-1);}
   else issues.push(`console ${key} ${JSON.stringify(message.location())}`);
  });
  page.on('pageerror',error=>issues.push(`uncaught ${error.stack??error.message}`));
  page.on('requestfailed',request=>issues.push(`request ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on('response',response=>{if(response.status()>=400) issues.push(`HTTP ${response.status()} ${response.url()}`);});
  await use();
  issues.push(...await inspectSidebarRegions(page));
  if(page.url().startsWith(APP_ORIGIN)&&!page.url().includes('/tests/ui/')) {
   const title=page.getByRole('heading',{level:1});
   if(await title.count()!==1) issues.push('Client must have one primary heading');
   else if(await title.evaluate(node=>node.parentElement?.hasAttribute('title'))) issues.push('Primary heading must not have a native tooltip');
  }
  for(const [key,count] of ledger(page)) if(!browserOnly.get(page)?.has(key)) issues.push(`Missing expected diagnostic ${key} x ${count}`);
  if(engineReports.length) await testInfo.attach('declared-firefox-engine-diagnostics',{body:engineReports.join('\n'),contentType:'text/plain'});
  expect(issues,'Undeclared client runtime diagnostics').toEqual([]);
 },{auto:true}],
});
export {expect};
export type {Page,Locator};
