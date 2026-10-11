import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const viewport of [{ width: 1440, height: 900 }, { width: 760, height: 440 }]) {
test(`节点菜单滚动与刷新稳定 ${viewport.width}×${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(async () => {
    const config = (window as any).desktopTest.getConfig();
    const template = config.servers[0];
    await (window as any).electron.ipcRenderer.invoke('config:save', { config: {
      ...config,
      selectedServerId: 'a0',
      subscriptions: ['a', 'b'].map(id => ({ id, name: `订阅 ${id.toUpperCase()}`, url: `https://example.com/${id}` })),
      servers: ['a', 'b'].flatMap(group => Array.from({ length: 80 }, (_, index) => ({ ...template, id: `${group}${index}`, name: `节点 ${group.toUpperCase()} ${String(index).padStart(2, '0')}`, subscriptionId: group }))),
    } });
  });
  const selector = page.getByRole('combobox', { name: '节点', exact: true });
  await selector.click();
  await page.locator('.ant-cascader-menu-item').filter({ hasText: /^订阅 B$/ }).click();
  const menus = page.locator('.ant-cascader-menu');
  const nodes = menus.nth(1);
  await expect(nodes).toContainText('节点 B 79');
  await nodes.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const bottom = await nodes.evaluate(element => element.scrollTop);
  expect(bottom).toBeGreaterThan(0);
  const main = page.locator('main');
  const pageTop = await main.evaluate(element => element.scrollTop);
  await nodes.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => main.evaluate(element => element.scrollTop)).toBe(pageTop);
  await page.evaluate(async () => {
    const config = (window as any).desktopTest.getConfig();
    await (window as any).electron.ipcRenderer.invoke('config:save', { config: { ...config, autoSwitch: !config.autoSwitch } });
  });
  await expect(nodes).toContainText('节点 B 79');
  await expect.poll(() => nodes.evaluate(element => element.scrollTop)).toBe(bottom);
  expect(await page.evaluate(() => (window as any).desktopTest.getConfig().selectedServerId)).toBe('a0');
  await page.keyboard.press('Escape');
  await expect(menus.first()).not.toBeVisible();
  await selector.fill('节点 B');
  await expect(page.locator('.ant-cascader-menu-item')).toHaveCount(80);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().selectedServerId)).toMatch(/^b\d+$/);
  await mock.expectNoUnexpectedRequests();
});
}
