import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const [language, brand] of [['zh-CN', '暗影VPN'], ['en-US', 'DSVPN']]) {
  test(`产品名跟随语言 ${language}`, async ({ page }) => {
    await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), language);
    const mock = await installDesktopMock(page);
    await page.goto('/#/nodes');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(brand);
    await expect(page.locator('.ds-brand-header__title')).toHaveText(brand);
    await expect(page.locator('.ds-desktop-titlebar')).toContainText(brand);
    await mock.expectNoUnexpectedRequests();
  });
}
