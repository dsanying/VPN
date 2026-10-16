import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('完整节点列表没有分页，筛选排序后末项仍可选用', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(async () => {
    const config = (window as any).desktopTest.getConfig();
    const base = config.servers[0];
    await (window as any).electron.ipcRenderer.invoke('config:save', { config: {
      ...config,
      servers: Array.from({ length: 81 }, (_, i) => ({ ...base, id: `fixture-${80-i}`, name: `Fixture ${String(80-i).padStart(3,'0')}` })),
      selectedServerId: 'fixture-0',
    } });
  });
  const items = page.locator('.vpn-node-list > li');
  await expect(items).toHaveCount(81);
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.locator('.ant-pagination')).toHaveCount(0);
  await expect(items.first()).toContainText('Fixture 080');
  await page.getByRole('combobox', { name: '排序', exact: true }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: /^名称$/ }).click();
  await expect(items.first()).toContainText('Fixture 000');
  await items.last().scrollIntoViewIfNeeded();
  await items.last().getByRole('button', { name: '设为默认', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().selectedServerId)).toBe('fixture-80');
  await expect(items.last().getByRole('button', { name: '当前', exact: true })).toBeDisabled();
  const search = page.getByRole('searchbox', { name: '搜索', exact: true });
  await search.fill('Fixture 080');
  await expect(items).toHaveCount(1);
  await search.fill('missing-fixture');
  await expect(items).toHaveCount(0);
  await expect(page.locator('.ant-empty')).toBeVisible();
  await search.fill('');
  await expect(items).toHaveCount(81);
  await mock.expectNoUnexpectedRequests();
});

for (const lang of ['zh-CN','en-US']) {
  test(`节点列表宽窄窗口全部信息与操作在边界内 ${lang}`, async ({ page }) => {
    await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), lang);
    await installDesktopMock(page, { fixtures: { node: { name: 'A long example node name for a complete readable list' } } });
    await page.goto('/#/nodes');
    const item = page.locator('.vpn-node-list > li').first();
    await expect(item).toBeVisible();
    for (const viewport of [{width:1440,height:900},{width:960,height:600},{width:960,height:440},{width:760,height:440}]) {
      await page.setViewportSize(viewport);
      await item.scrollIntoViewIfNeeded();
      const result = await item.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        const parts = [...el.querySelectorAll('button, dt, dd')].map(part => part.getBoundingClientRect());
        return { bounds:{left:bounds.left,right:bounds.right}, parts:parts.map(r=>({left:r.left,right:r.right})), overflow:document.documentElement.scrollWidth>innerWidth };
      });
      expect(result.overflow).toBe(false);
      for (const part of result.parts) {
        expect(part.left).toBeGreaterThanOrEqual(result.bounds.left);
        expect(part.right).toBeLessThanOrEqual(result.bounds.right);
      }
      await expect(item.getByRole('button')).toHaveCount(3);
      await expect(item.locator('dt')).toHaveCount(2);
    }
  });
}
