import { expectOperationNotification } from './operation-notification';
import { expect, test, registerExpectedConsoleReport } from './console-guard';
import { installDesktopMock } from './desktop-mock';
async function chinese(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
}
async function addNode(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加节点', exact: true }).click();
}
async function editNode(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '更多', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
}
test('自动接管启动展示真实运行态，并可停止', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/');
  await page.getByRole('button', { name: '开启代理', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭代理', exact: true })).toBeVisible({
    timeout: 3000,
  });
  await expect(page.getByText('已连接代理', { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole('contentinfo').getByText('已连接代理', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('连接代理成功', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭代理', exact: true }).click();
  await expect(page.getByRole('button', { name: '开启代理', exact: true })).toBeVisible();
  await expect(page.getByText('未连接代理', { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole('contentinfo').getByText('未连接代理', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('断开成功', { exact: true })).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});
test('编辑节点保留隐藏协议字段，实际提交按钮可用', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await editNode(page);
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('名称', { exact: true }).fill('改名的节点');
  await drawer.getByRole('button', { name: /保存$/ }).click();
  await expect(drawer).not.toBeVisible();
  const payload = await page.evaluate(
    () => (window as any).desktopTest.calls.find((c: any) => c.channel === 'server:update').args
  );
  expect(payload.name).toBe('改名的节点');
  expect(payload.wsSettings.headers).toEqual({ Host: 'example.com' });
  expect(payload.tlsSettings.alpn).toEqual(['h2']);
  await mock.expectNoUnexpectedRequests();
});
test('订阅入口直接使用原 URL，默认自动识别，不生成迁移链接', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加订阅', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('名称', { exact: true }).fill('官方订阅');
  await drawer.getByLabel('订阅地址', { exact: true }).fill('https://example.com/subscription');
  await drawer.getByRole('button', { name: /保存$/ }).click();
  await expect(drawer).not.toBeVisible();
  const requests = await page.evaluate(() =>
    (window as any).desktopTest.calls.filter(
      (c: any) => c.channel.startsWith('subscription:') && c.channel !== 'subscription:measurements'
    )
  );
  expect(requests.map((c: any) => c.channel)).toEqual([
    'subscription:preview',
    'subscription:add',
    'subscription:updateServers',
  ]);
  expect(requests[0].args.url).toBe('https://example.com/subscription');
  expect(requests[1].args.subscription).not.toHaveProperty('protocolPreference');
  await mock.expectNoUnexpectedRequests();
});
test('设置移除密码锁和原始配置入口，保留必要客户端控制', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  await expect(page.getByLabel('本地代理端口', { exact: true })).toBeVisible();
  for (const name of ['设置密码', '隐私锁', '其他设置', '直连地址清单', '控制端口'])
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});
test('空配置提供添加订阅入口，并禁止无节点启动', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, { empty: true });
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: '开启代理', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '添加订阅', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});
test('日志持续接收新帧，仅保留导出与清空操作', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/logs');
  for (const name of ['暂停', '继续', '跟随最新', '刷新'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出', exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as any).desktopTest.emit('event:logReceivedBatch', [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        source: 'Main',
        message: '实时新增日志',
      },
    ])
  );
  await expect(page.locator('.ds-log-viewer').getByText(/实时新增日志/)).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});
test('WireGuard 使用同一个保存按钮，完整提交密钥和本地地址', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, {
    nodeProtocol: 'wireguard',
    fixtures: {
      node: {
        wireguardSettings: {
          privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          peerPublicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
          localAddress: [],
        },
      },
    },
  });
  await page.goto('/#/nodes');
  await addNode(page);
  const drawer = page.getByRole('dialog');
  await drawer
    .getByLabel('节点链接或配置', { exact: true })
    .fill(
      JSON.stringify({
        protocol: 'wireguard',
        name: '示例 WireGuard',
        address: 'example.com',
        port: 443,
        wireguardSettings: {
          privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          peerPublicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
          localAddress: ['10.0.0.2/32'],
        },
      })
    );
  await expect(drawer.getByText('WIREGUARD', { exact: true })).toBeVisible();
  await drawer.getByLabel('名称', { exact: true }).fill('示例 WireGuard');
  await drawer.getByLabel('地址', { exact: true }).fill('example.com');
  const privateKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const publicKey = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
  await drawer.getByLabel('私钥', { exact: true }).fill(privateKey);
  await drawer.getByLabel('公钥', { exact: true }).fill(publicKey);
  await drawer.getByRole('combobox', { name: /本地地址$/ }).fill('10.0.0.2/32');
  await page.getByRole('option', { name: '10.0.0.2/32', exact: true }).click();
  await expect(drawer.getByText('10.0.0.2/32', { exact: true })).toBeVisible();
  await drawer.getByRole('combobox', { name: /本地地址$/ }).press('Escape');
  await drawer.getByRole('button', { name: /保存$/ }).click();
  await expect(drawer).not.toBeVisible();
  const payload = await page.evaluate(
    () => (window as any).desktopTest.calls.find((c: any) => c.channel === 'server:add').args
  );
  expect(payload.protocol).toBe('wireguard');
  expect(payload.wireguardSettings).toMatchObject({
    privateKey,
    peerPublicKey: publicKey,
    localAddress: ['10.0.0.2/32'],
  });
  await mock.expectNoUnexpectedRequests();
});
test('Tailscale 可无地址保存，不被传统代理表单误拦截', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, { nodeProtocol: 'tailscale' });
  await page.goto('/#/nodes');
  await addNode(page);
  const drawer = page.getByRole('dialog');
  await drawer
    .getByLabel('节点链接或配置', { exact: true })
    .fill(JSON.stringify({ protocol: 'tailscale', name: '示例 Tailscale', tailscaleSettings: {} }));
  await expect(drawer.getByText('TAILSCALE', { exact: true })).toBeVisible();
  await drawer.getByLabel('名称', { exact: true }).fill('示例 Tailscale');
  await expect(drawer.getByLabel('地址', { exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: /保存$/ }).click();
  await expect(drawer).not.toBeVisible();
  const payload = await page.evaluate(
    () => (window as any).desktopTest.calls.find((c: any) => c.channel === 'server:add').args
  );
  expect(payload.protocol).toBe('tailscale');
  expect(payload.name).toBe('示例 Tailscale');
  await mock.expectNoUnexpectedRequests();
});
test('Tailscale 登录和取消调用原生接口，授权地址交给系统浏览器', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, { nodeProtocol: 'tailscale' });
  await page.goto('/#/nodes');
  await editNode(page);
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: '登录', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).desktopTest.calls.filter((c: any) => c.channel === 'shell:openExternal')
            .length
      )
    )
    .toBe(1);
  await drawer.getByRole('button', { name: '取消', exact: true }).first().click();
  const calls = await page.evaluate(() => (window as any).desktopTest.calls);
  expect(calls.find((c: any) => c.channel === 'tailscale:login').args.server.id).toBe('n1');
  expect(calls.find((c: any) => c.channel === 'shell:openExternal').args).toBe(
    'https://example.com/login'
  );
  expect(calls.find((c: any) => c.channel === 'tailscale:loginCancel').args.serverId).toBe('n1');
  await mock.expectNoUnexpectedRequests();
});
test('端口完成编辑后才保存一次，不提交逐字输入的中间值', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  const port = page.getByLabel('本地代理端口', { exact: true });
  await port.fill('7777');
  expect(
    await page.evaluate(
      () => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'config:save').length
    )
  ).toBe(0);
  await page.getByRole('heading', { level: 1 }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).desktopTest.calls.filter((c: any) => c.channel === 'config:save').length
      )
    )
    .toBe(1);
  const payload = await page.evaluate(
    () => (window as any).desktopTest.calls.find((c: any) => c.channel === 'config:save').args
  );
  expect(payload.mixedPort).toBe(7777);
  await expect(page.getByText('保存成功', { exact: true })).toHaveCount(1);
  await port.focus();
  await page.getByRole('heading', { level: 1 }).click();
  expect(
    await page.evaluate(
      () => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'config:save').length
    )
  ).toBe(1);
  await mock.expectNoUnexpectedRequests();
});
test('旧隐私状态及旧事件不遮挡客户端，不请求密码接口', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, { locked: true });
  await page.goto('/#/nodes');
  await expect(
    page.getByRole('region', { name: '节点列表' }).getByText('示例节点', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => (window as any).desktopTest.emit('event:enterPrivacyMode', {}));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).desktopTest.calls.filter((c: any) => c.channel.startsWith('privacy:'))
          .length
    )
  ).toBe(0);
  await mock.expectNoUnexpectedRequests();
});
test('备份恢复独立于更新，取消文件选择不修改配置', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: '替换内核', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '回退', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).desktopTest.calls.filter((c: any) => c.channel === 'backup:importPick')
            .length
      )
    )
    .toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).desktopTest.calls.some(
        (c: any) => c.channel === 'backup:importApply' || c.channel === 'config:save'
      )
    )
  ).toBe(false);
  await mock.expectNoUnexpectedRequests();
});

test('统一添加入口可导入文本，提交解析结果而不是伪造节点', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem', { name: '导入节点', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await drawer
    .getByRole('textbox')
    .fill('vless://00000000-0000-4000-8000-000000000002@example.com:443#example');
  await drawer.getByRole('button', { name: /保存$/ }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByText('导入节点成功', { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).desktopTest.calls);
  expect(calls.find((c: any) => c.channel === 'localImport:parse').args.text).toContain(
    'example.com'
  );
  expect(calls.find((c: any) => c.channel === 'server:addBulk').args.servers[0].name).toBe(
    '导入示例'
  );
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '节点列表' }).getByText('导入示例', { exact: true })
  ).toBeVisible();
  await mock.expectNoUnexpectedRequests();
});
test('另存操作保留协议字段，创建独立节点而不改原节点', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await page.getByRole('button', { name: '更多', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '另存为自建节点', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().servers.length))
    .toBe(2);
  const payload = await page.evaluate(
    () => (window as any).desktopTest.calls.find((c: any) => c.channel === 'server:add').args
  );
  expect(payload.id).not.toBe('n1');
  expect(payload.subscriptionId).toBeUndefined();
  expect(payload.wsSettings).toEqual({ path: '/proxy', headers: { Host: 'example.com' } });
  expect(payload.tlsSettings.alpn).toEqual(['h2']);
  expect(
    await page.evaluate(
      () =>
        (window as any).desktopTest.calls.filter((c: any) => c.channel === 'server:update').length
    )
  ).toBe(0);
  await mock.expectNoUnexpectedRequests();
});
test('更多中的删除可取消，失败保留确认框和原节点', async ({ page }) => {
  await chinese(page);
  registerExpectedConsoleReport(page, {
    level: 'error',
    message: '[IPC Client] Error invoking server:delete: Error: Delete rejected',
  });
  registerExpectedConsoleReport(page, {
    level: 'error',
    message: '[Store] Exception deleting server: Error: Delete rejected',
  });
  const mock = await installDesktopMock(page, { failDelete: true });
  await page.goto('/#/nodes');
  await page.getByRole('button', { name: '更多', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  let confirm = page.locator('.ant-popconfirm');
  await confirm.getByRole('button', { name: /取消$/ }).click();
  await expect(confirm).not.toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).desktopTest.calls.filter((c: any) => c.channel === 'server:delete').length
    )
  ).toBe(0);
  await page.getByRole('button', { name: '更多', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  confirm = page.locator('.ant-popconfirm');
  await confirm.getByRole('button', { name: /确定$/ }).click();
  await expect(page.getByText(/Delete rejected/)).toBeVisible();
  await expect(confirm).toBeVisible();
  expect(await page.evaluate(() => (window as any).desktopTest.getConfig().servers.length)).toBe(1);
  await confirm.getByRole('button', { name: /取消$/ }).click();
  await mock.expectNoUnexpectedRequests();
});
test('所有设置直接展示，修改 DNS 保留其他配置', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  await expect(page.getByLabel('直连 DNS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '安装', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeVisible();
  await expect(page.getByText('设置密码', { exact: true })).toHaveCount(0);
  await expect(page.getByText('其他设置', { exact: true })).toHaveCount(0);
  await expect(page.locator('.ant-collapse')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as any).desktopTest.calls.filter((c: any) => c.channel === 'config:save').length
    )
  ).toBe(0);
  const dns = page.getByLabel('直连 DNS', { exact: true });
  await dns.fill('https://example.com/dns-query');
  await page.getByRole('heading', { level: 1 }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).desktopTest.calls.filter((c: any) => c.channel === 'config:save').length
      )
    )
    .toBe(1);
  const payload = await page.evaluate(
    () => (window as any).desktopTest.calls.find((c: any) => c.channel === 'config:save').args
  );
  expect(payload.dnsConfig).toEqual({
    domesticDns: 'https://example.com/dns-query',
    foreignDns: 'https://dns.google/dns-query',
    enableFakeIp: true,
  });
  await mock.expectNoUnexpectedRequests();
});

test('测速跨页结束仍通知，部分不可用不冒充成功', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, { speedFailure: true, deferSpeed: true });
  await page.goto('/#/nodes');
  await page.getByRole('button', { name: '全部测速', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).desktopTest.calls.filter((c: any) => c.channel === 'server:speedTest')
            .length
      )
    )
    .toBe(1);
  await page.getByRole('link', { name: '规则', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '规则', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).finishSpeed());
  await expectOperationNotification(page, '测速完成', '已测 1/1 · 可用 0');
  await page.getByRole('link', { name: '节点', exact: true }).click();
  await expectOperationNotification(page, '测速完成', '已测 1/1 · 可用 0');
  await page.locator('.ant-notification-notice-close').click();
  await expect(page.getByText('测速完成', { exact: true })).toHaveCount(0);
  await expect(page.getByText('测速成功', { exact: true })).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});
test('运行错误跨页可见，同一原因不重复堆叠通知', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/rules');
  await expect(page.getByRole('heading', { level: 1, name: '规则', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const test = (window as any).desktopTest;
    test.emit('event:proxyError', { message: 'Example runtime failure' });
    test.emit('event:proxyError', { message: 'Example runtime failure' });
  });
  await expect(page.getByText('连接代理失败', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Example runtime failure', { exact: true })).toHaveCount(1);
  await mock.expectNoUnexpectedRequests();
});
test('启动被拒绝只显示失败，不能根据点击动作显示成功', async ({ page }) => {
  await chinese(page);
  registerExpectedConsoleReport(page, {
    level: 'error',
    message: '[IPC Client] Error invoking proxy:start: Error: Start rejected',
  });
  const mock = await installDesktopMock(page, { failStart: true });
  await page.goto('/#/');
  await page.getByRole('button', { name: '开启代理', exact: true }).click();
  await expect(page.getByText('连接代理失败', { exact: true })).toBeVisible();
  await expect(page.getByText('连接代理成功', { exact: true })).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});

test('普通设置保存只改对应字段，保留订阅、节点与规则', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  const before = await page.evaluate(() => (window as any).desktopTest.getConfig());
  const port = page.getByLabel('本地代理端口', { exact: true });
  await port.fill('7777');
  await page.getByRole('heading', { level: 1 }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().mixedPort))
    .toBe(7777);
  const after = await page.evaluate(() => (window as any).desktopTest.getConfig());
  for (const key of ['servers', 'subscriptions', 'customRules', 'bypassLANList'])
    expect(after[key]).toEqual(before[key]);
  await mock.expectNoUnexpectedRequests();
});

test('代理延迟常驻卡片，入口延迟降级为提示，实际备用目标可见', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await page.getByRole('button', { name: '全部测速', exact: true }).click();
  await expect(
    page.locator('[data-slot="proxy"]').getByText('92 ms', { exact: true })
  ).toBeVisible();
  // 入口延迟不再是独立槽位（d0a9873 卡片重构），以 tooltip 形式挂在代理延迟上。
  await expect(
    page.locator('[data-slot="proxy"]')
  ).toHaveAttribute('title', '入口延迟 52 ms');
  await expect(page.locator('[data-slot="proxy"] [title="cp.cloudflare.com"]')).toBeAttached();
  await mock.expectNoUnexpectedRequests();
});
test('网站只呈现连通性与地区拒绝，ok 显示实测延迟而非 HTTP 码', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, { running: true });
  await page.goto('/#/connections');
  await expect(page.getByRole('heading', { name: '网站连通性', exact: true })).toBeAttached();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByText('YouTube', { exact: true })).toBeVisible();
  await expect(page.getByText('Instagram', { exact: true })).toBeVisible();
  await expect(page.getByText('38 ms', { exact: true })).toBeVisible();
  await expect(page.getByText('12 ms', { exact: true })).toBeVisible();
  await expect(page.getByText('地区受限', { exact: true })).toBeVisible();
  await expect(page.getByText('连接失败', { exact: true })).toBeVisible();
  await expect(page.getByText('可达', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '节点', exact: true }).click();
  await page.getByText('直连', { exact: true }).click();
  await page.getByRole('link', { name: '连接', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByText('普通网络', { exact: true })).toBeVisible();
  await expect(page.getByText('12 ms', { exact: true })).toBeVisible();
  await expect(page.getByText('可达', { exact: true })).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});

for (const scenario of [
  {
    name: '节点',
    path: 'nodes',
    channel: 'server:update',
    kind: 'node',
    field: '名称',
    value: '保留的示例节点',
    title: '保存失败',
  },
  {
    name: '订阅',
    path: 'nodes',
    channel: 'subscription:preview',
    kind: 'subscription',
    field: '名称',
    value: '保留的示例订阅',
    title: '保存失败',
  },
  {
    name: '导入',
    path: 'nodes',
    channel: 'localImport:parse',
    kind: 'import',
    field: undefined,
    value: 'vless://00000000-0000-4000-8000-000000000002@example.com:443#example',
    title: '导入节点失败',
  },
  {
    name: '规则',
    path: 'rules',
    channel: 'config:save',
    kind: 'rule',
    field: '匹配值',
    value: 'example.com',
    title: '保存失败',
  },
  {
    name: '应用',
    path: 'apps',
    channel: 'config:save',
    kind: 'app',
    field: '选择应用',
    value: '示例应用',
    title: '保存失败',
  },
])
  test(`${scenario.name}操作失败只有右上角通知，保留输入且关闭后无横条`, async ({ page }) => {
    await chinese(page);
    registerExpectedConsoleReport(page, {
      level: 'error',
      message: `[IPC Client] Error invoking ${scenario.channel}: Error: Action rejected`,
      count: 1,
    });
    if (scenario.kind === 'rule')
      registerExpectedConsoleReport(page, {
        level: 'error',
        message: '[Store] Exception saving config: Error: Action rejected',
      });
    if (scenario.kind === 'app')
      registerExpectedConsoleReport(page, {
        level: 'error',
        message: '[Store] Exception saving config: Error: Action rejected',
      });
    const mock = await installDesktopMock(page, { failActionChannel: scenario.channel });
    await page.goto(`/#/${scenario.path}`);
    if (scenario.kind === 'node') await editNode(page);
    else if (scenario.kind === 'subscription' || scenario.kind === 'import') {
      await page.getByRole('button', { name: '管理', exact: true }).click();
      await page.getByRole('button', { name: '添加', exact: true }).click();
      await page
        .getByRole('menuitem', {
          name: scenario.kind === 'subscription' ? '添加订阅' : '导入节点',
          exact: true,
        })
        .click();
    } else {
      await page.getByRole('button', { name: '新增', exact: true }).click();
      await page
        .getByRole('menuitem', {
          name: scenario.kind === 'app' ? '应用规则' : '匹配规则',
          exact: true,
        })
        .click();
    }
    const drawer = page.getByRole('dialog');
    const field = scenario.field
      ? drawer.getByLabel(scenario.field, { exact: true })
      : drawer.getByRole('textbox');
    if (scenario.kind === 'app') {
      await field.click();
      await page.locator('.ant-select-item-option').filter({ hasText: scenario.value }).click();
    } else await field.fill(scenario.value);
    if (scenario.kind === 'subscription') {
      await drawer.getByLabel('订阅地址', { exact: true }).fill('https://example.com/subscribe');
      await expect(drawer.getByRole('status')).toHaveText('读取或解析失败');
    }
    await drawer.getByRole('button', { name: /保存$/ }).click();
    const notice = await expectOperationNotification(page, scenario.title, 'Action rejected');
    await expect(drawer).toBeVisible();
    if (scenario.kind === 'app')
      await expect(drawer.getByText(scenario.value, { exact: true })).toBeVisible();
    else await expect(field).toHaveValue(scenario.value);
    await notice.locator('.ant-notification-notice-close').click();
    await expect(page.getByText('Action rejected', { exact: true })).toHaveCount(0);
    if (scenario.kind === 'app')
      await expect(drawer.getByText(scenario.value, { exact: true })).toBeVisible();
    else await expect(field).toHaveValue(scenario.value);
    if (scenario.kind === 'subscription')
      expect(
        await page.evaluate(
          () =>
            (window as any).desktopTest.calls.filter(
              (call: any) => call.channel === 'subscription:preview'
            ).length
        )
      ).toBe(1);
    await mock.expectNoUnexpectedRequests();
  });
test('显式检查更新在右上角反馈，不插入版本提示行', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expectOperationNotification(page, '检查更新成功');
  await expect(page.locator('.ant-alert')).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});
test('规则资源入口和旧路由已移除', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: '规则资源', exact: true })).toHaveCount(0);
  await page.goto('/#/resources');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '规则资源', exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).desktopTest.calls.filter((c: any) =>
            c.channel.startsWith('ruleResources:')
          ).length
      )
    )
    .toBe(0);
  await mock.expectNoUnexpectedRequests();
});

test('连接页只展示实时数据，持续接收新帧且没有暂停或关闭入口', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, { running: true });
  await page.goto('/#/connections');
  await expect(page.getByRole('heading', { name: '连接', exact: true })).toBeVisible();
  for (const name of ['暂停', '继续', '关闭连接', '关闭'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '操作', exact: true })).toHaveCount(0);
  const frame = async (host: string, id: string) =>
    page.evaluate(
      ({ host, id }) =>
        (window as any).desktopTest.emit('event:connectionsDetail', {
          at: Date.now(),
          connections: [
            {
              id,
              download: 1048576,
              upload: 2097152,
              rule: 'Example',
              metadata: { host, network: 'tcp', sourceIP: '192.0.2.1' },
            },
          ],
        }),
      { host, id }
    );
  await frame('first.example.com', 'first');
  await expect(
    page.getByRole('table').getByText('first.example.com', { exact: true })
  ).toBeVisible();
  await frame('second.example.com', 'second');
  await expect(
    page.getByRole('table').getByText('second.example.com', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('first.example.com', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).desktopTest.calls.filter(
          (c: any) => c.channel.includes('connection') && c.channel.toLowerCase().includes('close')
        ).length
    )
  ).toBe(0);
  await mock.expectNoUnexpectedRequests();
});

test('连接来源用本机应用图标和名称，无法识别时保留进程名称和占位图标', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, { running: true });
  await page.goto('/#/connections');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).desktopTest.calls.filter(
            (c: any) => c.channel === 'stats:subscribe' && c.args.topic === 'detail'
          ).length
      )
    )
    .toBe(1);
  await page.evaluate(() =>
    (window as any).desktopTest.emit('event:connectionsDetail', {
      at: Date.now(),
      connections: [
        {
          id: 'example-app',
          chains: [],
          metadata: {
            host: 'example.com',
            processPath: '/Applications/Example.app/Contents/MacOS/Example',
          },
        },
        {
          id: 'unknown-app',
          chains: [],
          metadata: { host: 'example.org', processPath: '/opt/unknown/example' },
        },
      ],
    })
  );
  const known = page.getByRole('row').filter({ hasText: 'example.com' });
  await expect(known.getByText('示例应用', { exact: true })).toBeVisible();
  await expect(known.locator('.ds-application-icon img')).toBeVisible();
  const unknown = page.getByRole('row').filter({ hasText: 'example.org' });
  await expect(unknown.getByText('example', { exact: true })).toBeVisible();
  await expect(unknown.locator('.ds-application-icon img')).toBeVisible();
  await expect(unknown.locator('.ds-application-icon img')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml/
  );
  await mock.expectNoUnexpectedRequests();
});

test('XHTTP 可编辑并保留未暴露的供应商传输参数', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page, {
    fixtures: {
      node: {
        network: 'xhttp',
        xhttpSettings: {
          host: 'example.com',
          path: '/old',
          mode: 'auto',
          extra: { scMaxEachPostBytes: 12345 },
        },
      },
    },
  });
  await page.goto('/#/nodes');
  await editNode(page);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('XHTTP 模式', { exact: true })).toBeVisible();
  await drawer.getByLabel('路径', { exact: true }).fill('/updated');
  await drawer.getByRole('button', { name: /保存$/ }).click();
  await expect(drawer).not.toBeVisible();
  const payload = await page.evaluate(
    () => (window as any).desktopTest.calls.find((c: any) => c.channel === 'server:update').args
  );
  expect(payload.network).toBe('xhttp');
  expect(payload.xhttpSettings).toEqual({
    host: 'example.com',
    path: '/updated',
    mode: 'auto',
    extra: { scMaxEachPostBytes: 12345 },
  });
  await mock.expectNoUnexpectedRequests();
});

test('只有 TUN 接管，各分流方式不回退系统代理', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: '强制 TUN', exact: true })).toHaveCount(0);
  await expect(page.getByText('接管方式', { exact: true })).toHaveCount(0);
  for (const name of ['全部代理', '直连', '智能分流']) {
    await page.getByText(name, { exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().proxyModeType))
      .toBe('tun');
  }
  const config = await page.evaluate(() => (window as any).desktopTest.getConfig());
  expect(config.proxyModeType).toBe('tun');
  await mock.expectNoUnexpectedRequests();
});

test('内部 DNS 可编辑，系统 DNS 接管入口已移除（接管恒开无开关）', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('switch', { name: '接管系统 DNS（TUN）', exact: true })).toHaveCount(
    0
  );
  const input = page.getByRole('textbox', { name: '直连 DNS', exact: true });
  await input.fill('https://example.com/dns-query');
  await input.blur();
  await expect
    .poll(() => page.evaluate(() => (window as any).desktopTest.getConfig().dnsConfig.domesticDns))
    .toBe('https://example.com/dns-query');
  const after = await page.evaluate(() => (window as any).desktopTest.getConfig());
  expect(after.proxyModeType).toBe('tun');
  await mock.expectNoUnexpectedRequests();
});

test('内部 DNS 保存失败保留配置与草稿，仅右上角通知一次', async ({ page }) => {
  await chinese(page);
  registerExpectedConsoleReport(page, {
    level: 'error',
    message: '[IPC Client] Error invoking config:save: Error: Save rejected',
  });
  registerExpectedConsoleReport(page, {
    level: 'error',
    message: '[Store] Exception saving config: Error: Save rejected',
  });
  const mock = await installDesktopMock(page, { failSave: true });
  await page.goto('/#/settings');
  const input = page.getByRole('textbox', { name: '直连 DNS', exact: true });
  await input.fill('https://example.com/dns-query');
  await input.blur();
  await expect(input).toHaveValue('https://example.com/dns-query');
  expect(
    await page.evaluate(() => (window as any).desktopTest.getConfig().dnsConfig.domesticDns)
  ).toBe('https://doh.pub/dns-query');
  await expect(page.locator('.ant-notification-notice')).toHaveCount(1);
  await expect(page.locator('.ant-alert')).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});

test('入口状态区分直测受限与 UDP，不将二者当成代理失败', async ({ page }) => {
  await chinese(page);
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await page.getByRole('button', { name: '全部测速', exact: true }).click();
  for (const [entry, text] of [
    [{ status: 'unavailable', reason: 'ROUTE_UNVERIFIED' }, '无法直测'],
    [{ status: 'unsupported', reason: 'NO_TCP_ENTRY' }, '无 TCP 入口'],
  ] as const) {
    await page.evaluate((entry) => {
      const w = window as any;
      const id = w.desktopTest.getConfig().servers[0].id;
      w.desktopTest.emit('event:speedTestDetails', { serverId: id, detail: { entry } });
    }, entry);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByText('92 ms', { exact: true })).toBeVisible();
  }
  await mock.expectNoUnexpectedRequests();
});
