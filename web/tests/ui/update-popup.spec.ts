import {test,expect} from './console-guard';
import type {UpdatePopupPhase} from '../../../src/shared/types/update';
for(const phase of ['remind','progress','done','error'] as const){test(`更新小窗 ${phase}：真实动作和安全文本`,async({page})=>{
 await page.addInitScript((phase:UpdatePopupPhase)=>{
 const actions:string[]=[];const labels={remindTitle:'发现更新',progressTitle:'正在下载',doneTitle:'下载完成',errorTitle:'下载失败',currentPrefix:'当前版本',installing:'正在安装',tryingMirror:'尝试镜像',update:'更新',later:'稍后',skip:'跳过',viewLog:'更新日志',cancel:'取消',retry:'重试',manualDownload:'手动下载',close:'关闭'};
 Object.assign(window,{flowzUpdatePopup:{onState:(cb:any)=>{cb({phase,theme:'dark',version:'v0.2.0',currentVersion:'v0.1.0',percentage:27,bytesText:'27 MB / 100 MB',errorText:'<img src=x onerror="alert(1)">',labels});return()=>{};},sendAction:(action:string)=>actions.push(action)},popupTest:actions});
 },phase);
 await page.goto('/update-popup.html');
 if(phase==='remind'){await page.getByRole('button',{name:'更新',exact:true}).click();await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).popupTest)).toEqual(['update','later']);}
 if(phase==='progress'){await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','27');await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).popupTest)).toEqual(['cancel']);}
 if(phase==='done'){await expect(page.getByText('正在安装',{exact:true})).toBeVisible();await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).popupTest)).toEqual([]);}
 if(phase==='error'){await expect(page.getByText('<img src=x onerror="alert(1)">',{exact:true})).toBeVisible();await expect(page.locator('img')).toHaveCount(0);await page.getByRole('button',{name:'重试',exact:true}).click();await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).popupTest)).toEqual(['retry','close']);}
 });}

test('已下载更新提供重启操作，不重复下载或显示跳过入口',async({page})=>{
 await page.addInitScript(()=>{
 const actions:string[]=[];Object.assign(window,{popupTest:actions,flowzUpdatePopup:{onState:(cb:any)=>{cb({phase:'remind',readyToInstall:true,theme:'dark',version:'v0.2.0',currentVersion:'v0.1.0',labels:{remindTitle:'更新已下载，可重启安装',currentPrefix:'当前',update:'重启更新',later:'稍后',skip:'跳过',viewLog:'更新日志'}});return()=>{};},sendAction:(action:string)=>actions.push(action)}});
 });
 await page.goto('/update-popup.html');await expect(page.getByRole('button',{name:'跳过',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'重启更新',exact:true}).click();expect(await page.evaluate(()=>(window as any).popupTest)).toEqual(['update']);
});
