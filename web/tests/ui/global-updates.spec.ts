import { test, expect } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('pending updates surface only as the persistent sidebar button and apply on an explicit click', async ({
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
  // 更新就绪不再自动弹 toast：入口收敛到侧边栏左下角常驻按钮 + 设置页面板。
  await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).desktopTest.calls.filter((call: any) => call.channel === 'update:install')
    )
  ).toEqual([]);
  // 侧边栏按钮的 accessible name 是 aria-label（重启代理应用更新），按可见文案 + 容器类定位。
  const siderCore = page
    .locator('.ds-basic-layout__sider-update')
    .filter({ hasText: '1.13.9' });
  await expect(siderCore).toBeVisible();
  await expect(page.locator('.ds-basic-layout__sider-update')).toHaveCount(2);
  await expect(
    page.getByRole('main').getByRole('button', { name: '重启代理应用更新', exact: true })
  ).toBeVisible();
  // Repeated status publications do not spawn a toast either.
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
  await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
  // The sidebar button applies the core update on an explicit click.
  await siderCore.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).desktopTest.calls
          .filter((call: any) => call.channel === 'update:install')
          .map((call: any) => call.args)
      )
    )
    .toEqual([{ kind: 'core' }]);
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
