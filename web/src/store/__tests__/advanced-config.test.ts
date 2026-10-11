import type {UserConfig} from '@shared/types';
import {applyAdvancedConfigDiff} from '../advanced-config';
const base={servers:[],subscriptions:[],customRules:[],autoConnect:false} as unknown as UserConfig;
it('只提交实际改动，保留期间添加的节点',()=>{
 const current={...base,servers:[{id:'new-node'}]} as UserConfig;
 expect(applyAdvancedConfigDiff(current,base,{...base,autoConnect:true})).toMatchObject({autoConnect:true,servers:[{id:'new-node'}]});
 expect(current.autoConnect).toBe(false);
});
it('保存后的新快照不重复覆盖后来变化的设置',()=>{
 const saved={...base,autoConnect:true};const current={...saved,autoConnect:false};
 expect(applyAdvancedConfigDiff(current,saved,{...saved}).autoConnect).toBe(false);
});
it('拒绝原型字段，避免原始 JSON 改写对象原型',()=>{
 expect(()=>applyAdvancedConfigDiff(base,base,JSON.parse('{"__proto__":{"changed":true}}'))).toThrow('Invalid configuration field');
});
