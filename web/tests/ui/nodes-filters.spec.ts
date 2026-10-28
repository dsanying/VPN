import {expect,test} from './console-guard';
import {installDesktopMock} from './desktop-mock';
const base={protocol:'vless',address:'example.com',port:443,uuid:'00000000-0000-4000-8000-000000000001',network:'tcp',security:'tls',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
async function setup(page:import('@playwright/test').Page, many=false) {
 await page.addInitScript(()=>localStorage.setItem('shadowvpn-lang','zh-CN'));
 const servers=[{...base,id:'n1',name:'日本示例',subscriptionId:'s1'},{...base,id:'n2',name:'美国示例',protocol:'vmess',subscriptionId:'s2'},...(many?Array.from({length:40},(_,i)=>({...base,id:`extra-${i}`,name:`其他节点 ${i}`})):[])];
 const mock=await installDesktopMock(page,{fixtures:{servers,subscriptions:[{id:'s1',name:'示例订阅一',url:'https://example.com/one',lastUpdated:'2026-10-01T00:00:00Z',userInfo:{remaining:1024,balance:0,currency:'CNY'}},{id:'s2',name:'示例订阅二',url:'https://example.com/two',lastUpdated:'2026-10-01T00:00:00Z'}],measurements:{n1:{latency:45,testedAt:Date.now(),detail:{exit:{countryCode:'JP'}}},n2:{latency:-1,testedAt:Date.now(),detail:{exit:{countryCode:'US'}}}}}});
 await page.goto('/#/nodes');await expect(page.getByRole('heading',{name:'节点',exact:true})).toBeVisible({timeout:15000}); await expect(page.getByRole('region',{name:'节点列表'})).toBeVisible(); return mock;
}
test('节点协议、地区、实测状态筛选及选择器共用测量结果',async({page})=>{
 const mock=await setup(page);const list=page.getByRole('region',{name:'节点列表'});
 await expect(list.getByText('当前可用',{exact:true})).toBeVisible();await expect(list.getByText('当前不可用',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'协议',exact:true}).click();await page.getByText('VMESS',{exact:true}).last().click();await expect(list.getByRole('listitem')).toHaveCount(1);await expect(list.getByText('美国示例',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'协议',exact:true}).locator('xpath=ancestor::*[contains(@class,"ant-select")][1]').hover();await page.locator('.client-filter-select').filter({has:page.getByRole('combobox',{name:'协议',exact:true})}).locator('.ant-select-clear').click();await page.getByRole('combobox',{name:'地区',exact:true}).click();await page.getByText('日本',{exact:true}).last().click();await expect(list.getByRole('listitem')).toHaveCount(1);await expect(list.getByText('日本示例',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await page.locator('.client-filter-select').filter({has:page.getByRole('combobox',{name:'地区',exact:true})}).hover();await page.locator('.client-filter-select').filter({has:page.getByRole('combobox',{name:'地区',exact:true})}).locator('.ant-select-clear').click();await page.getByRole('combobox',{name:'状态',exact:true}).click();await page.getByText('当前不可用',{exact:true}).last().click();await expect(list.getByRole('listitem')).toHaveCount(1);
 await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'节点',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:/^示例订阅一 right$/}).click();await expect(page.getByRole('menuitemcheckbox',{name:/日本示例 当前可用/})).toBeVisible();await mock.expectNoUnexpectedRequests();
});
test('窄窗口筛选条件换行，完整控件均可操作',async({page})=>{
 await page.setViewportSize({width:320,height:720});await setup(page);
 for(const form of await page.locator('.client-query').all()) {
  const size=await form.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  expect(size.scroll).toBeLessThanOrEqual(size.width+1);
 }
 await expect(page.getByRole('combobox',{name:'状态',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'重置',exact:true})).toHaveCount(0);
});
test('节点组管理集中展示元数据、双路径连通性与同步操作',async({page})=>{
 const mock=await setup(page);
 await expect(page.getByRole('button',{name:'添加',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'管理',exact:true}).click();
 await expect(page.getByRole('heading',{name:'节点组',exact:true})).toBeVisible();
 const table=page.getByRole('table');
 await expect(table.getByText('示例订阅一',{exact:true})).toBeVisible();await expect(table.getByText('示例订阅二',{exact:true})).toBeVisible();await expect(table.getByText('剩余: 1.02 KB / 总量: —',{exact:true})).toBeVisible();await expect(table.getByText('余额: 0 CNY',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).desktopTest.calls.filter((c:any)=>c.channel==='subscription:connectivity').length)).toBe(0);
 await table.getByRole('button',{name:'检测连通性',exact:true}).first().click();
 await expect(table.getByText('可访问 · HTTP 200',{exact:true})).toBeVisible();
 await expect(table.getByText('HTTP 403 · 链接响应异常',{exact:true})).toBeVisible();
 for (const text of ['可访问 · HTTP 200','HTTP 403 · 链接响应异常']) {
  const size=await table.getByText(text,{exact:true}).evaluate(el=>({visible:el.clientWidth,content:el.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.visible+1);
 }
 await table.getByRole('button',{name:'同步',exact:true}).first().click();expect(await page.evaluate(()=>(window as any).desktopTest.calls.filter((call:any)=>call.channel==='subscription:updateServers').length)).toBe(1);
 await table.getByRole('row').filter({hasText:'示例订阅二'}).getByRole('button',{name:'查看',exact:true}).click();
 await expect(page.getByRole('region',{name:'节点列表'}).getByRole('listitem')).toHaveCount(1);
 await expect(page.locator('.client-filter-select').filter({has:page.getByRole('combobox',{name:'来源',exact:true})}).getByText('示例订阅二',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'管理',exact:true}).click();
 await expect(page.getByRole('table').getByText('可访问 · HTTP 200',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).desktopTest.calls.filter((c:any)=>c.channel==='subscription:connectivity').length)).toBe(1);
 await mock.expectNoUnexpectedRequests();
});
for(const height of [600,440])test(`节点列表独立滚动，${height} 高度下控制区固定`,async({page})=>{
 await page.setViewportSize({width:960,height});await setup(page,true);const region=page.getByRole('region',{name:'节点列表'});
 const heading=page.getByRole('heading',{name:'节点',exact:true});const before=await heading.boundingBox();
 const dimensions=await region.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,parent:el.closest('main')?.scrollHeight,parentHeight:el.closest('main')?.clientHeight}));expect(dimensions.height).toBeGreaterThan(60);expect(dimensions.scroll).toBeGreaterThan(dimensions.height);expect(dimensions.parent).toBe(dimensions.parentHeight);
 await region.evaluate(el=>{el.scrollTop=el.scrollHeight;});expect((await heading.boundingBox())?.y).toBe(before?.y);await expect(page.getByRole('combobox',{name:'协议',exact:true})).toBeVisible();
});

test('后台整批检测显示进度，结束后展示可用结论与明确失败信息',async({page})=>{
 await setup(page); const list=page.getByRole('region',{name:'节点列表'});
 await page.evaluate(()=> (window as any).desktopTest.emit('event:speedTestProgress',{tested:0,ok:0,total:2,serverIds:['n1','n2'],active:true}));
 await expect(list.locator('.vpn-node-list__metrics .ant-tag').getByText('检测中',{exact:true})).toHaveCount(2);
 await expect(list.locator('[data-slot]').getByText('检测中',{exact:true})).toHaveCount(4);
 await expect(page.getByRole('status').filter({hasText:'已测 0/2'})).toBeVisible();
 await page.evaluate(()=>{
  const emit=(window as any).desktopTest.emit;
  emit('event:speedTestResult',{serverId:'n2',latency:-1});
  emit('event:speedTestDetails',{serverId:'n2',detail:{entry:{status:'error',reason:'ECONNRESET'},proxyReason:'tunnel-ECONNRESET'}});
  emit('event:speedTestProgress',{tested:2,ok:1,total:2});
  emit('event:speedTestProgress',{active:false});
 });
 await expect(list.getByText('当前不可用',{exact:true})).toBeVisible();
 await expect(list.locator('[data-slot]').getByText('连接失败',{exact:true})).toHaveCount(2);
 await expect(list.locator('.anticon-question-circle')).toHaveCount(0);
 await page.evaluate(()=> (window as any).desktopTest.emit('event:speedTestDetails',{serverId:'n2',detail:{entry:{status:'unavailable'},proxyReason:'core-not-ready'}}));
 await expect(list.locator('[data-slot]').getByText('无法确认',{exact:true})).toBeVisible();
});

test('节点组在地区图标前，选用后列表、选择器与底栏保留原名和节点 ID',async({page})=>{
 const mock=await setup(page);const list=page.getByRole('region',{name:'节点列表'});
 const identity=list.getByRole('listitem').first().locator('.ds-node-identity');
 await expect(identity).toHaveText('示例订阅一 /日本示例');
 expect(await identity.evaluate(el=>Array.from(el.children).map(child=>child.getAttribute('role')==='img'?'region':child.textContent))).toEqual(['示例订阅一 /','region','日本示例']);
 await list.getByRole('listitem').nth(1).locator('.vpn-node-list__card').click();
 await expect(page.locator('.ant-cascader .ds-node-identity')).toHaveText('示例订阅二 /美国示例');
 await expect(page.locator('footer .ds-node-identity')).toHaveText('示例订阅二 /美国示例');
 const switches=await page.evaluate(()=>(window as any).desktopTest.calls.filter((call:any)=>call.channel==='server:switch'));
 expect(switches.at(-1)?.args.serverId).toBe('n2');
 await mock.expectNoUnexpectedRequests();
});

test('节点组编辑与删除更新真实配置，取消删除保留节点',async({page})=>{
 const mock=await setup(page);await page.getByRole('button',{name:'管理',exact:true}).click();
 const table=page.getByRole('table');const row=table.getByRole('row').filter({hasText:'示例订阅一'});
 await row.getByRole('button',{name:'编辑',exact:true}).click();const editor=page.getByRole('dialog');
 await editor.getByLabel('名称',{exact:true}).fill('重命名订阅');await editor.getByRole('button',{name:/保存$/}).click();await expect(editor).not.toBeVisible();
 const renamed=table.getByRole('row').filter({hasText:'重命名订阅'});await expect(renamed).toBeVisible();
 await renamed.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('tooltip').getByRole('button',{name:/取消$/}).click();
 expect(await page.evaluate(()=>(window as any).desktopTest.getConfig().servers.length)).toBe(2);
 await renamed.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('tooltip').getByRole('button',{name:/确定$/}).click();
 await expect(renamed).toHaveCount(0);expect(await page.evaluate(()=>(window as any).desktopTest.getConfig().servers.map((n:any)=>n.id))).toEqual(['n2']);await mock.expectNoUnexpectedRequests();
});

test('筛选单一来源时节点卡隐藏组前缀，清除筛选恢复',async({page})=>{
 await setup(page);const list=page.getByRole('region',{name:'节点列表'});
 const identity=list.getByRole('listitem').first().locator('.ds-node-identity');
 await expect(identity).toHaveText('示例订阅一 /日本示例');
 await page.locator('.client-filter-select').filter({has:page.getByRole('combobox',{name:'来源',exact:true})}).getByRole('combobox',{name:'来源',exact:true}).click();
 await page.locator('.ant-select-item-option').filter({hasText:'示例订阅二'}).click();
 await expect(list.getByRole('listitem')).toHaveCount(1);
 const filtered=list.getByRole('listitem').first().locator('.ds-node-identity');
 await expect(filtered).toHaveText('美国示例');
 expect(await filtered.evaluate(el=>Array.from(el.children).map(child=>child.getAttribute('role')==='img'?'region':child.textContent))).toEqual(['region','美国示例']);
 await filtered.getByRole('button').count();
 await page.locator('.client-filter-select').filter({has:page.getByRole('combobox',{name:'来源',exact:true})}).getByRole('combobox',{name:'来源',exact:true}).click();
 await page.locator('.ant-select-item-option').filter({hasText:'示例订阅一'}).click();
 await expect(identity).toHaveText('示例订阅一 /日本示例');
});
