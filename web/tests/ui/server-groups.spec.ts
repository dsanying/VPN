import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('节点与应用目标按组选择，父组不提交，搜索与清空保留节点ID语义', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(async () => {
    const runtime = (window as any).desktopTest;
    const config = runtime.getConfig();
    const node = config.servers[0];
    await (window as any).electron.ipcRenderer.invoke('config:save', { config: {
      ...config,
      subscriptions: [{ id: 'sub-a', name: '订阅 A', url: 'https://example.com/a' }, { id: 'sub-b', name: '订阅 B', url: 'https://example.com/b' }],
      servers: [{ ...node, subscriptionId: 'sub-a' }, { ...node, id: 'n2', name: '另一节点', subscriptionId: 'sub-b' }],
      appRoutingEnabled: true,
      customAppPresets: [{ id: 'app-test', name: '示例应用', installedApplication: { id: 'app-test', name: '示例应用', path: '/Applications/Example.app', processPaths: ['/Applications/Example.app/Contents/MacOS/example'] } }],
      appRules: [{ appId: 'app-test', enabled: true, action: 'proxy' }],
    } });
  });
  const selector = page.getByRole('combobox', { name: '节点', exact: true });
  await selector.click();
  await page.locator('.ant-cascader-menu-item').filter({ hasText: /^订阅 B$/ }).click();
  expect(await page.evaluate(() => (window as any).desktopTest.getConfig().selectedServerId)).toBe('n1');
  await page.locator('.ant-cascader-menu-item[title="另一节点"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().selectedServerId)).toBe('n2');
  await selector.fill('示例节点');
  await page.locator('.ant-cascader-menu-item').filter({ hasText: /订阅 A.*示例节点/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().selectedServerId)).toBe('n1');
  await page.goto('/#/apps');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('tbody tr[data-row-key]').filter({hasText:'示例应用'}).getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('dialog').getByRole('combobox', { name: '指定节点',exact:true }).click();
  await page.locator('.ant-cascader-menu-item').filter({ hasText: /^订阅 B$/ }).click();
  await page.locator('.ant-cascader-menu-item[title="另一节点"]').click();
  await page.getByRole('dialog').getByRole('button',{name:/保存$/}).click();
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().customRules[0].targetServerId)).toBe('n2');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('tbody tr[data-row-key]').filter({hasText:'示例应用'}).getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('dialog').getByRole('combobox',{name:'指定节点',exact:true}).scrollIntoViewIfNeeded();
  await page.getByRole('dialog').locator('.ant-cascader').getByRole('button',{name:'Clear',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.ant-cascader')).not.toContainText('另一节点');
  await page.getByRole('dialog').getByRole('button',{name:/保存$/}).click();
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().customRules[0].targetServerId)).toBeUndefined();
  await mock.expectNoUnexpectedRequests();
});
