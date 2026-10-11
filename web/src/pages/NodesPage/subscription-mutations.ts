import type { SubscriptionConfig } from '@shared/types';
import type { subscriptionApi } from '@/ipc';
import type { SubscriptionPreviewResult } from '@shared/subscription-preview';
export type SourcePreview = { url: string; result: Promise<SubscriptionPreviewResult> };
/** 先验证来源；修改来源后拉取失败（包括异常）恢复原订阅，后端保留原节点。 */
export async function saveSubscriptionSource(client:typeof subscriptionApi, values:Omit<SubscriptionConfig,'id'|'createdAt'>, original?:SubscriptionConfig, observed?:SourcePreview):Promise<SubscriptionConfig>{
 const changed=!original||original.url!==values.url;
 if(changed){const preview=await (observed?.url===values.url?observed.result:client.preview(values.url));if(!preview.ok)throw new Error('Subscription preview failed');}
 const candidate=original?{...original,...values}:await client.add(values);
 if(original){if(original.url!==values.url){delete candidate.etag;delete candidate.lastModified;delete candidate.hasProviders;}await client.update(candidate);}
 if(changed){try{const result=await client.updateServers(candidate.id);if(!result.success)throw new Error(result.error??'Subscription refresh failed');}catch(error){if(original)await client.update(original);else await client.delete(candidate.id);throw error;}}
 return candidate;
}
