import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

test('规则页自动地区常显，代理出口不会成为本地地区，无手动地区或反向控件', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  const mock = await installDesktopMock(page, {running:true});
  await page.goto('/#/rules'); await expect(page.getByRole('heading',{level:1,name:'规则',exact:true})).toBeVisible();
  await page.evaluate(() => (window as any).desktopTest.emit('event:ipInfoUpdated', {
    direct:{ip:'192.0.2.1',countryCode:'CN'}, proxy:{ip:'203.0.113.1',countryCode:'JP'}, updatedAt:1,
    smartRouting:{countryCode:'cn',status:'ready'},
  }));
  await expect(page.getByText('中国',{exact:true})).toBeVisible();
  const modeHelp = page.locator('.ds-summary-strip__item').nth(1).locator('.ds-help-tip');
  await expect(page.locator('.ds-summary-strip__item').nth(1)).toContainText('智能分流');
  await modeHelp.focus();
  await expect(page.getByRole('tooltip')).toContainText('同地区直连，其余代理');
  await modeHelp.blur();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await page.evaluate(() => (window as any).desktopTest.emit('event:ipInfoUpdated', {
    direct:null,proxy:{ip:'203.0.113.1',countryCode:'JP'},updatedAt:2,smartRouting:{status:'unavailable'},
  }));
  await expect(page.getByText('未识别',{exact:true})).toBeVisible();
  await modeHelp.focus();
  await expect(page.getByRole('tooltip')).toContainText('暂走代理');
  await modeHelp.blur();
  await expect(page.getByText('日本',{exact:true})).toHaveCount(0);
  await page.evaluate(() => (window as any).desktopTest.emit('event:ipInfoUpdated', {
    direct:null,proxy:null,updatedAt:3,smartRouting:{countryCode:'jp',status:'unavailable'},
  }));
  await expect(page.getByText('日本',{exact:true})).toBeVisible();
  await modeHelp.focus();
  await expect(page.getByRole('tooltip')).toContainText('暂走代理');
  await modeHelp.blur();
  await modeHelp.focus();
  await expect(page.getByRole('tooltip')).not.toContainText('同地区直连，其余代理');
  await mock.expectNoUnexpectedRequests();
});
