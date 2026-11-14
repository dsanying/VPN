import { expect, test, registerExpectedConsoleReport } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('订阅自动识别显示完整协议数量，无手动协议下拉', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes/groups');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: '订阅' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('通过代理更新',{exact:true})).toHaveCount(0);
  await expect(dialog.getByText('请求标识',{exact:true})).toHaveCount(0);
  await dialog.getByLabel('订阅地址', { exact: true }).fill('https://example.com/subscription');
  await expect(dialog.getByRole('status')).toHaveText('VLESS × 1');
  const count = () => page.evaluate(() => (window as any).desktopTest.calls.filter((call: any) => call.channel === 'subscription:preview').length);
  expect(await count()).toBe(1);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  expect(await count()).toBe(1);
  await expect(dialog.locator('[placeholder]')).toHaveCount(0);
  await mock.expectNoUnexpectedRequests();
});

test('单节点自动识别填充完整字段，说明位于标题问号', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes/groups');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: '添加节点' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByLabel('节点链接或配置', { exact: true }).fill('vless://00000000-0000-4000-8000-000000000001@example.com:443?type=ws&security=tls#node');
  await expect(dialog.getByText('VLESS', {exact:true})).toBeVisible();
  await expect(dialog.getByText('WebSocket', {exact:true})).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: '* 地址', exact: true })).toHaveValue('example.com');
  await expect(dialog.locator('[placeholder]')).toHaveCount(0);
  await expect(dialog.getByText('只在需要修改未列出的协议字段时使用。密钥不会被省略。', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', {name:/保存$/}).click();
  await expect(dialog).not.toBeVisible();
  const saved = await page.evaluate(() => (window as any).desktopTest.calls.find((call: any) => call.channel === 'server:add').args);
  expect(saved.protocol).toBe('vless');
  expect(saved.network).toBe('ws');
  expect(saved.tlsSettings.alpn).toEqual(['h2']);
  expect(saved.wsSettings.headers.Host).toBe('example.com');
  await mock.expectNoUnexpectedRequests();
});

test('编辑已有节点仅修改来源即出现保存按钮，重新识别后可保存', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page);
  await page.goto('/#/nodes');
  await page.getByRole('button', { name: '更多', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // 未修改时只有关闭按钮。
  await expect(dialog.getByRole('button', { name: /保存$/ })).toHaveCount(0);
  // 来源不在表单字段内，改动同样必须把抽屉置为已修改并出现保存按钮。
  await dialog.getByLabel('节点链接或配置', { exact: true }).fill('vless://00000000-0000-4000-8000-000000000001@example.com:443?type=ws&security=tls#node');
  // 编辑已有节点时协议栏本就显示 VLESS，须等 400ms 防抖识别完成（「识别中」消失）再保存。
  await expect(dialog.getByText('识别中', { exact: true })).toBeVisible();
  await expect(dialog.getByText('识别中', { exact: true })).toBeHidden();
  await expect(dialog.getByRole('button', { name: /保存$/ })).toBeVisible();
  await dialog.getByRole('button', { name: /保存$/ }).click();
  await expect(dialog).not.toBeVisible();
  const payload = await page.evaluate(() => (window as any).desktopTest.calls.find((c: any) => c.channel === 'server:update').args);
  expect(payload.protocol).toBe('vless');
  expect(payload.network).toBe('ws');
  await mock.expectNoUnexpectedRequests();
});

test('单节点识别失败保留输入且禁止保存，不猜测协议', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  registerExpectedConsoleReport(page, { level: 'error', message: '[IPC Client] Error invoking localImport:parse: Error: Action rejected' });
  const mock = await installDesktopMock(page, { failActionChannel: 'localImport:parse' });
  await page.goto('/#/nodes/groups');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加节点', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称', { exact: true }).fill('待识别节点');
  await dialog.getByLabel('节点链接或配置', { exact: true }).fill('invalid configuration');
  await expect(dialog.getByText(/^无法识别单个节点，请检查配置内容$/)).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByRole('button', { name: /保存$/ }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('节点链接或配置', { exact: true })).toHaveValue('invalid configuration');
  expect(await page.evaluate(() => (window as any).desktopTest.calls.filter((call: any) => call.channel === 'server:add').length)).toBe(0);
  await mock.expectNoUnexpectedRequests();
});
