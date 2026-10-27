import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const fixture of [
  { reason: 'node-dial:ECONNREFUSED; tls-error:ECONNRESET', entry: 'ECONNREFUSED', proxyText: '连接失败', entryText: '连接失败' },
  { reason: 'tls-error:ECONNRESET; fallback:tls-error:ECONNRESET', entry: 'EHOSTUNREACH', proxyText: '连接失败', entryText: '连接失败' },
  { reason: 'unusable', entry: 'ECONNREFUSED', proxyText: '无法确认', entryText: '连接失败' },
  { reason: 'core-not-ready', entry: 'ENOTFOUND', proxyText: '无法确认', entryText: '连接失败' },
  { reason: 'timeout; fallback:timeout', entry: 'ETIMEDOUT', status: 'timeout', proxyText: '超时', entryText: '超时' },
  { reason: undefined, entry: undefined, proxyText: '连接失败', entryText: '连接失败' },
]) {
  test(`节点失败显示明确结果 ${fixture.reason ?? '无详细原因'}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
    const mock = await installDesktopMock(page, { fixtures: { measurements: {
      n1: { latency: -1, testedAt: Date.now(), detail: { entry: { status: fixture.status ?? 'failed', reason: fixture.entry }, proxyReason: fixture.reason, proxyTarget: 'https://example.com/generate_204' } },
    } } });
    await page.goto('/#/nodes');
    const item = page.locator('.vpn-node-list > li').first();
    await expect(item.locator('[data-slot="entry"]').getByText(fixture.entryText, { exact: true })).toBeVisible();
    await expect(item.locator('[data-slot="proxy"]').getByText(fixture.proxyText, { exact: true })).toBeVisible();
    await expect(item.locator('[data-slot]').getByText('—', { exact: true })).toHaveCount(0);
    await mock.expectNoUnexpectedRequests();
  });
}
