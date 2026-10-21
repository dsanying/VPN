import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const language of ['zh-CN', 'en-US']) {
 const chinese = language === 'zh-CN';

 test(`未指定节点的代理规则显示默认节点而非当前选中节点 ${language}`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), language);
  const mock = await installDesktopMock(page);
  await page.goto('/#/rules');
  await page.evaluate(() => {
   const desktop = (window as any).desktopTest;
   const config = desktop.getConfig();
   const rule = (id: string, extra: Record<string, unknown>) => ({
    id, type: 'domainSuffix', values: [`${id}.example.com`], action: 'proxy', enabled: true, ...extra,
   });
   desktop.emit('event:configChanged', {
    newValue: {
     ...config,
     customRules: [
      rule('r-follow', {}),
      rule('r-pinned', { targetServerId: 'n1' }),
      rule('r-direct', { action: 'direct' }),
     ],
    },
   });
  });
  const row = (name: string) =>
   page.getByRole('row').filter({ has: page.getByText(`${name}.example.com`) });
  const nodeCell = (name: string) => row(name).locator('td[data-client-column="node"]');
  await expect(nodeCell('r-follow')).toContainText(chinese ? '默认节点' : 'Default node');
  await expect(nodeCell('r-follow')).not.toContainText('示例节点');
  await expect(nodeCell('r-pinned')).toContainText('示例节点');
  await expect(nodeCell('r-direct')).toContainText('—');
  await mock.expectNoUnexpectedRequests();
 });

 test(`使用真实 IP 字段带问号说明 ${language}`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), language);
  const mock = await installDesktopMock(page);
  await page.goto('/#/rules');
  await page
   .getByRole('button', { name: chinese ? '新增' : 'Create', exact: true })
   .click();
  await page
   .getByRole('menuitem', { name: chinese ? '匹配规则' : /match rules/i })
   .click();
  const drawer = page.getByRole('dialog');
  const field = drawer
   .locator('.ant-form-item')
   .filter({ hasText: chinese ? '使用真实 IP' : 'use real IP' });
  const tip = field.locator('.ds-help-tip');
  await expect(tip).toBeVisible();
  await tip.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('FakeIP');
  await expect(tooltip).toContainText(chinese ? '域名' : 'domain');
  await mock.expectNoUnexpectedRequests();
 });

 test(`节点组操作列宽度只容下按钮而非大片空白 ${language}`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), language);
  const mock = await installDesktopMock(page, {
   fixtures: { subscriptions: [{ id: 'sub1', name: '官方订阅 1', url: 'https://example.com/sub' }] },
  });
  await page.goto('/#/nodes/groups');
  const row = page.getByRole('row').filter({ hasText: '官方订阅 1' });
  const cell = row.locator('td[data-client-column="action"], td').last();
  await expect(cell).toBeVisible();
  await expect.poll(() => cell.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(
   320
  );
  await expect(cell.locator('button')).toHaveCount(5);
  const overflow = await cell.evaluate(el => {
   const box = el.getBoundingClientRect();
   return [...el.querySelectorAll('button')].some(
    b => b.getBoundingClientRect().right > box.right + 1
   );
  });
  expect(overflow).toBe(false);
  await mock.expectNoUnexpectedRequests();
 });

 test(`检查进行中待重启更新按钮仍可点击应用 ${language}`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem('shadowvpn-lang', lang), language);
  const mock = await installDesktopMock(page, {
   globalUpdates: {
    checking: true,
    lastCheckedAt: Date.now(),
    items: [{ kind: 'core', status: 'ready', restart: 'proxy' }],
   },
  });
  await page.goto('/#/settings');
  const main = page.locator('main');
  const restart = main.getByRole('button', {
   name: chinese ? '重启代理应用更新' : /restart.*update/i,
  });
  await restart.scrollIntoViewIfNeeded();
  await expect(restart).toBeEnabled();
  await restart.click();
  await expect
   .poll(() =>
    page.evaluate(
     () =>
      (window as any).desktopTest.calls.filter(
       (c: any) => c.channel === 'update:install' && c.args?.kind === 'core'
      ).length
    )
   )
   .toBe(1);
  await mock.expectNoUnexpectedRequests();
 });
}
