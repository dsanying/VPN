import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const language of ['zh-CN', 'en-US']) {
  test(`恢复历史测速和实际出口地区 ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), language);
    const mock = await installDesktopMock(page, { fixtures: { measurements: {
      n1: { latency: 42, testedAt: Date.now() - 7 * 3600000, detail: { entry: { status: 'ok', latencyMs: 12 }, exit: { ip: '192.0.2.1', countryCode: 'US', measuredAt: Date.now() - 7 * 3600000, provider: 'Cloudflare' } } },
    } } });
    await page.goto('/#/nodes');
    const table = page.getByRole('list', { name: language === 'zh-CN' ? '节点' : 'Nodes', exact: true });
    await expect(table.getByRole('img', { name: language === 'zh-CN' ? '美国' : 'United States', exact: true })).toBeVisible();
    await expect(table.locator('.ds-application-icon img')).toBeVisible();
    expect(await table.locator('.ds-application-icon img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(table.getByText('42 ms', { exact: true })).toBeVisible();
    await expect(table.getByText(language === 'zh-CN' ? '历史记录' : 'Historical record', { exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).desktopTest.emit('event:configChanged', { newValue: (window as any).desktopTest.getConfig() }));
    await expect(table.getByText('42 ms', { exact: true })).toBeVisible();
    await page.reload();
    await expect(table.getByText('42 ms', { exact: true })).toBeVisible();
    await mock.expectNoUnexpectedRequests();
  });
}
