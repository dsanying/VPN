import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('real React StrictMode requests reject stale results, preserve manual refresh, and stop after unmount', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: {
      entries: ['tests/ui/request-lifecycle-fixture.html'],
      include: ['react', 'react-dom/client'],
    },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}tests/ui/request-lifecycle-fixture.html`);
    await page.waitForFunction(() => window.requestHarness?.count() === 2);
    await page.evaluate(() => window.requestHarness.resolve(1, 'current'));
    await page.waitForFunction(() =>
      document.querySelector('output').textContent.includes('current')
    );
    await page.evaluate(() => window.requestHarness.resolve(0, 'obsolete mount'));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    assert.equal(await page.locator('output').textContent(), '{"data":"current","loading":false}');
    await page.evaluate(() => window.requestHarness.change(1));
    await page.waitForFunction(() => window.requestHarness.count() === 3);
    assert.equal(await page.locator('output').textContent(), '{"loading":true}');
    await page.evaluate(() => window.requestHarness.change(2));
    await page.waitForFunction(() => window.requestHarness.count() === 4);
    await page.evaluate(() => {
      window.requestHarness.resolve(3, 'latest filter');
      window.requestHarness.reject(2);
    });
    await page.waitForFunction(() =>
      document.querySelector('output').textContent.includes('latest filter')
    );
    assert.equal(
      await page.locator('output').textContent(),
      '{"data":"latest filter","loading":false}'
    );
    await page.evaluate(() => window.requestHarness.manual(true));
    await page.waitForFunction(
      () => document.querySelector('output').textContent === '{"loading":false}'
    );
    assert.equal(await page.evaluate(() => window.requestHarness.count()), 4);
    await page.evaluate(() => {
      void window.requestHarness.run();
    });
    await page.waitForFunction(() => window.requestHarness.count() === 5);
    await page.evaluate(() => window.requestHarness.unmount());
    await page.evaluate(() => window.requestHarness.resolve(4, 'detached'));
    assert.equal(await page.locator('output').count(), 0);
    await page.evaluate(() => {
      void window.requestHarness.run();
    });
    assert.equal(await page.evaluate(() => window.requestHarness.count()), 5);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
