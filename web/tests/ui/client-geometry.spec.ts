// SPDX-License-Identifier: MIT
import {test,expect} from '@playwright/test';
import {collectClientGeometryIssues as inspect} from './client-geometry';

test('short labels are measured by actual line boxes',async({page})=>{
 await page.setContent('<button class="ant-btn" style="width:25px;word-break:break-all">保存设置</button>');
 expect(await inspect(page,'terms')).not.toEqual([]);
 await page.locator('button').evaluate(node=>node.style.width='150px');
 expect(await inspect(page,'terms')).toEqual([]);
});
test('buttons require icons and remain inside the viewport',async({page})=>{
 await page.setContent('<button class="ant-btn">保存</button>');
 expect(await inspect(page,'buttons')).not.toEqual([]);
 await page.locator('button').evaluate(node=>node.insertAdjacentHTML('afterbegin','<span class="ant-btn-icon">+</span>'));
 expect(await inspect(page,'buttons')).toEqual([]);
 await page.locator('button').evaluate(node=>Object.assign(node.style,{position:'absolute',left:'-20px'}));
 expect(await inspect(page,'buttons')).not.toEqual([]);
});
test('contrast uses composited foreground and ancestor backgrounds',async({page})=>{
 await page.setContent('<div style="background:white"><span style="color:white">Unreadable text</span></div>');
 expect(await inspect(page,'contrast')).not.toEqual([]);
 await page.locator('span').evaluate(node=>node.style.color='black');
 expect(await inspect(page,'contrast')).toEqual([]);
});
test('real table cells reject overlap but allow their own scrolling region',async({page})=>{
 await page.setContent('<div class="client-table-panel"><table style="width:100px;table-layout:fixed"><tbody class="ant-table-tbody"><tr><td><span style="display:inline-block;width:300px">Long value</span></td></tr></tbody></table></div>');
 expect(await inspect(page,'cells')).not.toEqual([]);
 await page.locator('td').evaluate(node=>{node.innerHTML='<div style="overflow-x:auto;width:90px"><span style="display:inline-block;width:300px">Long value</span></div>';});
 expect(await inspect(page,'cells')).toEqual([]);
});
test('registered overflow slots reject clipping and idle gesture capture',async({page})=>{
 await page.setContent('<div data-client-overflow="x" style="width:60px;overflow:hidden;white-space:nowrap">An intentionally long unbroken value</div>');
 expect(await inspect(page,'overflow')).not.toEqual([]);
 await page.locator('div').evaluate(node=>node.style.overflowX='auto');
 expect(await inspect(page,'overflow')).toEqual([]);
 await page.locator('div').evaluate(node=>node.textContent='short');
 expect(await inspect(page,'overflow')).not.toEqual([]);
 await page.locator('div').evaluate(node=>node.style.overflowX='hidden');
 expect(await inspect(page,'overflow')).toEqual([]);
});
test('query values, visible decimals, ellipsis and unsolicited notices are checked',async({page})=>{
 await page.setContent('<div class="client-page"><form class="ant-form-inline"><span class="ant-select-content" style="display:block;width:10px;overflow:hidden;white-space:nowrap">Selection</span></form><p style="text-overflow:ellipsis">1.123456</p><div class="ant-notification-notice">Notice</div></div>');
 for(const mode of ['queries','decimals','ellipsis','notices'] as const)expect(await inspect(page,mode)).not.toEqual([]);
});
