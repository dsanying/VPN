/** Network reachability only; no login, playback, anti-bot or DOM inference. */
import { SERVICE_IDS, type ServiceId, type UnlockResult } from '../../../shared/unlock-detection';
import { WEBSITE_CATALOG } from '../../../shared/website-catalog';
import type { UnlockFetch } from './unlock-http';
export type Checker = (fetch: UnlockFetch) => Promise<UnlockResult>;
export { classifyWebsite } from '../../../shared/website-probe';
import { classifyWebsite } from '../../../shared/website-probe';
const checker =
  (id: ServiceId): Checker =>
  async (fetch) => {
    const url = WEBSITE_CATALOG[id].url;
    const t0 = Date.now();
    const head = await fetch({ url, method: 'HEAD' });
    // 主请求往返延迟：连通性 UI 用它替代 HTTP 码（用户可读的「多快」而非实现细节的「什么码」）。
    // 仅在有响应时计（timeout/error 无意义）；补测 GET（403/451 二次确认）不重计——展示的是首跳延迟。
    const latencyMs = head.status ? Date.now() - t0 : undefined;
    const result = classifyWebsite(id, head);
    if (result.status !== 'blocked' && [403, 451].includes(head.status) && !head.body) {
      const denial = await fetch({ url, method: 'GET', maxBodyBytes: 8192 });
      const region = classifyWebsite(id, denial);
      if (region.status === 'blocked') return { ...region, latencyMs };
    }
    return { ...result, latencyMs };
  };
export const CHECKERS = Object.fromEntries(SERVICE_IDS.map((id) => [id, checker(id)])) as Record<
  ServiceId,
  Checker
>;
export const checkChatgpt = CHECKERS.chatgpt;
export const checkClaude = CHECKERS.claude;
export const checkGemini = CHECKERS.gemini;
export const checkNetflix = CHECKERS.netflix;
export const checkDisney = CHECKERS.disney;
export const checkSpotify = CHECKERS.spotify;
