import type { ServerConfig, SubscriptionConfig, UserConfig } from './types';
import { reconcileServers, leftoverToKeep } from './subscription-reconciliation';
import { pickViableFallbackExit } from './fallback-exit';
import { DIRECT_SERVER_ID } from './direct-selection';

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
  keepFailed = leftoverToKeep
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
    )
      config.selectedServerId = pickViableFallbackExit(config.servers) ?? DIRECT_SERVER_ID;
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
