import type {UserConfig} from '@shared/types';
/** 原始编辑器只提交相对打开时快照的改动，保留期间来自订阅更新等操作的新配置。 */
export function applyAdvancedConfigDiff(current:UserConfig,base:UserConfig|null,value:Record<string,unknown>):UserConfig{
 const next={...current} as unknown as Record<string,unknown>;
 const previous=(base??{}) as unknown as Record<string,unknown>;
 for(const key of new Set([...Object.keys(previous),...Object.keys(value)])){
  if(['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid configuration field');
  if(JSON.stringify(previous[key])!==JSON.stringify(value[key])){
   if(Object.hasOwn(value,key))next[key]=structuredClone(value[key]);else delete next[key];
  }
 }
 return next as unknown as UserConfig;
}
