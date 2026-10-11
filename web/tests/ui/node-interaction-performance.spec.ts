import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('节点交互仅展示缓存，菜单变化不重新测量完整列表', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('shadowvpn-lang', 'zh-CN');
    const counts = { widths: 0, regions: 0 };
    (window as any).interactionCounts = counts;
    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')!;
    Object.defineProperty(Element.prototype, 'scrollWidth', { ...width, get() { counts.widths++; return width.get!.call(this); } });
    const DisplayNames = Intl.DisplayNames;
    Intl.DisplayNames = new Proxy(DisplayNames, { construct(target, args) { counts.regions++; return Reflect.construct(target, args); } });
  });
  const base = { protocol: 'vless', address: 'example.com', port: 443, uuid: '00000000-0000-4000-8000-000000000001', network: 'tcp', security: 'tls', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
  const servers = Array.from({ length: 120 }, (_, i) => ({ ...base, id: `perf-${i}`, name: `Node ${i}`, subscriptionId: 'perf-sub' }));
  const mock = await installDesktopMock(page, { fixtures: { servers, subscriptions: [{ id: 'perf-sub', name: 'Performance', url: 'https://example.com/sub' }], measurements: Object.fromEntries(servers.map(node => [node.id, { latency: 42, testedAt: Date.now(), detail: { exit: { countryCode: 'JP' } } }])) } });
  await page.goto('/#/nodes');
  await expect(page.locator('.vpn-node-list > li')).toHaveCount(120);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const beforeCalls = await page.evaluate(() => (window as any).desktopTest.calls.length);
  await page.evaluate(() => { (window as any).interactionCounts.widths = 0; (window as any).interactionCounts.regions = 0; });
  const start = performance.now();
  await page.getByRole('combobox', { name: '地区', exact: true }).click();
  await expect(page.getByRole('option', { name: /日本/ })).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const counts = await page.evaluate(() => (window as any).interactionCounts);
  expect(counts.widths).toBeLessThan(120);
  expect(counts.regions).toBe(0);
  console.log('REGION_MENU', JSON.stringify({ ...counts, elapsedMs: Math.round(performance.now() - start) }));
  await page.getByRole('option', { name: /日本/ }).click();
  await expect(page.locator('.vpn-node-list > li')).toHaveCount(120);
  const calls = await page.evaluate((offset) => (window as any).desktopTest.calls.slice(offset).map((call: any) => call.channel), beforeCalls);
  expect(calls.filter((channel: string) => /speedTest|measurements|subscription|config:/.test(channel))).toEqual([]);
  await mock.expectNoUnexpectedRequests();
});

test('静置与切页不轮询状态，启停事件仍更新界面', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  await page.clock.install();
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await expect(page.getByRole('button', { name: '连接代理', exact: true })).toBeVisible();
  const counts = () => page.evaluate(() => (window as any).desktopTest.calls.filter((call: any) => ['proxy:getStatus', 'proxy:getPendingChanges', 'config:get'].includes(call.channel)).length);
  // 先完成启动快照及语言配置事件，再观察静置周期。
  await page.clock.runFor(1000);
  const initial = await counts();
  await page.clock.runFor(6500);
  await page.getByRole('link', { name: '规则', exact: true }).click();
  await expect(page.getByRole('heading', { name: '规则', exact: true })).toBeVisible();
  await page.clock.runFor(6500);
  expect(await counts()).toBe(initial);
  await page.evaluate(() => {
    const testState = (window as any).desktopTest;
    const config = testState.getConfig();
    testState.emit('event:configChanged', { newValue: { ...config, servers: config.servers.map((node: any) => ({ ...node, name: 'Changed' })) } });
  });
  await expect(page.locator('footer .ds-node-identity')).toContainText('Changed');
  await expect.poll(counts).toBe(initial + 2);
  await page.clock.runFor(6500);
  expect(await counts()).toBe(initial + 2);
  await page.clock.resume();
  await page.getByRole('link', { name: '节点', exact: true }).click();
  await page.getByRole('button', { name: '连接代理', exact: true }).click();
  await expect(page.getByRole('button', { name: '断开', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '断开', exact: true }).click();
  await expect(page.getByRole('button', { name: '连接代理', exact: true })).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});

test('字节更新保留出口图，连接数变化才绘图', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/connections');
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.some((call: any) => call.channel === 'stats:subscribe'))).toBe(true);
  await page.evaluate(() => {
    (window as any).perfSnapshot = { source: 'device', at: Date.now(), connections: [{ id: 'one', chains: [], outbound: 'system-network', rule: '', download: 1, upload: 1, metadata: { host: 'example.com', network: 'tcp', processPath: '/Applications/Example.app/Contents/MacOS/Example' } }] };
    (window as any).desktopTest.emit('event:connectionsDetail', (window as any).perfSnapshot);
  });
  await expect(page.locator('.vpn-connection-graph svg')).toBeVisible();
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    (window as any).graphMutations = 0;
    new MutationObserver(records => { (window as any).graphMutations += records.length; }).observe(document.querySelector('.vpn-connection-graph svg')!, { childList: true, subtree: true, attributes: true, characterData: true });
    const snap = (window as any).perfSnapshot;
    (window as any).desktopTest.emit('event:connectionsDetail', { ...snap, connections: snap.connections.map((c: any) => ({ ...c, download: 2048, upload: 1024 })) });
  });
  await expect(page.getByRole('table').getByText('↓ 2.05 KB / ↑ 1.02 KB', { exact: true })).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => (window as any).graphMutations)).toBe(0);
  await page.evaluate(() => {
    const snap = (window as any).perfSnapshot;
    (window as any).desktopTest.emit('event:connectionsDetail', { ...snap, connections: [...snap.connections, { ...snap.connections[0], id: 'two' }] });
  });
  await expect.poll(() => page.evaluate(() => (window as any).graphMutations)).toBeGreaterThan(0);
  await mock.expectNoUnexpectedRequests();
});
