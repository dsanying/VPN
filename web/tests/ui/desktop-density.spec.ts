import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';
import { collectOffHeightCharts, expectEfficientSummaryStrips, expectNoForcedWraps, expectNoCellOverflows, expectNoStuckOverflows } from './client-geometry';

for (const language of ['zh-CN', 'en-US']) {
  for (const width of [540, 900, 1440]) {
    test(`客户端状态与指标按内容并排 ${width}px ${language}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), language);
      const mock = await installDesktopMock(page, { running: true });
      await page.goto('/#/connections');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => {
        const ids = ['google', 'youtube', 'instagram', 'facebook', 'twitter', 'telegram', 'tiktok', 'github', 'wikipedia', 'reddit', 'chatgpt', 'claude', 'gemini', 'netflix', 'disney', 'spotify'];
        (window as any).desktopTest.emit('event:unlockUpdated', { results: Object.fromEntries(ids.map(id => [id, { status: id === 'netflix' ? 'blocked' : 'ok', httpStatus: id === 'netflix' ? 451 : 200 }])), checkedAt: Date.now(), egress: { ip: '203.0.113.2' } });
      });
      const websites = page.locator('[data-layout="desktop-section"]').filter({ has: page.getByRole('heading', { name: language === 'zh-CN' ? '网站连通性' : 'Website connectivity', exact: true }) });
      await expect(websites.locator('.ds-summary-strip__item')).toHaveCount(16);
      await expect(websites.getByText('HTTP 200', { exact: true })).toHaveCount(15);
      const geometry = await websites.evaluate(section => {
        const heading = section.querySelector('h2, h3, h4')!.getBoundingClientRect();
        const button = section.querySelector('button')!.getBoundingClientRect();
        const cells = [...section.querySelectorAll('.ds-summary-strip__item')].map(cell => {
          const status = cell.querySelector('.ant-tag')!.getBoundingClientRect();
          const http = cell.querySelector('.client-atomic')!.getBoundingClientRect();
          return { height: cell.getBoundingClientRect().height, centers: Math.abs(status.y + status.height / 2 - http.y - http.height / 2) };
        });
        return { headerOffset: Math.abs(heading.y + heading.height / 2 - button.y - button.height / 2), cells };
      });
      expect(geometry.headerOffset).toBeLessThan(8);
      for (const cell of geometry.cells) { expect(cell.height).toBeLessThan(60); expect(cell.centers).toBeLessThan(4); }
      await expectEfficientSummaryStrips(page);
      await expect.poll(() => collectOffHeightCharts(page)).toEqual([]);
      await expectNoForcedWraps(page);
      await expectNoCellOverflows(page);
      await expectNoStuckOverflows(page);
      await page.goto('/#/nodes');
      await expect(page.getByRole('list', { name: /^(节点|nodes)$/i }).getByRole('listitem')).toHaveCount(1);
      await mock.expectNoUnexpectedRequests();
    });
  }
}
