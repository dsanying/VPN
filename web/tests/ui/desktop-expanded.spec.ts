import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

async function prepare(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  await page.setViewportSize({ width: 960, height: 600 });
  return installDesktopMock(page);
}
async function noDisclosure(page: import('@playwright/test').Page) {
  await expect(page.locator('main .ant-collapse, .ant-drawer .ant-collapse, main details, .ant-drawer details')).toHaveCount(0);
}

test('网站连通性直接挂载，滚动即可看完整结果，无展开按钮', async ({ page }) => {
  const mock = await prepare(page);
  await page.goto('/#/connections');
  const section = page.getByRole('region', { name: '网站连通性', exact: true });
  await expect(section.getByText('Google', { exact: true })).toBeAttached();
  await expect(section.getByText('Spotify', { exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: '网站连通性', exact: true })).toHaveCount(0);
  await section.getByText('Spotify', { exact: true }).scrollIntoViewIfNeeded();
  await expect(section.getByText('Spotify', { exact: true })).toBeInViewport();
  await expect(page.getByRole('contentinfo')).toBeInViewport();
  await noDisclosure(page);
  await mock.expectNoUnexpectedRequests();
});

test('订阅使用后台自动策略，保存不写废弃字段', async ({ page }) => {
  const mock = await prepare(page);
  await page.goto('/#/nodes?add=subscription');
  const drawer = page.getByRole('dialog');
  const switches = drawer.getByRole('switch');
  await expect(switches).toHaveCount(0);
  await drawer.getByLabel('名称', { exact: true }).fill('示例订阅');
  await drawer.getByLabel('订阅地址', { exact: true }).fill('https://example.com/subscription');
  await noDisclosure(page);
  await drawer.getByRole('button', { name: /保存$/ }).click();
  await expect(drawer).not.toBeVisible();
  const value = await page.evaluate(() => (window as any).desktopTest.calls.find((c: any) => c.channel === 'subscription:add').args.subscription);
  expect(value.autoUpdate).toBe(true);
  expect(value).not.toHaveProperty('updateViaProxy');
  expect(value).not.toHaveProperty('userAgent');
  expect(value).not.toHaveProperty('protocolPreference');
  await mock.expectNoUnexpectedRequests();
});

for (const route of ['nodes', 'rules']) {
  test(`${route} 编辑字段按实际类型显示且无内容折叠`, async ({ page }) => {
    const mock = await prepare(page);
    await page.goto(`/#/${route}`);
    if (route === 'nodes') {
      await page.getByRole('button', { name: '管理', exact: true }).click();
      await page.getByRole('button', { name: '添加', exact: true }).click();
      await page.getByRole('menuitem', { name: '添加节点', exact: true }).click();
    } else {
      await page.getByRole('button', { name: '新增', exact: true }).click();
      await page.getByRole('menuitem', { name: '匹配规则', exact: true }).click();
    }
    const drawer = page.getByRole('dialog');
    if (route === 'nodes') {
      await expect(drawer.getByRole('heading', { name: /^完整协议字段/ })).toBeAttached();
      await expect(drawer.locator('.monaco-editor')).toBeAttached();
      await drawer.getByRole('heading', { name: /^完整协议字段/ }).scrollIntoViewIfNeeded();
      await expect(drawer.getByRole('heading', { name: /^完整协议字段/ })).toBeInViewport();
    } else {
      await expect(drawer.locator('.monaco-editor')).toHaveCount(0);
      await expect(drawer.getByLabel('匹配类型', { exact: true })).toHaveCount(1);
      await expect(drawer.getByLabel('匹配值', { exact: true })).toHaveCount(1);
      await expect(drawer.getByLabel('组合方式', { exact: true })).toHaveCount(0);
      await drawer.getByRole('button', { name: '新增', exact: true }).click();
      await expect(drawer.getByLabel('组合方式', { exact: true })).toBeAttached();
      await expect(drawer.getByLabel('匹配值', { exact: true })).toHaveCount(2);
    }
    await expect(drawer.getByRole('button', { name: /保存$/ })).toBeInViewport();
    await noDisclosure(page);
    await mock.expectNoUnexpectedRequests();
  });
}
