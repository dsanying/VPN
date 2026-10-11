import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('连接帧携带目录外应用图标，路径缺失保留系统名称或 PID', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, { running: true });
  await page.goto('/#/connections');
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.filter((call: any) => call.channel === 'stats:subscribe' && call.args.topic === 'detail').length)).toBe(1);
  await page.evaluate(() => {
    const path = '/Users/example/dev/Electron.app';
    (window as any).desktopTest.emit('event:connectionsDetail', {
      at: Date.now(), applications: [{ id: 'observed', name: 'Electron', path, processPaths: [], processPathRegex: [], coverage: 'bundle', iconDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNQWlX+nxLMMGrAqAGjBgwXAwAmy0IfBEOHvQAAAABJRU5ErkJggg==' }],
      connections: [
        { id: 'dev', chains: [], metadata: { host: 'dev.example.com', processPath: `${path}/Contents/Frameworks/Helper.app/Contents/MacOS/Helper` } },
        { id: 'named', chains: [], metadata: { host: 'named.example.com', processId: 42, processName: 'Example Helper' } },
        { id: 'pid', chains: [], metadata: { host: 'pid.example.com', processId: 43 } },
      ],
    });
  });
  const dev = page.getByRole('row').filter({ hasText: 'dev.example.com' });
  await expect(dev.getByText('Electron', { exact: true })).toBeVisible();
  await expect(dev.locator('.ds-application-icon img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(page.getByRole('row').filter({ hasText: 'named.example.com' }).getByText('Example Helper', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'pid.example.com' }).getByText('PID 43', { exact: true })).toBeVisible();
  await expect(page.locator('.vpn-connection-graph')).not.toContainText('▦');
  await mock.expectNoUnexpectedRequests();
});
