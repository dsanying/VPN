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
    const icon = page.locator('.ds-brand-header__icon img');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('src', /(?:^data:image\/svg\+xml,|brand-icon.*\.svg)/);
    expect(await icon.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    await expect(page.locator('.ds-desktop-titlebar')).toContainText(brand);
    await mock.expectNoUnexpectedRequests();
  });
}
