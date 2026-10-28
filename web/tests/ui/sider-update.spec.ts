import {test,expect} from './console-guard';
import {installDesktopMock} from './desktop-mock';

test('已下载更新常驻侧边栏左下角，点击即应用，不重复弹小窗',async({page})=>{
 const mock=await installDesktopMock(page,{globalUpdates:{checking:false,lastCheckedAt:null,items:[{kind:'software',status:'ready',version:'0.3.2',restart:'software'}]}});
 await page.goto('/#/nodes');
 const entry=page.getByRole('button',{name:'重启软件应用更新',exact:true});
 await expect(entry).toBeVisible();
 await expect(entry).toContainText('重启更新 · 0.3.2');
 await entry.click();
 await expect.poll(()=>page.evaluate(()=>(window as any).desktopTest.calls.filter((c:any)=>c.channel==='update:install').length)).toBe(1);
 expect((await page.evaluate(()=>(window as any).desktopTest.calls.filter((c:any)=>c.channel==='update:install')))[0].args).toEqual({kind:'software'});
 await expect(entry).toBeEnabled();
 await mock.expectNoUnexpectedRequests();
});

test('无待应用更新时不显示更新入口，主题与语言压缩为一行',async({page})=>{
 await installDesktopMock(page);
 await page.goto('/#/nodes');
 await expect(page.getByRole('button',{name:'重启软件应用更新',exact:true})).toHaveCount(0);
 const prefs=page.locator('.ds-basic-layout__sider-prefs');
 await expect(prefs.getByRole('button',{name:'切换亮暗主题'})).toBeVisible();
 await expect(prefs.getByRole('button',{name:'切换语言'})).toBeVisible();
 // 一行两格：主题与语言按钮同排，不再各占一行。
 const box=await prefs.boundingBox();
 expect(box!.height).toBeLessThan(64);
});
