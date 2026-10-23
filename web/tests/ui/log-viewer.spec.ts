import { test, expect } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('专用日志查看器本地化级别、文案与来源，并保留多行堆栈', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, {
    fixtures: {
      logs: [
        {
          id: 'a',
          timestamp: '2026-10-01T00:00:00Z',
          level: 'info',
          source: 'Main',
          message: 'Application started',
        },
        {
          id: 'b',
          timestamp: '2026-10-01T00:00:01Z',
          level: 'error',
          source: 'Renderer',
          message: 'Example error',
          stack: 'Error: example\n  at example.ts:12:4',
        },
      ],
    },
  });
  await page.goto('/#/logs');
  const viewer = page.getByRole('region', { name: '实时日志' });
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(viewer).toContainText('[信息]');
  await expect(viewer).toContainText('[主进程]');
  await expect(viewer).toContainText('应用已启动');
  await expect(viewer).toContainText('at example.ts:12:4');
  const info = viewer.locator('[data-log-level="info"]').first();
  const error = viewer.locator('[data-log-level="error"]').first();
  expect(await info.evaluate((el) => getComputedStyle(el).color)).not.toBe(
    await error.evaluate((el) => getComputedStyle(el).color)
  );
  await page.getByLabel('搜索', { exact: true }).fill('example.ts');
  await expect(viewer.locator('mark')).toContainText('example.ts');
  await expect(viewer).not.toContainText('应用已启动');
  await page.getByLabel('搜索', { exact: true }).fill('');
  await page.getByRole('menuitem', { name: '切换语言', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Live logs' })).toContainText('[INFO]');
  await expect(page.getByRole('region', { name: 'Live logs' })).toContainText(
    'Application started'
  );
  await mock.expectNoUnexpectedRequests();
});

test('千条日志保持虚拟滚动，跟随最新可看到最后一条', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const logs = Array.from({ length: 1000 }, (_, i) => ({
    id: `line-${i}`,
    timestamp: '2026-10-01T00:00:00Z',
    level: 'warn',
    source: 'Example',
    message: `example-line-${i}`,
  }));
  const mock = await installDesktopMock(page, { fixtures: { logs } });
  await page.goto('/#/logs');
  const viewer = page.getByRole('region', { name: '实时日志' });
  await expect(viewer).toContainText('example-line-999');
  expect(await viewer.locator('[data-log-level]').count()).toBeLessThan(100);
  const viewport = viewer.locator(".react-lazylog");
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await viewport.hover();
  await page.mouse.wheel(0, -1500);
  await expect(viewer).not.toContainText('example-line-999');
  await page.evaluate(() =>
    (window as any).desktopTest.emit('event:logReceivedBatch', [
      {
        id: 'new',
        timestamp: '2026-10-01T00:00:01Z',
        level: 'info',
        source: 'Main',
        message: 'new-last-log',
      },
    ])
  );
  await expect(viewer).not.toContainText('new-last-log');
  await page.mouse.wheel(0, 100000);
  await expect(viewer).toContainText('new-last-log');
  await page.evaluate(() =>
    (window as any).desktopTest.emit('event:logReceivedBatch', [
      {
        id: 'new2',
        timestamp: '2026-10-01T00:00:02Z',
        level: 'error',
        source: 'Main',
        message: 'new-followed-log',
      },
    ])
  );
  await expect(viewer).toContainText('new-followed-log');
  // 回归：按住指针（拖滚动条/选中文字）会闩住滚动意图；此期间到达的批次重建
  // 虚拟列表产生的回顶滚动不得解除跟随并把视图卡在顶部。
  const box = await viewport.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) {
    await page.evaluate(
      (n) =>
        (window as any).desktopTest.emit('event:logReceivedBatch', [
          {
            id: `held-${n}`,
            timestamp: '2026-10-01T00:00:03Z',
            level: 'info',
            source: 'Main',
            message: `held-batch-${n}`,
          },
        ]),
      i
    );
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.evaluate(() =>
    (window as any).desktopTest.emit('event:logReceivedBatch', [
      {
        id: 'new3',
        timestamp: '2026-10-01T00:00:04Z',
        level: 'info',
        source: 'Main',
        message: 'tail-batch-after-wheel',
      },
    ])
  );
  await expect(viewer).toContainText('tail-batch-after-wheel');
  await expect(viewer).not.toContainText('example-line-0');
  await mock.expectNoUnexpectedRequests();
});

test('日志级别和实际来源可组合多选，清空选择恢复所有日志', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, {
    fixtures: {
      logs: [
        {
          id: 'a',
          timestamp: '2026-10-01T00:00:00Z',
          level: 'info',
          source: 'Subscription',
          message: 'sync-log',
        },
        {
          id: 'b',
          timestamp: '2026-10-01T00:00:01Z',
          level: 'warn',
          source: 'SpeedTest',
          message: 'speed-log',
        },
        {
          id: 'c',
          timestamp: '2026-10-01T00:00:02Z',
          level: 'error',
          source: 'Main',
          message: 'main-log',
        },
        {
          id: 'd',
          timestamp: '2026-10-01T00:00:03Z',
          level: 'fatal',
          source: 'Main',
          message: 'fatal-log',
        },
      ],
    },
  });
  await page.goto('/#/logs');
  const viewer = page.getByRole('region', { name: '实时日志' });
  await expect(viewer).toContainText('sync-log');
  await page.getByRole('combobox', { name: '日志级别', exact: true }).click();
  await page.getByText('警告', { exact: true }).last().click();
  await page.getByText('错误', { exact: true }).last().click();
  await page.keyboard.press('Escape');
  await expect(viewer).toContainText('speed-log');
  await expect(viewer).toContainText('main-log');
  await expect(viewer).not.toContainText('sync-log');
  await expect(viewer).not.toContainText('fatal-log');
  await page.getByRole('combobox', { name: '来源', exact: true }).click();
  await page.getByText('测速', { exact: true }).last().click();
  await page.keyboard.press('Escape');
  await expect(viewer).toContainText('speed-log');
  await expect(viewer).not.toContainText('main-log');
  await page
    .locator('.ant-select')
    .first()
    .getByRole('button', { name: 'Clear', exact: true })
    .click();
  await page
    .locator('.ant-select')
    .nth(1)
    .getByRole('button', { name: 'Clear', exact: true })
    .click();
  await expect(viewer).toContainText('fatal-log');
  await expect(viewer).toContainText('sync-log');
  for (const size of [
    { width: 960, height: 600 },
    { width: 960, height: 440 },
    { width: 640, height: 440 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.getByRole('button', { name: '导出', exact: true })).toBeVisible();
    expect(
      await viewer.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth;
      })
    ).toBe(true);
  }
  await mock.expectNoUnexpectedRequests();
});
