// SPDX-License-Identifier: MIT
import { writeFileSync, readFileSync } from 'node:fs';
import { theme } from 'antd';
// Appearance is derived from Ant Design's MIT public algorithms. Client layout
// dimensions are retained because the existing product interactions depend on them.
const geometry = {
  'layout-log-viewer-height':'clamp(240px, 62vh, 720px)',
  'font-family-body':'"IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
  'font-family-code':'"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  'font-size-xs':'12px','font-size-body':'14px','font-size-lg':'16px','font-size-title':'20px','font-size-page-title':'24px','font-size-metric':'28px',
  'radius-xs':'4px','radius-md':'8px','radius-lg':'12px','radius-choice-inner':'var(--ds-radius-xs)',
  'motion-fast':'120ms','control-height':'32px','layout-header-height':'60px','layout-content-max':'1600px',
  'layout-control-width':'320px','layout-query-control-width':'240px','layout-wide-control-width':'420px',
  'layout-scroll-region-max-height':'300px','layout-cell-max-height':'120px','layout-dialog-width':'720px',
};
for (const size of [2,4,8,12,16,24,32,40]) geometry[`space-${size}`] = `${size}px`;

const channels=value=>value.startsWith('#')
  ? value.slice(1).match(/../g).map(channel=>parseInt(channel,16))
  : value.match(/[\d.]+/g).map(Number);
const hex=rgb=>'#'+rgb.map(channel=>Math.round(channel).toString(16).padStart(2,'0')).join('');
const opaque=(value,background)=>{
  const rgba=channels(value),base=channels(background),alpha=rgba[3]??1;
  return hex(rgba.slice(0,3).map((channel,index)=>channel*alpha+base[index]*(1-alpha)));
};
const luminance=value=>channels(value).slice(0,3).reduce((sum,channel,index)=>{
  const v=channel/255;
  return sum+(v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)*[0.2126,0.7152,0.0722][index];
},0);
function readable(value,background,dark,minimum=6) {
  let current=opaque(value,background);
  const base=luminance(background);
  for(let step=0;step<64;step++) {
    const foreground=luminance(current);
    if((Math.max(base,foreground)+0.05)/(Math.min(base,foreground)+0.05)>=minimum) return current;
    current=hex(channels(current).map(channel=>channel*0.94+(dark?255:0)*0.06));
  }
  throw new Error('Cannot produce readable theme color');
}
const target=new URL('../src/design/tokens.css',import.meta.url);
const brand=readFileSync(target,'utf8').match(/--ds-color-brand:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1] ?? '#1677ff';
const themes={light:theme.defaultAlgorithm,dark:theme.darkAlgorithm};
const dataSeeds=['#1677ff','#13c2c2','#52c41a','#eb2f96','#722ed1','#fa8c16','#f5222d','#faad14'];
const blocks=[];
for(const [mode,algorithm] of Object.entries(themes)) {
  const dark=mode==='dark';
  const t=theme.getDesignToken({algorithm,token:{colorPrimary:brand,colorSuccess:'#32ad75'}});
  const vars={
    ...geometry,
    ...(!dark ? {'color-brand': brand} : {}),
    'color-canvas':dark?'#080808':'#f6f6f4',
    'color-surface':dark?'#111111':'#ffffff',
    'color-surface-elevated':t.colorBgElevated,
    'color-surface-subtle':opaque(t.colorFillQuaternary,t.colorBgContainer),
    'color-surface-muted':opaque(t.colorFillTertiary,t.colorBgContainer),
    'color-text':dark?'#ffffff':'#000000',
    'color-text-secondary':dark?'#ffffff':'#000000',
    'color-text-tertiary':readable(t.colorTextSecondary,t.colorBgContainer,dark),
    'color-text-disabled':readable(t.colorTextDisabled,t.colorBgContainer,dark,3),
    'color-border':t.colorBorderSecondary,
    'color-border-strong':t.colorBorder,
    'color-link':readable(t.colorInfoText,t.colorBgContainer,dark),
    'color-link-hover':readable(t.colorInfoTextHover,t.colorBgContainer,dark),
    'color-primary': 'color-mix(in srgb, var(--ds-color-brand) 94%, #000000)',
    'color-primary-hover': 'color-mix(in srgb, var(--ds-color-brand) 86%, #000000)',
    'color-primary-active': 'color-mix(in srgb, var(--ds-color-brand) 78%, #000000)',
    'color-primary-surface':'color-mix(in srgb, var(--ds-color-brand) 12%, var(--ds-color-surface))',
    'color-primary-border':'color-mix(in srgb, var(--ds-color-brand) 45%, var(--ds-color-surface))',
    'color-primary-foreground':'#ffffff',
    'color-primary-text':dark?'color-mix(in srgb, var(--ds-color-brand) 60%, #ffffff)':'color-mix(in srgb, var(--ds-color-brand) 85%, #000000)',
    'color-focus':'var(--ds-color-primary)',
    'color-shadow':'#000000',
    'shadow-raised':t.boxShadowSecondary,
    'shadow-choice':t.boxShadowTertiary,
    'shadow-focus':`0 0 0 3px ${dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.18)'}`,
  };
  const inverse=theme.getDesignToken({algorithm:themes[dark?'light':'dark'],token:{colorSuccess:'#32ad75'}});
  for(const kind of ['Info','Success','Warning','Error']) {
    const role=kind.toLowerCase();
    vars[`color-${role}`]=readable(t[`color${kind}Text`],t.colorBgContainer,dark);
    vars[`color-${role}-surface`]=t[`color${kind}Bg`];
    vars[`color-${role}-border`]=t[`color${kind}Border`];
    vars[`color-${role}-on-inverse`]=readable(inverse[`color${kind}Text`],inverse.colorBgContainer,!dark);
  }
  vars['color-link-on-inverse']=readable(inverse.colorInfoText,inverse.colorBgContainer,!dark);
  dataSeeds.forEach((seed,index)=>{vars[`color-data-${index+1}`]=theme.getDesignToken({algorithm,token:{colorPrimary:seed}}).colorPrimary;});
  const declarations=Object.entries(vars).map(([name,value])=>`  --ds-${name}: ${value};`).join('\n');
  blocks.push(`${dark?':root[data-theme="dark"]':':root'} {\n  color-scheme: ${mode};\n${declarations}\n}`);
}
blocks.push(`[data-surface="inverse"] {\n${['link','info','success','warning','error'].map(role=>`  --ds-color-${role}: var(--ds-color-${role}-on-inverse);`).join('\n')}\n}`);
const result=('/* Generated from Ant Design public theme algorithms by generate-client-tokens.mjs. */\n'+blocks.join('\n\n')+'\n')
  .split('\n').map(line=>line.trimEnd()).join('\n');
if(process.argv.includes('--check')) {
  if(readFileSync(target,'utf8')!==result)throw new Error('Generated client tokens are stale');
}else writeFileSync(target,result);
