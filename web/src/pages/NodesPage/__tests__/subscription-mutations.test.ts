import { saveSubscriptionSource } from '../subscription-mutations';
import type { subscriptionApi } from '@/ipc';
import type {SubscriptionConfig} from '@shared/types';
const original:SubscriptionConfig={id:'source',name:'Original',url:'https://example.com/subscription',autoUpdate:true,createdAt:'2026-01-01',etag:'etag-old',lastModified:'old',hasProviders:true};
const values={name:'Edited',url:'https://example.com/changed',autoUpdate:true};
function client(){return{preview:jest.fn().mockResolvedValue({ok:true}),add:jest.fn().mockResolvedValue({...values,id:'new',createdAt:'now'}),update:jest.fn().mockResolvedValue(undefined),delete:jest.fn().mockResolvedValue(undefined),updateServers:jest.fn().mockResolvedValue({success:true})};}
it('自动识别与保存复用同一来源预检，其他来源的结果不能跳过检查',async()=>{
 const api=client();
 await saveSubscriptionSource(api as unknown as typeof subscriptionApi,values,undefined,{url:values.url,result:Promise.resolve({ok:true})});
 expect(api.preview).not.toHaveBeenCalled();
 const different=client();
 await saveSubscriptionSource(different as unknown as typeof subscriptionApi,values,undefined,{url:original.url,result:Promise.resolve({ok:true})});
 expect(different.preview).toHaveBeenCalledWith(values.url);
 const rejected=client();
 await expect(saveSubscriptionSource(rejected as unknown as typeof subscriptionApi,values,undefined,{url:values.url,result:Promise.resolve({ok:false})})).rejects.toThrow();
 expect(rejected.add).not.toHaveBeenCalled();
});
it('来源变更通过官方原链接预检，清旧条件验证器，拉取失败恢复原订阅',async()=>{const api=client();api.updateServers.mockRejectedValue(new Error('Network failed'));await expect(saveSubscriptionSource(api as unknown as typeof subscriptionApi,values,original)).rejects.toThrow('Network failed');expect(api.preview).toHaveBeenCalledWith(values.url);expect(api.update.mock.calls[0][0]).not.toHaveProperty('etag');expect(api.update.mock.calls[1][0]).toEqual(original);expect(original.etag).toBe('etag-old');});
it('新增来源更新失败时移除本次新增项，预检失败不写配置',async()=>{const api=client();api.updateServers.mockResolvedValue({success:false,error:'Unavailable'});await expect(saveSubscriptionSource(api as unknown as typeof subscriptionApi,values)).rejects.toThrow('Unavailable');expect(api.delete).toHaveBeenCalledWith('new');const denied=client();denied.preview.mockResolvedValue({ok:false});await expect(saveSubscriptionSource(denied as unknown as typeof subscriptionApi,values)).rejects.toThrow();expect(denied.add).not.toHaveBeenCalled();});
it('只改名称保留验证器和原节点，不执行额外拉取',async()=>{const api=client();await saveSubscriptionSource(api as unknown as typeof subscriptionApi,{...original,name:'Renamed'},original);expect(api.preview).not.toHaveBeenCalled();expect(api.updateServers).not.toHaveBeenCalled();expect(api.update).toHaveBeenCalledWith({...original,name:'Renamed'});});
