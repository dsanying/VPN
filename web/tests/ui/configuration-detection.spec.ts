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
