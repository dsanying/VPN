import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

/** Automated regression against the installed Electron window, without IPC mocks. */
export async function verifyInstalledUi(application, output) {
  const { expect } = createRequire(path.resolve('web/package.json'))('@playwright/test');
  const page = application.windows().find(candidate => candidate.url().startsWith('file:'));
  if (!page) throw new Error('Installed renderer page is missing');
  const screenshot = name => page.screenshot({ path: path.join(output, name), mask: [page.locator('.ds-desktop-status'), page.locator('.ant-table-tbody'), page.locator('.vpn-connection-graph')] });
  const errors = [];
  const captureError = error => errors.push(error.message);
  page.on('pageerror', captureError);
  try {
    const resize = async (width, height) => application.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith('file:'));
      if (!window) throw new Error('Native main window is missing');
      window.setSize(size.width, size.height);
    }, { width, height });
    await resize(1280, 900);
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
    for (const route of ['nodes', 'connections', 'rules', 'logs', 'settings']) {
      await page.locator(`a[href$="/${route}"]`).click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      assert.ok(await main.locator('button,input,table').count(), `Missing ${route} controls`);
      await screenshot(`installed-${route}.png`);
    }
    await page.getByRole('combobox', { name: /^(语言|Language)$/ }).click();
    await page.getByRole('option', { name: /^(中文|Chinese)$/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
    for (const [mode, label] of [['dark', '深色'], ['light', '浅色']]) {
      await page.getByText(label, { exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await main.evaluate(element => { element.scrollTop = 0; });
      await screenshot(`installed-settings-zh-${mode}.png`);
    }
    await page.getByRole('combobox', { name: '语言' }).click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await resize(800, 600);
    await expect(main).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(800);
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(600);
    // Wait for native resize and existing notification exit animations to settle.
    // Keep the same overflow threshold; a persistent layout defect still fails.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await screenshot('installed-settings-en-short.png');
    const geometry = await main.evaluate(element => ({
      width: element.clientWidth, height: element.clientHeight, scrollHeight: element.scrollHeight,
      viewport: window.innerWidth, rootWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(geometry.width > 0 && geometry.height > 0 && geometry.rootWidth <= geometry.viewport + 1, `Window layout overflow: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.scrollHeight > geometry.height, 'Long settings must scroll inside the window');
    await main.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByRole('button', { name: /^(Restore|Import)$/ })).toBeInViewport();
    await screenshot('installed-settings-en-scrolled.png');
    assert.deepEqual(errors, [], 'Installed renderer emitted an uncaught exception');
    return { routes: 5, themes: ['light', 'dark'], languages: ['zh-CN', 'en-US'], windowSizes: [[1280, 900], [800, 600]] };
  } finally { page.removeListener('pageerror', captureError); }
}
