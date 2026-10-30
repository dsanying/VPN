import { test, expect } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('pending updates stay dismissible, remain in settings and only apply on an explicit click', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, {
    running: true,
    globalUpdates: {
      checking: false,
      lastCheckedAt: Date.now(),
      items: [
        { kind: 'core', status: 'ready', version: '1.13.9', restart: 'proxy' },
        { kind: 'data', status: 'ready', revision: 'one', restart: 'proxy' },
      ],
    },
  });
  await page.goto('/#/settings');
  const notice = page.locator('.ant-notification-notice').filter({ hasText: '有待生效的更新' });
  await expect(notice).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).desktopTest.calls.filter((call: any) => call.channel === 'update:install')
    )
  ).toEqual([]);
  await notice.locator('.ant-notification-notice-close').click();
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole('main').getByRole('button', { name: '重启代理应用更新', exact: true })
  ).toBeVisible();
  // Repeated status publications do not reopen a dismissed update.
  await page.evaluate(() =>
    (window as any).desktopTest.emit('update:progress', {
      globalUpdates: {
        checking: false,
        lastCheckedAt: Date.now(),
        items: [
          { kind: 'core', status: 'ready', version: '1.13.9', restart: 'proxy' },
          { kind: 'data', status: 'ready', revision: 'one', restart: 'proxy' },
        ],
      },
    })
  );
  await expect(notice).toHaveCount(0);
  await page
    .getByRole('main')
    .getByRole('button', { name: '重启代理应用更新', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).desktopTest.calls
          .filter((call: any) => call.channel === 'update:install')
          .map((call: any) => call.args)
      )
    )
    .toEqual([{ kind: 'core' }]);
  // New content has a distinct revision and reopens the pending notice.
  await page.evaluate(() =>
    (window as any).desktopTest.emit('update:progress', {
      globalUpdates: {
        checking: false,
        lastCheckedAt: Date.now(),
        items: [{ kind: 'data', status: 'ready', revision: 'two', restart: 'proxy' }],
      },
    })
  );
  await expect(notice).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});

test('settings uses one software/core check and removes competing per-type auto-update controls', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  await expect(page.getByText('上次更新检查', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0.1.0', { exact: true })).toBeVisible();
  await expect(page.getByText('1.14.0', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: /自动更新/ })).toHaveCount(0);
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).desktopTest.calls.filter(
            (call: any) => call.channel === 'update:check' && !call.args?.statusOnly
          ).length
      )
    )
    .toBe(1);
  expect(
    await page.evaluate(() =>
      (window as any).desktopTest.calls.some((call: any) => call.channel === 'core-update:check')
    )
  ).toBe(false);
  await mock.expectNoUnexpectedRequests();
});

test('manual version checks ignore unrelated maintenance errors and background loading', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, {
    globalUpdates: {
      checking: true,
      lastCheckedAt: Date.now(),
      items: [
        { kind: 'software', status: 'latest' },
        { kind: 'core', status: 'latest' },
        { kind: 'subscriptions', status: 'error', error: 'Subscription unavailable' },
        { kind: 'data', status: 'error', error: 'Data unavailable' },
      ],
    },
  });
  await page.goto('/#/settings');
  const check = page.getByRole('button', { name: '检查更新', exact: true });
  await expect(check).not.toHaveClass(/ant-btn-loading/);
  await check.click();
  await expect(page.locator('.ant-notification-notice')).toContainText('检查更新成功');
  expect(
    await page.evaluate(() =>
      (window as any).desktopTest.calls.some((call: any) =>
        ['server:speedTest', 'subscription:update', 'connection:checkWebsites'].includes(
          call.channel
        )
      )
    )
  ).toBe(false);
  await mock.expectNoUnexpectedRequests();
});
