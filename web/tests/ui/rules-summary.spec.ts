import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const language of ['zh-CN', 'en-US']) {
 test(`规则摘要无外框且地区、分流、顺序在宽窄窗口完整显示 ${language}`, async ({page}) => {
  await page.addInitScript(language => localStorage.setItem('shadowvpn-lang', language), language);
  const mock = await installDesktopMock(page);
  await page.goto('/#/rules');
  const summary = page.locator('.ds-summary-strip');
  await expect(summary).toBeVisible();
  await page.evaluate(() => {
   const desktop = (window as any).desktopTest;
   desktop.emit('event:ipInfoUpdated', {direct:{ip:'192.0.2.1'},proxy:null,updatedAt:Date.now(),smartRouting:{status:'ready',countryCode:'CN'}});
   desktop.emit('event:configChanged', {newValue:{...desktop.getConfig(),proxyMode:'direct'}});
  });
  const items = summary.locator('.ds-summary-strip__item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0).getByRole('img',{name:language==='zh-CN'?'中国':'China'})).toBeVisible();
  await expect(items.nth(1)).toContainText(language==='zh-CN'?'直连':'Direct');
  await expect(items.nth(2)).toContainText(language==='zh-CN'?'从上到下':'Top to bottom');
  for (const size of [{width:1440,height:900},{width:960,height:600},{width:960,height:440},{width:640,height:440}]) {
   await page.setViewportSize(size);
   await expect.poll(() => summary.evaluate(el => {
    const box=el.getBoundingClientRect();
    return [...el.querySelectorAll('.ds-summary-strip__value')].every(value => {
     const rect=value.getBoundingClientRect();
     return rect.left>=box.left && rect.right<=box.right+1 && value.scrollWidth<=value.clientWidth+1;
    }) && getComputedStyle(el).borderTopWidth==='0px';
   })).toBe(true);
  }
  const help=items.nth(2).locator('.ds-help-tip');
  await help.focus();
  await expect(page.getByRole('tooltip')).toContainText(language==='zh-CN'?'命中第一条':'first matching rule');
  await mock.expectNoUnexpectedRequests();
 });
}
