import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const [zone, display] of [
  ['UTC', '2026/01/01 01:15:00'],
  ['America/New_York', '2025/12/31 20:15:00'],
  ['Asia/Kolkata', '2026/01/01 06:45:00'],
  ['Europe/Berlin', '2026/01/01 02:15:00'],
  ['Pacific/Auckland', '2026/01/01 14:15:00'],
]) {
  test.describe(`设备时区 ${zone}`, () => {
    test.use({ timezoneId: zone });
    test('中文日志将同一事件转为设备时间，非法输入显示空态', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
      const mock = await installDesktopMock(page);
      await page.goto('/#/logs');
      await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'logs:get').length)).toBe(1);
      await page.evaluate(() => (window as any).desktopTest.emit('event:logReceivedBatch', [
        { timestamp: '2026-01-01T01:15:00Z', level: 'info', source: 'test', message: '示例时区事件' },
        { timestamp: 'invalid-time', level: 'warn', source: 'test', message: '示例无效时间' },
      ]));
      const viewer = page.getByRole('region', {name: '实时日志'});
      await expect(viewer.getByText('示例时区事件', {exact:false})).toContainText(display);
      await expect(viewer.getByText('示例无效时间', {exact:false})).toContainText('—');
      await expect(page.getByText('2026-01-01T01:15:00Z', { exact: true })).toHaveCount(0);
      await expect(page.getByText('invalid-time', { exact: true })).toHaveCount(0);
      await mock.expectNoUnexpectedRequests();
    });
  });
}
