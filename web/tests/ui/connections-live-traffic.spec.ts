import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';
import { collectOffHeightCharts } from './client-geometry';

test('未连接时设备连接完整显示，应用视角和连接看板均可用', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, { running: false });
  await page.goto('/#/connections');
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'stats:subscribe' && c.args.topic === 'detail').length)).toBe(1);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', (window as any).deviceSnapshot = {
    source: 'device', at: Date.now(), connections: Array.from({ length: 31 }, (_, i) => ({
      id: `device-${i}`, chains: [], rule: '', outbound: 'system-network',
      metadata: { processPath: '/Applications/Example.app/Contents/MacOS/Example', destinationIP: '192.0.2.1', destinationPort: String(1000 + i), network: 'tcp' },
    })),
  }));
  await expect(page.getByText('共 31 条数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '连接出口图', exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByText('系统网络', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table').getByText('示例应用', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table').locator('.ds-application-icon img').first()).toBeVisible();
  await page.getByRole('link', { name: '节点', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('节点');
  await page.getByRole('link', { name: '连接', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'stats:subscribe' && c.args.topic === 'detail').length)).toBe(2);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', (window as any).deviceSnapshot));
  await expect(page.getByText('共 31 条数据', { exact: true })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.locator('.ant-pagination-next button').click();
  await expect(page.getByRole('table').getByText('192.0.2.1:1030', { exact: true })).toHaveCount(1);
  await expect(page.locator('.ant-pagination-item-active')).toHaveText('4');
  expect(await page.evaluate(() => (window as any).desktopTest.calls.some((c: any) => c.channel === 'proxy:start'))).toBe(false);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', { source: 'device', at: Date.now(), connections: [], unavailable: true }));
  await expect(page.getByText('无法读取设备连接', { exact: true })).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});

test('网站名称通过宿主打开官网，保留页面与测试结果', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, { running: false });
  await page.goto('/#/connections');
  const websites = page.locator('[data-layout="desktop-section"]').last();
  await expect(websites.getByRole('link')).toHaveCount(16);
  await websites.getByRole('button', { name: '刷新', exact: true }).click();
  const link = websites.getByRole('link', { name: 'YouTube', exact: true });
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/');
  await link.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'shell:openExternal').map((c: any) => c.args))).toEqual(['https://www.youtube.com/']);
  await expect(page).toHaveURL(/#\/connections$/);
  await expect(websites.getByText('HTTP 200', { exact: true })).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});

test('未连接时可以检测普通网络，不再订阅速度统计', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, { running: false });
  await page.goto('/#/connections');
  const websites = page.locator('[data-layout="desktop-section"]').last();
  await expect(websites.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
  await websites.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(websites.getByText('普通网络', { exact: true })).toBeVisible();
  await expect(websites.getByText('HTTP 200', { exact: true })).toBeVisible();
  await expect(page.getByText('网站连通性成功', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).desktopTest.calls.some((c: any) => c.channel === 'stats:subscribe' && c.args.topic === 'stats'))).toBe(false);
  await expect(page.getByText('选择代理分流方式后再检测节点网络。', { exact: true })).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});
test('直连模式下网站检测仍可用', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, { running: true });
  await page.goto('/#/connections');
  await page.getByRole('link', { name: '节点', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('节点');
  await page.getByText('直连', { exact: true }).click();
  await page.getByRole('link', { name: '连接', exact: true }).click();
  const websites = page.locator('[data-layout="desktop-section"]').last();
  await expect(websites.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
  await websites.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(websites.getByText('普通网络', { exact: true })).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});

async function prepare(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, { running: true });
  await page.goto('/#/connections');
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'stats:subscribe' && c.args.topic === 'detail').length)).toBe(1);
  return mock;
}
test('移除速度趋势与常驻订阅，保留连接明细和停止清空行为', async ({ page }) => {
  const mock = await prepare(page);
  await expect(page.getByRole('img', { name: '下载与上传趋势', exact: true })).toHaveCount(0);
  await expect(page.getByText('最近 2 分钟', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).desktopTest.calls.some((c: any) => c.channel === 'stats:subscribe' && c.args.topic === 'stats'))).toBe(false);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', {
    connections: [{ id: 'sample', outbound: 'direct', download: 2048, upload: 1024, metadata: { host: 'example.com', network: 'tcp', processPath: '/Applications/Example.app/Contents/MacOS/Example' } }], at: Date.now(),
  }));
  await expect(page.getByRole('table').getByText('↓ 2.05 KB / ↑ 1.02 KB', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '节点', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('节点');
  await page.getByRole('button', { name: '关闭代理', exact: true }).click();
  await page.getByRole('link', { name: '连接', exact: true }).click();
  await expect(page.getByRole('table').locator('.ant-empty-description')).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});
test('出口图与明细使用完整连接，保留未知和系统进程', async ({ page }) => {
  const mock = await prepare(page);
  await page.evaluate(() => {
    const connections = Array.from({ length: 42 }, (_, i) => ({ id: `c-${i}`, chains: ['selector', `node-${i % 2}`], outbound: i === 40 ? undefined : `node-${i % 2}`, rule: 'rule_set=>proxy', rulePayload: '', download: 2048, upload: 1024, metadata: { sourceIP: '192.0.2.8', sourcePort: '50505', host: i === 40 ? undefined : `target-${i}.example.com`, network: 'tcp', processPath: i === 40 ? undefined : i === 41 ? '/usr/libexec/apsd' : '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' } }));
    connections[40].chains = [];
    (window as any).scopeSnapshot = { connections, at: Date.now() };
    (window as any).desktopTest.emit('event:connectionsDetail', (window as any).scopeSnapshot);
  });
  await expect(page.getByText('共 42 条数据', { exact: true })).toBeVisible();
  await expect(page.getByText('共 42 条数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '连接出口图', exact: true })).toBeVisible();
  await expect.poll(() => collectOffHeightCharts(page)).toEqual([]);
  await expect(page.getByRole('table').getByText('示例应用', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table').locator('.ds-application-icon img').first()).toBeVisible();
  await expect(page.getByRole('table').getByText('示例应用', { exact: true }).first()).toBeVisible();
  await page.getByRole('searchbox',{name:'连接',exact:true}).fill('未识别应用');
  await expect(page.getByRole('table').getByText('未识别应用', { exact: true })).toHaveCount(1);
  await page.getByRole('searchbox',{name:'连接',exact:true}).fill('');
  await expect(page.getByRole('region', { name: '连接出口图', exact: true }).getByText(/^apsd · 1$/)).toBeVisible();
  await expect(page.getByRole('region', { name: '连接出口图', exact: true }).getByText(/^未识别应用 · 1$/)).toBeVisible();
  await page.getByRole('searchbox', { name: '连接', exact: true }).fill('apsd');
  await expect(page.getByRole('region', { name: '连接出口图', exact: true }).getByText(/^apsd · 1$/)).toBeVisible();
  await expect(page.getByText('共 1 条数据', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '连接', exact: true }).fill('');
  await expect(page.getByText('当前没有活动连接', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '节点', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('节点');
  await page.getByRole('link', { name: '连接', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'stats:subscribe' && c.args.topic === 'detail').length)).toBe(2);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', (window as any).scopeSnapshot));
  await expect(page.getByText('共 42 条数据', { exact: true })).toBeVisible();
  // Complete-set ordering no longer promises unknown records on the final page.
  const allRows:string[]=[];
  for(let pageIndex=0;pageIndex<5;pageIndex++) {
    allRows.push(...await page.getByRole('table').locator('tbody tr[data-row-key]').allTextContents());
    if(pageIndex<4)await page.locator('.ant-pagination-next button').click();
  }
  expect(allRows).toHaveLength(42);
  expect(allRows.join('\n')).toContain('未识别目标');
  expect(allRows.join('\n')).toContain('未识别出口');
  expect(allRows.join('\n')).toContain('apsd');
  expect(allRows.join('\n')).toContain('未识别应用');
  await mock.expectNoUnexpectedRequests();
});
test('异常上限不伪装成完整快照', async ({ page }) => {
  const mock = await prepare(page);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', { connections: [], at: Date.now(), limited: true }));
  await expect(page.getByText('连接数量触发保护上限，当前快照不完整，不能代表全部连接。', { exact: true })).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});

test('桑基图合并出口，图表按搜索过滤，完整明细独立保留，清除后恢复全部真实连接', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-theme', 'dark'));
  const mock = await prepare(page);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', {
    connections: Array.from({ length: 26 }, (_, i) => ({
      id: `route-${i}`, chains: [], outbound: i === 25 ? 'direct' : 'Example node', rule: 'rule_set=example',
      metadata: { host: `target-${i}.example.com`, processPath: i === 24 ? '/Applications/Other.app/Contents/MacOS/Other' : '/Applications/Example.app/Contents/MacOS/Example', destinationPort: '443' },
    })), at: Date.now(),
  }));
  const region = page.getByRole('region', { name: '连接出口图', exact: true });
  const search = page.getByRole('searchbox', { name: '连接', exact: true });
  await expect(region.locator('svg')).toBeVisible();
  // One shared exit node per actual outbound, not one duplicate per application/route.
  await expect(region.locator('text').filter({ hasText: /^Example node · 25$/ })).toHaveCount(1);
  await expect(region.locator('text').filter({ hasText: /^直连 · 1$/ })).toHaveCount(1);
  // Both the known application and unidentified process have a visible native/fallback icon.
  await expect(region.locator('image')).toHaveCount(2);
  await expect(region.locator('image').last()).toHaveAttribute('href', /^data:image\//);
  await expect(region.locator('text').filter({ hasText: /^示例应用 · 25$/ })).toHaveCount(1);
  // Literal chart colors must follow live theme changes, including rich application labels.
  for (const mode of ['light', 'dark']) {
    await page.getByRole('menuitem', { name: '切换亮暗主题' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(mode);
    await expect.poll(() => region.locator('text').filter({ hasText: /^示例应用 · 25$/ }).evaluate(element => {
      const expected = getComputedStyle(document.documentElement).getPropertyValue('--ds-color-text').trim();
      return element.getAttribute('fill')?.toLowerCase() === expected.toLowerCase();
    })).toBe(true);
  }
  await page.locator('.ant-pagination-next button').click();
  await search.fill('TARGET-24');
  await expect(page.getByText('共 1 条数据', { exact: true })).toBeVisible();
  await expect(region.locator('text').filter({ hasText: /^Other · 1$/ })).toHaveCount(1);
  await expect(region.locator('text').filter({ hasText: /^Example node · 1$/ })).toHaveCount(1);
  await expect(region.locator('text').filter({ hasText: /^直连/ })).toHaveCount(0);
  await search.fill('直连 443');
  await expect(region.locator('text').filter({ hasText: /^直连 · 1$/ })).toHaveCount(1);
  await search.fill('does-not-exist');
  await expect(region).toHaveCount(0);
  await expect(page.getByRole('region', { name: '连接出口图', exact: true })).toHaveCount(0);
  await expect(page.getByRole('table').locator('.ant-empty-description')).toBeVisible();
  await expect(page.getByText('当前没有活动连接', { exact: true })).toHaveCount(0);
  await search.fill('');
  await expect(page.getByText('共 26 条数据', { exact: true })).toBeVisible();
  await expect(region.locator('text').filter({ hasText: /^Example node · 25$/ })).toHaveCount(1);
  await expect(page.locator('.ant-pagination-item-active')).toHaveText('1');
  await mock.expectNoUnexpectedRequests();
});

for (const [width, theme, language] of [[320, 'dark', 'zh-CN'], [1440, 'light', 'en-US']] as const) {
  test(`桑基图完整保留密集分组，窄窗口局部滚动与标签间距 ${width} ${theme} ${language}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(({ theme, language }) => {
      localStorage.setItem('shadowvpn-theme', theme);
      localStorage.setItem('shadowvpn-lang', language);
    }, { theme, language });
    const mock = await installDesktopMock(page, { running: true });
    await page.goto('/#/connections');
    await expect.poll(() => page.evaluate(() => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'stats:subscribe' && c.args.topic === 'detail').length)).toBe(1);
    await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', {
      connections: Array.from({ length: 240 }, (_, i) => ({
        id: `dense-${i}`, chains: [], outbound: i < 200 ? 'Proxy node' : 'direct', rule: '',
        metadata: { host: `target-${i < 200 ? 0 : i - 199}.example.com`, network: 'tcp', processPath: `/Applications/Target-${i < 200 ? 0 : i - 199}.app/Contents/MacOS/Example` },
      })), at: Date.now(),
    }));
    const region = page.locator('.vpn-connection-graph');
    await expect(region.locator('svg')).toBeVisible();
    const labels = region.locator('svg text').filter({ hasText: /^Target-/ });
    await expect(labels).toHaveCount(41);
    const bounds = await labels.evaluateAll(labels => labels.map(label => {
      const box = label.getBoundingClientRect(); return { y: box.y, bottom: box.bottom, height: box.height };
    }).sort((a, b) => a.y - b.y));
    for (let i = 1; i < bounds.length; i++) expect(bounds[i].y - bounds[i - 1].bottom).toBeGreaterThan(0);
    await region.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
    expect(await region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await region.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(336);
    await mock.expectNoUnexpectedRequests();
  });
}


test('网站在顶部，应用点和出口点单独筛选，连线交集筛选完整明细', async ({ page }) => {
  const mock = await prepare(page);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', {
    source: 'proxy', at: Date.now(), connections: [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `a-${i}`, outbound: i < 8 ? 'Node A' : 'direct', chains: [], metadata: { host: `a-${i}.example.com`, network: 'tcp', processPath: '/Applications/Example.app/Contents/MacOS/Example' } })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `b-${i}`, outbound: 'Node A', chains: [], metadata: { host: `b-${i}.example.com`, network: 'udp', processPath: '/Applications/Other.app/Contents/MacOS/Other' } })),
      { id: 'unknown', outbound: 'direct', chains: [], metadata: { host: 'unknown.example.com', network: 'tcp' } },
    ],
  }));
  const region = page.getByRole('region', { name: '连接出口图', exact: true });
  const website = page.getByRole('heading', { name: '网站连通性', exact: true });
  expect((await website.boundingBox())!.y).toBeLessThan((await region.boundingBox())!.y);
  await expect(page.getByText('共 16 条数据', { exact: true })).toBeVisible();
  await region.locator('text').filter({ hasText: /^示例应用 · 12$/ }).click();
  await expect(page.getByText('共 12 条数据', { exact: true })).toBeVisible();
  await region.locator('text').filter({ hasText: /^Node A · 11$/ }).click();
  await expect(page.getByText('共 11 条数据', { exact: true })).toBeVisible();
  // Click the app→exit band at its observed midpoint, away from either node rectangle.
  const paths = await region.locator('path').evaluateAll(elements => elements.map((element, index) => {
    const box = element.getBoundingClientRect();
    return { index, x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height, d: element.getAttribute('d') ?? '' };
  }));
  const edges = paths.filter(path => path.width > 80 && path.height > 12 && path.d.includes('C')).sort((a, b) => b.x - a.x || a.y - b.y);
  expect(edges.length).toBeGreaterThan(1);
  // Identify the actual band through its visible tooltip; adding groups changes SVG path order.
  const targetBand = page.getByText('示例应用 → Node A · 8', { exact: true });
  let selectedEdge: typeof edges[number] | undefined;
  for (const edge of edges) {
    await page.mouse.move(edge.x, edge.y);
    if (await targetBand.isVisible()) { selectedEdge = edge; break; }
  }
  expect(selectedEdge).toBeDefined();
  await page.mouse.click(selectedEdge!.x, selectedEdge!.y);
  await expect(page.getByText('共 8 条数据', { exact: true })).toBeVisible();
  for (const name of ['应用程序','出口']) {
    const filter=page.locator('.client-filter-select').filter({has:page.getByRole('combobox',{name,exact:true})});
    await filter.hover();await filter.getByRole('button',{name:'Clear',exact:true}).click();
  }
  await expect(page.getByText('共 16 条数据', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '连接', exact: true }).fill('unknown.example.com');
  await expect(page.getByRole('table').getByText('未识别应用', { exact: true })).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});

test('首帧仅有开发客户端和系统连接时立即显示出口图，无需等待已安装应用产生流量', async ({ page }) => {
  const mock = await prepare(page);
  await page.evaluate(() => (window as any).desktopTest.emit('event:connectionsDetail', {
    connections: [
      { id: 'runtime', chains: [], outbound: 'Example node', metadata: { host: 'example.com', processPath: '/Users/example/project/node_modules/electron/Electron.app/Contents/MacOS/Electron' } },
      { id: 'system', chains: [], outbound: 'direct', metadata: { host: 'example.com', processPath: '/usr/libexec/apsd' } },
      { id: 'unknown', chains: [], outbound: 'direct', metadata: { host: 'example.com' } },
    ], at: Date.now(),
  }));
  const region = page.getByRole('region', { name: '连接出口图', exact: true });
  await expect(region.getByText('本机 · 3', { exact: true })).toHaveCount(0);
  await expect(region.getByText('Electron · 1', { exact: true })).toBeVisible();
  await expect(region.getByText('apsd · 1', { exact: true })).toBeVisible();
  await expect(region.getByText('未识别应用 · 1', { exact: true })).toBeVisible();
  await expect(page.getByText('共 3 条数据', { exact: true })).toBeVisible();
  await region.getByText('Electron · 1', { exact: true }).click();
  await expect(page.getByText('共 1 条数据', { exact: true })).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});
