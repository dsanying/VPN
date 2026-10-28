import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('节点列表、分组选项、搜索和应用目标共用地区缓存，打开菜单不触发识别', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, { fixtures: {
    node: { name: '日本名称的节点' },
    measurements: { n1: { latency: 92, testedAt: Date.now(), detail: {
      exit: { countryCode: ' sg ', ip: '192.0.2.1', provider: 'Cloudflare', measuredAt: Date.now() },
    } } },
  } });
  await page.goto('/#/nodes');
  const item = page.locator('.vpn-node-list > li').first();
  await expect(item.locator('.vpn-node-list__identity').getByRole('img', { name: '新加坡', exact: true })).toBeVisible();
  await expect(item.getByText('新加坡', { exact: true })).toHaveCount(0);
  await expect(page.locator('footer').getByRole('img', { name: '新加坡', exact: true })).toBeVisible();
  await expect(page.locator('.ant-cascader').getByRole('img', { name: '新加坡', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const config = (window as any).desktopTest.getConfig();
    await (window as any).electron.ipcRenderer.invoke('config:save', { config: {
      ...config,
      servers: [...config.servers, { ...config.servers[0], id: 'unknown', name: '未知节点' }],
      appRoutingEnabled: true,
      customAppPresets: [{ id: 'app-test', name: '示例应用', installedApplication: { id: 'app-test', name: '示例应用', path: '/Applications/Example.app', processPaths: ['/Applications/Example.app/Contents/MacOS/example'] } }],
      appRules: [{ appId: 'app-test', enabled: true, action: 'proxy' }],
    } });
  });
  const probesBefore = await page.evaluate(() => (window as any).desktopTest.calls.filter((call: any) => call.channel === 'server:speedTest').length);
  const selector = page.getByRole('combobox', { name: '节点', exact: true });
  await selector.click();
  await page.locator('.ant-cascader-menu-item').filter({ hasText: /^自建节点$/ }).click();
  const known = page.locator('.ant-cascader-menu-item[title="日本名称的节点"]');
  await expect(known.getByRole('img', { name: '新加坡', exact: true })).toBeVisible();
  const unknown = page.locator('.ant-cascader-menu-item[title="未知节点"]');
  await expect(unknown.getByRole('img', { name: '未识别', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).desktopTest.emit('event:speedTestDetails', {
    serverId: 'n1', detail: { exit: { countryCode: 'JP', ip: '192.0.2.2', provider: 'Cloudflare', measuredAt: Date.now() } },
  }));
  await expect(known.getByRole('img', { name: '日本', exact: true })).toBeVisible();
  await expect(item.getByRole('img', { name: '日本', exact: true })).toBeVisible();
  await selector.fill('日本名称');
  const result = page.locator('.ant-cascader-menu-item').filter({ hasText: /自建节点.*日本名称/ });
  await expect(result.getByRole('img', { name: '日本', exact: true })).toBeVisible();
  await selector.press('Escape');
  await page.goto('/#/apps');
  await page.locator('tbody tr[data-row-key]').filter({hasText:'示例应用'}).getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('dialog').getByRole('combobox',{name:'指定节点',exact:true}).click();
  await page.locator('.ant-cascader-menu-item').filter({ hasText: /^自建节点$/ }).click();
  await expect(known.getByRole('img', { name: '日本', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).desktopTest.calls.filter((call: any) => call.channel === 'server:speedTest').length)).toBe(probesBefore);
  await mock.expectNoUnexpectedRequests();
});
