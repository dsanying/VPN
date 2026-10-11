import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const route of ['rules', 'apps', 'connections']) {
  test(`客户端 ${route || 'home'} 默认十条、分页候选及完整记录访问`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
    const mock = await installDesktopMock(page, { running: true, fixtures: {
      logs: Array.from({ length: 21 }, (_, index) => ({ timestamp: 1791374400000 + index, level: 'info', source: 'Example', message: `Log ${index}` })),
      resources: Array.from({ length: 21 }, (_, index) => ({ id: `resource-${index}`, name: `Resource ${index}`, category: 'geoip', sourceUrl: 'https://example.com/rules.srs', fileName: `resource-${index}.srs`, format: 'binary', size: 1, downloadedAt: '', fileExists: true, referencedBy: 0 })),
    } });
    await page.goto('/#/');
    await expect(page.getByRole('heading', { level: 1, name: '节点', exact: true })).toBeVisible();
    await page.evaluate(route => {
      const harness = (window as any).desktopTest;
      const config = harness.getConfig();
      config.servers = Array.from({ length: 21 }, (_, index) => ({ ...config.servers[0], id: `n-${index}`, name: `Node ${index}` }));
      config.customRules = Array.from({ length: 21 }, (_, index) => ({ id: `r-${index}`, type: 'domain', values: [`r-${index}.example.com`], action: 'proxy', enabled: true }));
      config.customAppPresets = Array.from({ length: 21 }, (_, index) => ({ id: `custom-${index}`, name: `Application ${index}`, emoji: '', geositeTags: [], installedApplication: { id: `custom-${index}`, name: `Application ${index}`, path: `/Applications/Example${index}.app`, processPaths: [], processPathRegex: [`^/Applications/Example${index}\\.app/`], coverage: 'bundle' } }));
      if(route==='apps'){config.customRules=[];config.appRoutingEnabled=true;config.appRules=config.customAppPresets.map((p:any)=>({appId:p.id,action:'direct',enabled:true}));}
      harness.emit('event:configChanged', { newValue: config });
    },route);
    if (route) {
      const names: Record<string, string> = { logs: '日志', nodes: '节点', rules: '规则', apps: '规则', resources: '规则资源', connections: '连接' };
      await page.getByRole('link', { name: names[route], exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: names[route], exact: true })).toBeVisible();
    }
    if (!route || route === 'connections') {
      await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', {
        at: Date.now(), connections: Array.from({ length: 21 }, (_, index) => ({ id: `c-${index}`, chains: ['proxy-selector'], outbound: 'proxy-selector', download: 1, upload: 1, metadata: { host: `c-${index}.example.com`, network: 'tcp' } })),
      }));
    }
    const section = page;
    const table = section.getByRole('table');
    await expect(table.locator('tbody tr[data-row-key]')).toHaveCount(10);
    const paging = section.locator('.ant-pagination');
    await expect(paging.locator('.ant-pagination-options')).toContainText('10');
    await paging.getByRole('combobox').click();
    await expect(page.getByRole('option')).toHaveCount(4);
    for (const size of [10, 20, 50, 100]) await expect(page.getByRole('option', { name: new RegExp(`^${size} `) })).toBeVisible();
    await page.getByRole('option', { name: /^20 / }).click();
    await expect(table.locator('tbody tr[data-row-key]')).toHaveCount(20);
    await paging.locator('.ant-pagination-next button').click();
    await expect(paging.locator('.ant-pagination-item-active')).toHaveText('2');
    await expect(table.locator('tbody tr[data-row-key]')).toHaveCount(1);
    await mock.expectNoUnexpectedRequests();
  });
}

test('分页规则拖动使用完整集合索引，不改第一页记录', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/rules');
  await expect(page.getByRole('table').first()).toBeVisible();
  await page.evaluate(async () => {
    const harness = (window as any).desktopTest;
    const config = harness.getConfig();
    await (window as any).electron.ipcRenderer.invoke('config:save', {...config, customRules: Array.from({ length: 21 }, (_, index) => ({ id: `r-${index}`, type: 'domain', values: [`r-${index}.example.com`], action: 'proxy', enabled: true })) });
  });
  await expect(page.locator('tbody tr[data-row-key]')).toHaveCount(10);
  await page.locator('.ant-pagination-next button').first().click();
  const handle = page.locator('tr[data-row-key="r-10"]');
  await handle.focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().customRules.map((rule: any) => rule.id))).toEqual([...Array.from({ length: 10 }, (_, i) => `r-${i}`), 'r-11', 'r-10', ...Array.from({ length: 9 }, (_, i) => `r-${i + 12}`)]);
  await mock.expectNoUnexpectedRequests();
});
