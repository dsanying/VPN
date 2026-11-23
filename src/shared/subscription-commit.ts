import type { ServerConfig, SubscriptionConfig, UserConfig } from './types';
import { reconcileServers, leftoverToKeep } from './subscription-reconciliation';
import { pickViableFallbackExit } from './fallback-exit';
import { DIRECT_SERVER_ID } from './direct-selection';
import { nodeRegionCode } from './node-identity';
import type { ExitRankingContext } from './exit-selection';

export interface FetchedSubscription {
  servers?: ServerConfig[];
  notModified?: boolean;
  partial?: boolean;
  failedProviders?: string[];
  userInfo?: SubscriptionConfig['userInfo'];
  etag?: string;
  lastModified?: string;
  hasProviders?: boolean;
}
export interface SubscriptionCommitResult {
  success: boolean;
  addedServers: number;
  updatedServers: number;
  deletedServers: number;
  unchanged?: boolean;
  userInfo?: SubscriptionConfig['userInfo'];
  error?: string;
}

/** Mutates a private transaction draft only; the host persists and publishes after success. */
export function commitSubscriptionResult(
  config: UserConfig,
  source: Pick<SubscriptionConfig, 'id' | 'url'>,
  result: FetchedSubscription,
  now: string,
  reconcile = reconcileServers,
  keepFailed = leftoverToKeep,
  /** 测量上下文（延迟 + 地区记录，主进程注入；Android/单测缺省 → 退化为列表序兜底）。 */
  measurements: Pick<ExitRankingContext, 'latencyMap' | 'regionMap'> = {}
): { result: SubscriptionCommitResult; restartRequired: boolean } {
  const subscription = config.subscriptions?.find((item) => item.id === source.id);
  if (!subscription || subscription.url !== source.url)
    throw new Error('Subscription changed during synchronization');
  const unchanged = {
    success: true,
    addedServers: 0,
    updatedServers: 0,
    deletedServers: 0,
    unchanged: true,
  };
  if (result.notModified) {
    subscription.lastUpdated = now;
    if (result.etag) subscription.etag = result.etag;
    if (result.lastModified) subscription.lastModified = result.lastModified;
    // EdgeAudit L1：304 也可能携带新 subscription-userinfo（服务器侧计量独立于正文）→ 一并回写。
    if (result.userInfo) subscription.userInfo = result.userInfo;
    return { result: unchanged, restartRequired: false };
  }
  if (!Array.isArray(result.servers) || (!result.servers.length && !result.partial))
    throw new Error('Subscription contains no usable nodes');
  const oldServers = config.servers.filter((server) => server.subscriptionId === source.id);
  const delta = reconcile(oldServers, result.servers, now);
  if (delta.contentChanged || result.partial) {
    const recovered = result.partial
      ? keepFailed(oldServers, delta.deletedIds, result.failedProviders)
      : [];
    const kept = [...delta.servers, ...recovered];
    config.servers = [
      ...config.servers.filter((server) => server.subscriptionId !== source.id),
      ...kept,
    ];
    if (
      config.selectedServerId &&
      delta.deletedIds.has(config.selectedServerId) &&
      !config.servers.some((server) => server.id === config.selectedServerId)
    ) {
      // 统一出口重选（exit-selection）：同订阅 > 同地区（被删节点的探测地区，
      // regionMap 按被删 id 反查）> 最低延迟 > 列表序；跨订阅兜底已在排序内完成，
      // 空候选 → DIRECT 哨兵。被删节点属于本订阅，同订阅候选天然第一档。
      config.selectedServerId =
        pickViableFallbackExit(config.servers, {
          previousSubscriptionId: source.id,
          previousRegionCode: nodeRegionCode(measurements.regionMap?.[config.selectedServerId]),
          latencyMap: measurements.latencyMap,
          regionMap: measurements.regionMap,
        }) ?? DIRECT_SERVER_ID;
    }
    subscription.lastUpdated = now;
    if (result.userInfo) subscription.userInfo = result.userInfo;
    subscription.etag = result.etag;
    subscription.lastModified = result.lastModified;
    subscription.hasProviders = result.hasProviders;
    return {
      result: {
        success: true,
        addedServers: delta.added,
        updatedServers: delta.updated,
        deletedServers: delta.deleted - recovered.length,
        userInfo: result.userInfo,
      },
      restartRequired: delta.contentChanged && !result.partial,
    };
  }
  subscription.lastUpdated = now;
  if (result.userInfo) subscription.userInfo = result.userInfo;
  subscription.etag = result.etag;
  subscription.lastModified = result.lastModified;
  subscription.hasProviders = result.hasProviders;
  return { result: unchanged, restartRequired: false };
}
