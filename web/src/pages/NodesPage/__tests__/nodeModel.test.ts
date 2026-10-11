import { mergeNodeDraft } from '../nodeModel';
import type { ServerConfig } from '@shared/types';
const original:ServerConfig={id:'original',name:'Original',protocol:'vless',address:'example.com',port:443,uuid:'00000000-0000-4000-8000-000000000001',network:'ws',security:'tls',subscriptionId:'source',createdAt:'2026-01-01T00:00:00Z',tlsSettings:{serverName:'example.com',alpn:['h2']},wsSettings:{path:'/old',headers:{Host:'example.com'}}};
it('修改可见字段时保留订阅身份和隐藏的嵌套传输字段，源数据不可变',()=>{
 const before=structuredClone(original);const draft=mergeNodeDraft(original,{name:'Edited',wsSettings:{path:'/new'}},{tlsSettings:{serverName:'cdn.example.com'}});
 expect(draft.id).toBe(original.id);expect(draft.subscriptionId).toBe('source');expect(draft.createdAt).toBe(original.createdAt);
 expect(draft.wsSettings).toEqual({path:'/new',headers:{Host:'example.com'}});expect(draft.tlsSettings).toEqual({serverName:'cdn.example.com',alpn:['h2']});expect(original).toEqual(before);
});
it('拒绝原型字段注入；数组原样替换而非合并旧值',()=>{
 expect(()=>mergeNodeDraft(original,{},JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow();
 expect(mergeNodeDraft(original,{}, {tlsSettings:{alpn:['http/1.1']}}).tlsSettings?.alpn).toEqual(['http/1.1']);expect(({} as {polluted?:boolean}).polluted).toBeUndefined();
});
it('新建节点使用新的身份，不采信高级输入提供的订阅身份',()=>{
 const draft=mergeNodeDraft(undefined,{name:'New'}, {...original,id:'injected',subscriptionId:'source'});expect(draft.id).not.toBe('injected');expect(draft.subscriptionId).toBeUndefined();
});
