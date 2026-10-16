import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';
async function openPicker(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/apps');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('menuitem', { name: '应用规则', exact: true }).click();
  return mock;
}
test('选择已安装应用后只需设置去向，自动生成目录规则并保留分流方式', async ({ page }) => {
  const mock = await openPicker(page);
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('combobox', { name: '选择应用', exact: true }).click();
  const option = page.locator('.ant-select-item-option').filter({ hasText: '示例应用' });
  await expect(option.locator('.ds-application-icon img')).toBeVisible();
  await option.click();
  await expect(drawer.getByText('进程名', { exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: /保存$/ }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByText('示例应用', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr[data-row-key]').filter({ hasText: '示例应用' }).locator('.ds-application-icon img')).toBeVisible();
  const config = await page.evaluate(() => (window as any).desktopTest.getConfig());
  expect(config.proxyMode).toBe('smart'); expect(config.proxyModeType).toBe('tun');
  expect(config.customRules[0].application.processPathRegex).toEqual(['^/Applications/Example\\.app/']);
  expect(config.customRules[0].application.iconDataUrl).toBeUndefined();
  expect(config.customRules[0].application.processNames).toBeUndefined();
  expect(config.customRules[0]).toMatchObject({type:'processPathRegex',enabled:true,action:'proxy'});
  expect(config.customRules[0].values).toContain('^/Applications/Example\\.app/');
  expect(config.appRules ?? []).toHaveLength(0);
  await mock.expectNoUnexpectedRequests();
});
test('共用启动器不能假装可按应用自动分流', async ({ page }) => {
  const mock = await openPicker(page);
  await page.getByRole('dialog').getByRole('combobox', { name: '选择应用', exact: true }).click();
  const wrapper = page.locator('.ant-select-item-option').filter({ hasText: '封装应用' });
  await expect(wrapper).toHaveClass(/ant-select-item-option-disabled/);
  expect(await page.evaluate(() => (window as any).desktopTest.calls.some((c: any) => c.channel === 'config:save'))).toBe(false);
  await mock.expectNoUnexpectedRequests();
});
for (const mode of ['global','direct'] as const) test(`保存应用规则保持 ${mode}，规则页明确当前不生效`, async ({page}) => {
 const mock=await openPicker(page);
 await page.evaluate(mode=>{const h=(window as any).desktopTest;const c=h.getConfig();c.proxyMode=mode;h.emit('event:configChanged',{newValue:c});},mode);
 const drawer=page.getByRole('dialog');
 await drawer.getByRole('combobox',{name:'选择应用',exact:true}).click();
 await page.getByRole('option',{name:/示例应用/}).click();
 await drawer.getByRole('button',{name:/保存$/}).click();
 await expect(drawer).not.toBeVisible();
 expect(await page.evaluate(()=>(window as any).desktopTest.getConfig().proxyMode)).toBe(mode);
 const modeItem=page.locator('.ds-summary-strip__item').nth(1);
 await expect(modeItem).toContainText(mode==='global'?'全部代理':'直连');
 await modeItem.locator('.ds-help-tip').focus();
 await expect(page.getByRole('tooltip')).toContainText(mode==='global'?'全部代理：忽略规则，全部流量走当前节点':'直连：忽略规则，全部流量直连');
 await expect(page.getByRole('switch',{name:'应用分流',exact:true})).toHaveCount(0);
 await expect(page).toHaveURL(/#\/rules$/);
 await expect(page.getByRole('menu').first().getByRole('link',{name:'应用分流',exact:true})).toHaveCount(0);
 await mock.expectNoUnexpectedRequests();
});

test('应用分流不显示常用服务或手工进程入口，旧预设记录不冒充安装应用', async ({ page }) => {
  const mock = await openPicker(page);
  await expect(page.getByText('常用服务', { exact: true })).toHaveCount(0);
  await expect(page.getByText('自定义应用', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByText('进程名', { exact: true })).toHaveCount(0);
  await page.getByRole('dialog').locator('.ant-drawer-footer').getByRole('button', { name: '关闭',exact:true }).click();
  await page.evaluate(() => { const h = (window as any).desktopTest; const c = h.getConfig(); c.customAppPresets = [{ id: 'old-service', name: 'Legacy service', emoji: '', geositeTags: ['example'] }]; h.emit('event:configChanged', { newValue: c }); });
  await expect(page.getByText('Legacy service', { exact: true })).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});

test('删除最后一个应用规则仍保持 TUN，首页无接管方式选择', async({page})=>{
 const mock=await openPicker(page);const drawer=page.getByRole('dialog');await drawer.getByRole('combobox',{name:'选择应用',exact:true}).click();await page.getByRole('option',{name:/示例应用/}).click();await drawer.getByRole('button',{name:/保存$/}).click();await expect(drawer).not.toBeVisible();
 await page.locator('tbody tr[data-row-key]').filter({hasText:'示例应用'}).getByRole('button',{name:'删除',exact:true}).click();await page.locator('.ant-popconfirm').getByRole('button',{name:/确定$/}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).desktopTest.getConfig().proxyModeType)).toBe('tun');
 await page.goto('/#/');await expect(page.getByRole('heading',{level:1,name:'节点',exact:true})).toBeVisible();for(const label of ['接管方式','系统代理','全局接管','手动代理'])await expect(page.getByText(label,{exact:true})).toHaveCount(0);
 await mock.expectNoUnexpectedRequests();
});
