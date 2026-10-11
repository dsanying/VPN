import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const language of ['zh-CN', 'en-US']) {
  for (const height of [600, 440]) {
    test(`subscription quota remains complete at 960×${height}, ${language}`, async ({ page }) => {
      await page.setViewportSize({ width: 960, height });
      await page.addInitScript((lang) => localStorage.setItem('shadowvpn-lang', lang), language);
      const mock = await installDesktopMock(page, {
        fixtures: {
          subscriptions: [
            {
              id: 'quota',
              name: 'Quota',
              url: 'https://example.com/quota',
              lastUpdated: '2026-10-10T02:30:00Z',
              userInfo: {
                used: 25e9,
                total: 100e9,
                expire: 1893456000,
                balance: 12,
                currency: 'CNY',
              },
            },
            {
              id: 'partial',
              name: 'Partial',
              url: 'https://example.com/partial',
              userInfo: { remaining: 5e9 },
            },
            {
              id: 'exhausted',
              name: 'Exhausted',
              url: 'https://example.com/exhausted',
              userInfo: { used: 120e9, total: 100e9 },
            },
            { id: 'zero', name: 'Zero', url: 'https://example.com/zero', userInfo: { total: 0 } },
          ],
        },
      });
      await page.goto('/#/nodes/groups');
      const quota = page.locator('.ds-subscription-quota');
      await expect(quota).toHaveCount(4);
      await expect(quota.nth(0)).not.toContainText('25 GB');
      await expect(quota.nth(0)).toContainText('100 GB');
      await expect(quota.nth(0)).toContainText('75 GB');
      await expect(quota.nth(0).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
      await expect(quota.nth(1)).toContainText('—');
      await expect(quota.nth(1).getByRole('progressbar')).toHaveCount(0);
      await expect(quota.nth(2)).not.toContainText('120 GB');
      await expect(quota.nth(2)).toContainText('0 B');
      await expect(quota.nth(3).getByRole('progressbar')).toHaveCount(0);
      for (const element of await quota.all()) {
        expect(await element.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      await expect(page.getByRole('table').getByRole('button', {name: language === 'zh-CN' ? '同步' : 'Sync', exact: true})).toHaveCount(4);
      await mock.expectNoUnexpectedRequests();
    });
  }
}
