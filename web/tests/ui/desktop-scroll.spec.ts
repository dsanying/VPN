import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const route of ['connections', 'settings']) {
  test(`${route || 'home'} 长页面只在主内容区纵向滚动，窗口框架固定`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
    const mock = await installDesktopMock(page);
    await page.goto(`/#/${route}`);
    const content = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const frame = async () => page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      };
      return { title: rect('.ds-desktop-titlebar'), status: rect('.ds-desktop-status'), sidebar: rect('.ds-basic-layout__sider-footer') };
    });
    const before = await frame();
    await expect.poll(() => content.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await content.evaluate(el => getComputedStyle(el).overflowY)).toBe('scroll');
    const box = (await content.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => content.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await frame()).toEqual(before);
    expect(await page.evaluate(() => ({ document: document.scrollingElement!.scrollTop, frame: document.querySelector('.ds-desktop-body')!.scrollTop }))).toEqual({ document: 0, frame: 0 });
    await content.focus();
    await content.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await expect.poll(() => content.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThan(2);
    expect(await frame()).toEqual(before);
    await page.getByRole('link', { name: '节点', exact: true }).click();
    await expect(page.getByRole('heading', { name: '节点', exact: true })).toBeInViewport();
    await expect.poll(() => content.evaluate(el => el.scrollTop)).toBe(0);
    await page.setViewportSize({ width: 960, height: 440 });
    await expect.poll(async () => {
      const r = await frame();
      const c = (await content.boundingBox())!;
      return c.y >= r.title.bottom - 1 && c.y + c.height <= r.status.top + 1 && r.status.bottom <= 440;
    }).toBe(true);
    await mock.expectNoUnexpectedRequests();
  });
}

test('窄窗口保留顶栏与底栏，设置内容仍可滚动到底', async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 520 });
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  const content = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复', exact: true })).toBeAttached();
  await content.focus();
  await content.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await expect.poll(() => content.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThan(2);
  await expect(page.getByRole('button', { name: '恢复', exact: true })).toBeInViewport();
  await expect(page.locator('.ds-basic-layout__topbar')).toBeInViewport();
  await expect(page.locator('.ds-desktop-status')).toBeInViewport();
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight)).toBeLessThanOrEqual(1);
  await mock.expectNoUnexpectedRequests();
});
