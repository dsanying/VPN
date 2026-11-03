import { test, expect } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('non-software updates auto-apply without prompts; only software keeps the sidebar button', async ({
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
  // 更新就绪不弹任何提示；core/data（非软件）自动应用，无需点击。
  await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).desktopTest.calls
          .filter((call: any) => call.channel === 'update:install')
          .map((call: any) => call.args)
      )
    )
    .toEqual([{ kind: 'core' }, { kind: 'data' }]);
  // 非软件更新不占用侧边栏常驻按钮。
  await expect(page.locator('.ds-basic-layout__sider-update')).toHaveCount(0);
  // 软件更新（restart=software）不自动应用，仍走侧边栏左下角常驻按钮。
  await page.evaluate(() =>
    (window as any).desktopTest.emit('update:progress', {
      globalUpdates: {
        checking: false,
        lastCheckedAt: Date.now(),
        items: [
          { kind: 'core', status: 'latest', version: '1.13.9', restart: 'proxy' },
          { kind: 'data', status: 'applied', revision: 'one', restart: 'proxy' },
          { kind: 'software', status: 'ready', version: '0.4.0', restart: 'software' },
        ],
      },
    })
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).desktopTest.calls
          .filter((call: any) => call.channel === 'update:install')
          .map((call: any) => call.args)
      )
    )
    .toEqual([{ kind: 'core' }, { kind: 'data' }]);
  await expect(page.locator('.ds-basic-layout__sider-update')).toHaveCount(1);
  await expect(
    page.locator('.ds-basic-layout__sider-update').filter({ hasText: '0.4.0' })
  ).toBeVisible();
  // 侧边栏软件更新按钮显式点击才安装。
  await page.locator('.ds-basic-layout__sider-update').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).desktopTest.calls
          .filter((call: any) => call.channel === 'update:install')
          .map((call: any) => call.args)
      )
    )
    .toEqual([{ kind: 'core' }, { kind: 'data' }, { kind: 'software' }]);
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
