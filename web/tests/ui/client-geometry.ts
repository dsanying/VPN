// SPDX-License-Identifier: MIT
// Checks rendered client surfaces through standard DOM/CSS APIs.
import {expect,type Page} from '@playwright/test';

type Check = 'terms'|'decimals'|'buttons'|'actions'|'icons'|'cells'|'columns'|'queries'|'ellipsis'|'overflow'|'notices'|'summary'|'contrast';
export async function collectClientGeometryIssues(page:Page,check:Check):Promise<string[]> {
 return page.evaluate(mode=>{
  const problems:string[]=[];
  const elements=(selector:string)=>Array.from(document.querySelectorAll<HTMLElement>(selector));
  const visible=(node:HTMLElement)=>{
   const box=node.getBoundingClientRect(),style=getComputedStyle(node);
   return box.width>0&&box.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&style.opacity!=='0';
  };
  const label=(node:HTMLElement)=>`${node.tagName}.${String(node.className).slice(0,60)}: ${(node.textContent??'').trim().slice(0,50)}`;
  const scrolling=(node:HTMLElement)=>/^(auto|scroll)$/.test(getComputedStyle(node).overflowX);
  const scrollAncestor=(node:HTMLElement,boundary:HTMLElement)=>{
   for(let owner=node.parentElement;owner&&owner!==boundary;owner=owner.parentElement) if(scrolling(owner))return true;
   return scrolling(boundary);
  };
  const center=(box:DOMRect,axis:'x'|'y')=>axis==='x'?box.left+box.width/2:box.top+box.height/2;
  if(mode==='terms') {
   const selectors='.ant-btn,.ant-tag,.ant-tabs-tab-btn,.ant-form-item-label>label,.client-information-grid dt,.client-section-header h2,.client-summary>div>span,.ant-menu-title-content,.ant-table-thead th';
   for(const node of elements(selectors)) {
    const text=(node.textContent??'').trim();
    if(!visible(node)||!text||text.length>16||node.querySelector('br'))continue;
    const range=document.createRange();range.selectNodeContents(node);
    const lines=Array.from(range.getClientRects()).filter(rect=>rect.width&&rect.height).sort((a,b)=>a.top-b.top);
    let bottom=-Infinity,count=0;
    for(const box of lines) {if(box.top>=bottom-1)count++;bottom=Math.max(bottom,box.bottom);}
    if(count>1)problems.push(label(node));
   }
  }
  if(mode==='decimals') {
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()) {
    const node=walker.currentNode,owner=node.parentElement;
    if(!owner||!visible(owner)||owner.closest('script,style,pre,code,input,textarea,.monaco-editor'))continue;
    for(const match of (node.textContent??'').matchAll(/-?\d+\.\d{4,}/g))problems.push(match[0]);
   }
  }
  if(mode==='buttons')for(const node of elements('.ant-btn')) {
   if(!visible(node))continue;
   if(!node.querySelector(':scope>.ant-btn-icon'))problems.push(`missing icon ${label(node)}`);
   const box=node.getBoundingClientRect();
   if((box.left<-1||box.right>innerWidth+1)&&!node.closest('.ant-table-content,[data-client-overflow]'))problems.push(`outside viewport ${label(node)}`);
  }
  if(mode==='actions')for(const group of elements('.client-page div').filter(node=>getComputedStyle(node).display==='flex'&&getComputedStyle(node).flexDirection==='row'&&node.children.length>1&&Array.from(node.children).every(child=>child.matches('.ant-btn,.client-help,span.client-action-link')))) {
   const children=Array.from(group.children).filter(child=>child instanceof HTMLElement&&visible(child)) as HTMLElement[];
   for(let i=1;i<children.length;i++) {
    const a=children[i-1].getBoundingClientRect(),b=children[i].getBoundingClientRect();
    if(b.left>=a.right&&Math.abs(center(a,'y')-center(b,'y'))>1)problems.push(`${label(children[i-1])} / ${label(children[i])}`);
   }
  }
  if(mode==='icons') {
   const controls='.ant-btn,.ant-segmented-item,.ant-tag,.ant-input-prefix,.ant-input-suffix,.ant-select-clear,.ant-select-suffix,.ant-modal-close,.ant-pagination-item-link';
   for(const control of elements(controls)) {
    if(!visible(control))continue;
     const icons=Array.from(control.querySelectorAll<HTMLElement>('.anticon')).filter(icon=>icon.closest(controls)===control&&visible(icon));
    const children=Array.from(control.children).filter(child=>child.getBoundingClientRect().width);
    const iconOnly=icons.length===1&&children.length===1&&!control.textContent?.trim();
    for(const icon of icons) {
     const box=control.getBoundingClientRect(),glyph=icon.getBoundingClientRect();
     if(Math.abs(center(box,'y')-center(glyph,'y'))>1||(iconOnly&&Math.abs(center(box,'x')-center(glyph,'x'))>1))problems.push(label(control));
    }
   }
  }
  if(mode==='cells')for(const cell of elements('.client-table-panel .ant-table-tbody>tr:not(.ant-table-measure-row)>td')) {
   if(!visible(cell))continue;
   const boundary=cell.getBoundingClientRect();
   for(const child of Array.from(cell.querySelectorAll<HTMLElement>('*'))) {
    if(!visible(child)||child.closest('[aria-hidden="true"]'))continue;
    const box=child.getBoundingClientRect();
    if((box.left<boundary.left-1||box.right>boundary.right+1)&&!scrollAncestor(child,cell)) {problems.push(label(cell));break;}
   }
  }
  if(mode==='columns')for(const table of elements('.client-table-panel table')) {
   const headers=Array.from(table.querySelectorAll<HTMLElement>('thead th'));
   const rows=Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr.ant-table-row'));
   if(!rows.length)continue;
   for(let index=0;index<headers.length;index++) {
    const head=headers[index];
    if(!head.style.width||head.dataset.flexColumn==='true')continue;
    const cells=rows.map(row=>row.cells[index]).filter(Boolean);
    if(cells.some(cell=>Array.from(cell.children).some(child=>!getComputedStyle(child).display.startsWith('inline'))))continue;
    const widths=[head,...cells].map(cell=>{const range=document.createRange();range.selectNodeContents(cell);return range.getBoundingClientRect().width;});
    if(head.getBoundingClientRect().width>Math.max(...widths)+72)problems.push(label(head));
   }
  }
  if(mode==='queries')for(const form of elements('.client-page .ant-form-inline')) {
   for(const value of Array.from(form.querySelectorAll<HTMLElement>('.ant-select-content')))if(visible(value)&&value.scrollWidth>value.clientWidth+1&&!scrolling(value))problems.push(label(value));
   for(const input of Array.from(form.querySelectorAll<HTMLInputElement>('input')))if(getComputedStyle(input).textOverflow==='ellipsis')problems.push(label(input));
  }
  if(mode==='ellipsis')for(const node of elements('body *'))if(visible(node)&&getComputedStyle(node).textOverflow==='ellipsis')problems.push(label(node));
  if(mode==='overflow') {
   // Measure painted text fragments, rather than classifying widget internals.
   const text=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(text.nextNode()) {
    const leaf=text.currentNode,owner=leaf.parentElement;
    if(!owner||!leaf.textContent?.trim()||!visible(owner)||owner.closest('script,style,.monaco-editor,[aria-hidden="true"]'))continue;
    const range=document.createRange();range.selectNodeContents(leaf);
    for(const fragment of Array.from(range.getClientRects())) {
     if(!fragment.width||!fragment.height)continue;
     for(let clip:HTMLElement|null=owner;clip;clip=clip.parentElement) {
      const overflow=getComputedStyle(clip).overflowX;
      if(overflow==='auto'||overflow==='scroll')break;
      if(overflow!=='hidden'&&overflow!=='clip')continue;
      const frame=clip.getBoundingClientRect();
      if(fragment.right>frame.right+1||fragment.left<frame.left-1) {problems.push(`text clipped ${label(owner)}`);break;}
     }
    }
   }
   for(const slot of elements('[data-client-overflow]')) {
    if(!visible(slot))continue;
    const style=getComputedStyle(slot);
    const contentFits=slot.scrollWidth<=slot.clientWidth+1;
    if(contentFits&&scrolling(slot))problems.push(`unused scroll region ${label(slot)}`);
    if(parseFloat(style.paddingLeft)||parseFloat(style.paddingRight))problems.push(`scroll region inset ${label(slot)}`);
    if(style.display!=='flex'&&style.whiteSpace!=='nowrap'&&style.whiteSpace!=='pre')problems.push(`scroll region wraps ${label(slot)}`);
   }
  }
  if(mode==='notices')for(const notice of elements('.ant-notification-notice,.ant-message-notice'))if(visible(notice))problems.push(label(notice));
  if(mode==='summary')for(const group of elements('.client-summary,.client-information-grid')) {
   const children=Array.from(group.children).filter(child=>child instanceof HTMLElement&&visible(child)) as HTMLElement[];
   const gap=parseFloat(getComputedStyle(group).columnGap)||0;
   for(let i=1;i<children.length;i++) {
    const previous=children[i-1].getBoundingClientRect(),next=children[i].getBoundingClientRect();
    if(next.top>previous.bottom-1&&previous.right+gap+next.width<=group.getBoundingClientRect().right-1)problems.push(`unnecessary row ${label(group)}`);
   }
  }
  if(mode==='contrast') {
   type Color=[number,number,number,number];type RGB=[number,number,number];
   const color=(value:string):Color|null=>{
    const match=value.match(/^(rgba?\(|color\(srgb\s+)(.*)\)$/);if(!match)return null;
    const parts=match[2].replaceAll('/',' ').trim().split(/[\s,]+/);
    const scale=match[1].startsWith('color')?255:1;
    const channels=parts.map((part,i)=>part.endsWith('%')?parseFloat(part)*(i<3?2.55:0.01):Number(part)*(i<3?scale:1));
    return [channels[0],channels[1],channels[2],channels[3]??1];
   };
   const composite=(front:Color,back:RGB):RGB=>[0,1,2].map(i=>front[i]*front[3]+back[i]*(1-front[3])) as RGB;
   const luminance=(rgb:RGB)=>rgb.map(value=>{const v=value/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((sum,value,i)=>sum+value*[0.2126,0.7152,0.0722][i],0);
   const excluded='script,style,input,textarea,select,option,svg,canvas,.monaco-editor,[aria-hidden="true"],[disabled],[aria-disabled="true"],.ant-btn-disabled,.ant-select-disabled,.ant-input-disabled,.ant-picker-disabled,.ant-segmented-item-disabled';
   const candidates=new Set<HTMLElement>();const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(walker.nextNode())if(walker.currentNode.textContent?.trim()&&walker.currentNode.parentElement)candidates.add(walker.currentNode.parentElement);
   for(const icon of elements('.anticon'))candidates.add(icon);
   for(const node of candidates) {
    if(!visible(node)||node.closest(excluded))continue;
    const style=getComputedStyle(node);if(style.clipPath!=='none'||style.clip!=='auto')continue;
    const foreground=color(style.color);if(!foreground||foreground[3]===0)continue;
    const layers:Color[]=[];
    for(let owner:HTMLElement|null=node;owner;owner=owner.parentElement) {const layer=color(getComputedStyle(owner).backgroundColor);if(layer){layers.push(layer);if(layer[3]===1)break;}}
    let background:RGB=[255,255,255];for(const layer of layers.reverse())background=composite(layer,background);
    const a=luminance(background),b=luminance(composite(foreground,background));
    const ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&parseInt(style.fontWeight)>=700);
    if(ratio<(node.matches('.anticon')||large?3:4.5))problems.push(`${label(node)} contrast ${ratio.toFixed(2)}`);
   }
  }
  return [...new Set(problems)];
 },check);
}
async function verify(page:Page,check:Check) {expect(await collectClientGeometryIssues(page,check),`Client ${check} geometry`).toEqual([]);}
export const expectNoForcedWraps=(page:Page)=>verify(page,'terms');
export const expectNoLongDecimals=(page:Page)=>verify(page,'decimals');
export const expectReadableText=(page:Page)=>verify(page,'contrast');
export const expectConsistentActionButtons=(page:Page)=>verify(page,'buttons');
export const expectAlignedActionGroups=(page:Page)=>verify(page,'actions');
export const expectCenteredIcons=(page:Page)=>verify(page,'icons');
export const expectNoCellOverflows=(page:Page)=>verify(page,'cells');
export const expectNoColumnWaste=(page:Page)=>verify(page,'columns');
export const expectNoTruncatedQueryControls=(page:Page)=>verify(page,'queries');
export const expectNoEllipsis=(page:Page)=>verify(page,'ellipsis');
export const expectNoStuckOverflows=(page:Page)=>verify(page,'overflow');
export const expectNoUnsolicitedNotifications=(page:Page)=>verify(page,'notices');
export const expectEfficientSummaryStrips=(page:Page)=>verify(page,'summary');
export async function collectOffHeightCharts(page:Page,expected=336):Promise<string[]> {
 return page.evaluate(limit=>{
  const failures:string[]=[];
  for(const node of document.querySelectorAll<HTMLElement>('[_echarts_instance_]')) {
   const box=node.getBoundingClientRect();if(!box.width)continue;
   const region=node.closest<HTMLElement>('[data-client-overflow]');
   const height=region?Math.min(box.height,region.clientHeight):box.height;
   const target=node.dataset.chartRole==='realtime'?224:limit;
   if(node.dataset.chartFit==='content'?height>target+1:Math.abs(height-target)>1)failures.push(`${height}px (expected ${target})`);
  }
  return failures;
 },expected);
}
