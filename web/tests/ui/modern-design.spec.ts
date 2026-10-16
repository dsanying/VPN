import {test,expect} from './console-guard';
import {installDesktopMock} from './desktop-mock';
import type {Page} from '@playwright/test';
async function choose(page:Page, name:string,label:string) {
 await page.getByRole('combobox',{name,exact:true}).click();
 await page.getByRole('option',{name:label,exact:true}).click();
 await page.keyboard.press('Escape');
}
const base={protocol:'vless',address:'example.com',port:443,uuid:'00000000-0000-4000-8000-000000000001',network:'tcp',security:'tls',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
for(const theme of ['light','dark'])test(`current client density and combinable filters ${theme}`,async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.addInitScript(mode=>{localStorage.setItem('shadowvpn-lang','zh-CN');localStorage.setItem('shadowvpn-theme',mode);},theme);
 const mock=await installDesktopMock(page,{fixtures:{servers:[{...base,id:'a',name:'Alpha'},{...base,id:'b',name:'Beta',protocol:'vmess'}]}});
 await page.goto('/#/nodes');await expect(page.getByRole('list',{name:'节点'}).getByRole('listitem')).toHaveCount(2);
 const style=await page.locator('html').evaluate(node=>({font:getComputedStyle(node).fontSize,brand:getComputedStyle(node).getPropertyValue('--ds-color-brand').trim(),control:getComputedStyle(node).getPropertyValue('--ds-control-height').trim()}));
 expect(style).toEqual({font:'14px',brand:'#1677ff',control:'32px'});
 await choose(page,'协议','VMESS');await expect(page.getByRole('list',{name:'节点'}).getByRole('listitem')).toHaveCount(1);
 await choose(page,'协议','VLESS');await expect(page.getByRole('list',{name:'节点'}).getByRole('listitem')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'重置',exact:true})).toHaveCount(0);
 await page.getByRole('combobox',{name:'协议',exact:true}).click();
 await expect(page.getByRole('option',{name:'WIREGUARD',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await mock.expectNoUnexpectedRequests();
});
test('query conditions wrap without a toolbar scroll at a narrow client width',async({page})=>{
 await page.setViewportSize({width:360,height:850});
 await page.addInitScript(()=>localStorage.setItem('shadowvpn-lang','zh-CN'));
 const mock=await installDesktopMock(page);await page.goto('/#/nodes');
 await expect(page.getByRole('combobox',{name:'协议',exact:true})).toBeVisible();
 const geometry=await page.locator('.client-query').evaluateAll(forms=>forms.map(form=>({width:form.clientWidth,scroll:form.scrollWidth,right:form.getBoundingClientRect().right})));
 for(const row of geometry){expect(row.scroll).toBeLessThanOrEqual(row.width+1);expect(row.right).toBeLessThanOrEqual(360);}
 await mock.expectNoUnexpectedRequests();
});
test('actual connection table aligns headers and independent long values scroll both ways',async({page})=>{
 await page.setViewportSize({width:1100,height:800});
 await page.addInitScript(()=>localStorage.setItem('shadowvpn-lang','zh-CN'));
 const mock=await installDesktopMock(page);await page.goto('/#/connections');
 await expect(page.getByRole('heading',{name:'连接',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).desktopTest.calls.some((call:any)=>call.channel==='stats:subscribe'&&call.args.topic==='detail'))).toBe(true);
 const longPath='/Applications/Example.app/'+('complete-directory/'.repeat(24))+'tail-marker';
 await page.evaluate(path=>(window as any).desktopTest.emit('event:connectionsDetail',{source:'device',at:Date.now(),connections:[{id:'unknown',chains:[],metadata:{network:'tcp'}},{id:'long',chains:['direct'],outbound:'direct',metadata:{host:'example.com',processPath:path,network:'tcp'}}]}),longPath);
 const row=page.locator('.client-table tbody tr[data-row-key]').first();await expect(row).toBeVisible();
 await expect(row).toContainText('example.com');await expect(page.locator('.client-table tbody tr[data-row-key]').last()).toContainText('未识别目标');
 const alignment=await page.locator('.client-table').evaluate(root=>{
  const headers=[...root.querySelectorAll<HTMLElement>('th[data-client-column]')];
  const cells=[...root.querySelectorAll<HTMLElement>('tbody tr[data-row-key] td[data-client-column]')];
  return headers.map(header=>{const cell=cells.find(cell=>cell.dataset.clientColumn===header.dataset.clientColumn)!;return {key:header.dataset.clientColumn,difference:Math.abs(header.getBoundingClientRect().width-cell.getBoundingClientRect().width),align:getComputedStyle(cell).textAlign};});
 });
 expect(alignment).toHaveLength(8);for(const column of alignment){expect(column.difference,column.key).toBeLessThanOrEqual(1);expect(column.align).toBe('left');}
 const slot=row.locator('[data-client-overflow="x"]').filter({hasText:longPath}).last();await slot.scrollIntoViewIfNeeded();
 await expect.poll(()=>slot.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeGreaterThan(100);
 const box=(await slot.boundingBox())!;await page.mouse.move(box.x+Math.min(box.width/2,80),box.y+box.height/2);
 await page.keyboard.down('Shift');await page.mouse.wheel(0,500);await expect.poll(()=>slot.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 await page.mouse.wheel(0,-1000);await expect.poll(()=>slot.evaluate(el=>el.scrollLeft)).toBe(0);await page.keyboard.up('Shift');
 await mock.expectNoUnexpectedRequests();
});
