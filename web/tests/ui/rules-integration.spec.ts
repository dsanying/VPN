import {expect,test} from './console-guard';
import {installDesktopMock} from './desktop-mock';
for(const language of ['zh-CN','en-US'])test(`合并后导航只有规则入口，旧应用地址兼容跳转 ${language}`,async({page})=>{
 await page.addInitScript(lang=>localStorage.setItem('shadowvpn-lang',lang),language);
 const mock=await installDesktopMock(page);
 await page.goto('/#/apps');await expect(page).toHaveURL(/#\/rules$/);
 await expect(page.getByRole('heading',{level:1})).toHaveText(language==='zh-CN'?'规则':'Rules');
 await expect(page.getByRole('menu').first().getByRole('link')).toHaveCount(5);
 await expect(page.getByRole('table')).toHaveCount(1);
 await mock.expectNoUnexpectedRequests();
});

for (const operation of ['新增', '编辑'] as const) test(`${operation}应用规则不重新启用旧全局开关停用的其他规则`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/rules');
  await expect(page.getByRole('heading', { level: 1, name: '规则', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.evaluate(async () => {
    const harness = (window as any).desktopTest;
    const config = structuredClone(harness.getConfig());
    config.proxyMode = 'direct';
    config.appRoutingEnabled = false;
    config.customAppPresets = ['old-a', 'old-b'].map(id => ({ id, name: id, installedApplication: { id, name: id, path: `/Applications/${id}.app`, processPaths: [`/Applications/${id}.app/Contents/MacOS/main`], processPathRegex: [], coverage: 'bundle' } }));
    config.appRules = ['old-a', 'old-b'].map(appId => ({ appId, enabled: true, action: 'proxy' }));
    await (window as any).electron.ipcRenderer.invoke('config:save',{config});
  });
  if (operation === '新增') {
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await page.getByRole('menuitem', { name: '应用规则', exact: true }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('combobox', { name: '选择应用', exact: true }).click();
    await page.getByRole('option', { name: /示例应用/ }).click();
    await drawer.getByRole('button', { name: /保存$/ }).click();
    await expect(drawer).not.toBeVisible();
  } else {
    await page.locator('tbody tr[data-row-key]').filter({hasText:'old-a'}).getByRole('button',{name:'编辑',exact:true}).click();
    const drawer=page.getByRole('dialog');
    await drawer.getByRole('combobox',{name:'去向',exact:true}).click();
    await page.getByRole('option',{name:'直连',exact:true}).click();
    await drawer.getByRole('button',{name:/保存$/}).click();
    await expect(drawer).not.toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().customRules.length)).toBe(operation==='新增'?3:2);
  const config = await page.evaluate(() => (window as any).desktopTest.getConfig());
  expect(config.proxyMode).toBe('direct');
  expect(config.customRules.find((rule: any) => rule.application?.id === 'old-b').enabled).toBe(false);
  expect(config.customRules.find((rule: any) => rule.application?.id === (operation === '新增' ? 'custom-installed-example' : 'old-a')).enabled).toBe(operation==='新增');
  expect(config.appRules).toEqual([]);
  await mock.expectNoUnexpectedRequests();
});

test('匹配与应用同表排序，域名移到应用上方后按同一列表保存', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('shadowvpn-lang','zh-CN'));
 const mock=await installDesktopMock(page);await page.goto('/#/rules');
 await expect(page.getByRole('heading',{level:1,name:'规则',exact:true})).toBeVisible();
 await expect(page.getByRole('table')).toBeVisible();
 await page.evaluate(async()=>{
  const h=(window as any).desktopTest;const c=structuredClone(h.getConfig());
  c.appRoutingEnabled=true;
  c.customAppPresets=[{id:'firefox-example',name:'Example Browser',installedApplication:{id:'firefox-example',name:'Example Browser',path:'/Applications/Example.app',processPaths:['/Applications/Example.app/Contents/MacOS/main'],processPathRegex:['^/Applications/Example\\.app/'],coverage:'bundle'}}];
  c.appRules=[{appId:'firefox-example',action:'direct',enabled:true}];
  c.customRules=[{id:'domain-example',type:'domainSuffix',values:['example.com'],action:'proxy',enabled:true}];
  await (window as any).electron.ipcRenderer.invoke('config:save',{config:c});
 });
 const rows=page.getByRole('table').locator('tbody tr[data-row-key]');
 await expect(rows).toHaveCount(2);await expect(rows.first()).toContainText('Example Browser');
 const domainRow=page.locator('tr[data-row-key="domain-example"]');
 const applicationRow=page.locator('tr[data-row-key="application:firefox-example"]');
 const from=await domainRow.getByRole('button',{name:'拖动调整顺序',exact:true}).boundingBox();
 const to=await applicationRow.locator('td').first().boundingBox();
 if(!from||!to)throw new Error('Missing rule drag handle');
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);
 await page.mouse.down();
 await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:20});
 await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>(window as any).desktopTest.getConfig().customRules.map((r:any)=>r.id))).toEqual(['domain-example','application:firefox-example']);
 await expect(rows.first()).toContainText('example.com');
 expect(await page.evaluate(()=>(window as any).desktopTest.getConfig().appRules)).toEqual([]);
 await rows.first().getByRole('switch').uncheck();
 await expect.poll(()=>page.evaluate(()=>(window as any).desktopTest.getConfig().customRules[0].enabled)).toBe(false);
 await mock.expectNoUnexpectedRequests();
});
