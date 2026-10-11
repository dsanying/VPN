import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const language of ['zh-CN', 'en-US']) {
  for (const height of [440, 720]) {
    test(`节点负责操作，连接集中展示 ${language} ${height}px`, async ({ page }) => {
      await page.setViewportSize({ width: 960, height });
      await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), language);
      const mock = await installDesktopMock(page);
      const labels = language === 'zh-CN' ? ['节点', '连接', '规则', '日志', '设置'] : ['Nodes', 'Connections', 'Rules', 'Logs', 'Settings'];
      await page.goto('/#/');
      await expect(page).toHaveURL(/#\/nodes$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(labels[0]);
      const links = page.getByRole('menu').first().getByRole('link');
      await expect(links).toHaveCount(5);
      expect((await links.allTextContents()).slice(0, 2)).toEqual(labels.slice(0, 2));
      const connect = page.getByRole('button', { name: language === 'zh-CN' ? '连接代理' : 'Connect', exact: true });
      await expect(connect).toBeVisible();
      await expect(page.locator('[data-chart-fit="content"]')).toHaveCount(0);
      await connect.click();
      await expect(page.getByRole('button', { name: language === 'zh-CN' ? '断开' : 'Disconnect', exact: true })).toBeVisible();
      await links.nth(1).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(labels[1]);
      await expect(page.getByRole('table')).toHaveCount(1);
      await expect(connect).toHaveCount(0);
      await expect(page.getByRole('searchbox')).toHaveCount(1);
      await expect(page.locator('[data-layout="desktop-section"]').getByRole('link')).toHaveCount(16);
      await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', { at: Date.now(), connections: [
        { id: 'app', chains: ['direct'], outbound: 'direct', metadata: { host: 'app.example.com', processPath: '/Applications/Example.app/Contents/MacOS/Example' } },
        { id: 'system', chains: ['direct'], outbound: 'direct', metadata: { host: 'system.example.com', processPath: '/usr/libexec/apsd' } },
      ] }));
      await expect(page.getByRole('table').getByText('system.example.com', { exact: true })).toBeAttached();
      await expect(page.locator('[data-chart-fit="content"]')).toHaveCount(1);
      const graph = page.locator('.vpn-connection-graph');
      await expect(graph).toHaveCount(1);
      await expect(graph.getByText(/apsd/)).toBeVisible();
      await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
      await expect(page.getByRole('contentinfo')).toBeInViewport();
      await mock.expectNoUnexpectedRequests();
    });
  }
}
