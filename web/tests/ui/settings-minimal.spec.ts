import { registerFirefoxPopupPositioningDiagnostic } from './console-guard';
import {test,expect} from './console-guard';
import {installDesktopMock} from './desktop-mock';

for (const language of ['zh-CN','en-US']) {
 test(`设置保留用户选择，助手置顶且不阻挡应用 ${language}`,async({page})=>{
  await page.addInitScript(language=>localStorage.setItem('shadowvpn-lang',language),language);
  const mock=await installDesktopMock(page,{helperStatus:{installed:true,ready:true}});
  await page.goto('/#/settings');
  const chinese=language==='zh-CN';
  await expect(page.getByRole('heading',{name:chinese?/提权助手/:/privileged helper/i})).toBeVisible();
  const titles=await page.locator('main').innerText();
  expect(titles.toLowerCase().indexOf(chinese?'提权助手':'privileged helper')).toBeLessThan(titles.toLowerCase().indexOf(chinese?'常规':'general'));
  await expect(page.getByRole('button',{name:chinese?'卸载':'Uninstall',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:chinese?'安装':'Install',exact:true})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:chinese?'日志级别':'Log level',exact:true})).toHaveCount(0);
  for(const label of ['FakeIP',chinese?'测速地址':'Speed test URL',chinese?'阻止 QUIC':'Block QUIC',chinese?'绕过局域网':'Bypass LAN'])await expect(page.getByText(label,{exact:true})).toHaveCount(0);
  await expect(page.getByText('0.1.0',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).desktopTest.calls.some((c:any)=>['config:save','helper:install','helper:uninstall'].includes(c.channel)))).toBe(false);
  for(const size of [{width:1440,height:900},{width:960,height:600},{width:960,height:440},{width:640,height:440}]){
   await page.setViewportSize(size);
   const button=page.getByRole('button',{name:chinese?'检查更新':/check.*update/i});
   await button.scrollIntoViewIfNeeded();await expect(button).toBeVisible();
   const box=await button.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(size.width);
  }
  await mock.expectNoUnexpectedRequests();
 });
}

test('助手未就绪可修复，只有显式点击才请求系统安装',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('shadowvpn-lang','zh-CN'));
 const mock=await installDesktopMock(page,{helperStatus:{installed:true,ready:false,needsRepair:true}});
 await page.goto('/#/settings');
 await expect(page.getByRole('button',{name:'修复',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).desktopTest.calls.filter((c:any)=>c.channel==='helper:install').length)).toBe(0);
 await page.getByRole('button',{name:'修复',exact:true}).click();
 await expect(page.getByText('已就绪',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'修复',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).desktopTest.calls.filter((c:any)=>c.channel==='helper:install').length)).toBe(1);
 await mock.expectNoUnexpectedRequests();
});

for (const language of ['zh-CN', 'en-US']) {
 test(`设置说明只在字段问号展示，窄窗不越界 ${language}`, async ({page}) => {
  await page.addInitScript(language => localStorage.setItem('shadowvpn-lang', language), language);
  const mock = await installDesktopMock(page, {helperStatus:{installed:true,ready:true}});
  await page.goto('/#/settings');
  registerFirefoxPopupPositioningDiagnostic(page);
  const icons = page.locator('.client-field-label button');
  await expect(icons).toHaveCount(9);
  await expect(page.locator('input[placeholder]:not([placeholder=""])')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  for (const width of [1440, 640]) {
   await page.setViewportSize({width, height:900});
   for (let index = 0; index < 9; index++) {
    await icons.nth(index).hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    expect((await tip.innerText()).length).toBeGreaterThan(12);
    const box = await tip.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await page.getByRole('heading', {level:1}).hover();
    await expect(tip).toHaveCount(0);
   }
  }
  await icons.first().focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.getByRole('heading', {level:1}).click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await icons.last().click();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.getByRole('heading', {level:1}).click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).desktopTest.calls.some((call:any) => call.channel === 'config:save'))).toBe(false);
  await mock.expectNoUnexpectedRequests();
 });
}
