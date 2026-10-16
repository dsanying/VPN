import type { ServerConfig, SubscriptionConfig } from './types';
import { DEFAULT_SUBSCRIPTION_USER_AGENT } from './subscription-request';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}

/** Host-independent input to SHA-256; labels and refresh timestamps are not transport identity. */
export function nodeMeasurementIdentity(node: ServerConfig, target?: string): string {
  const {
    id: _id,
    name: _name,
    createdAt: _created,
    updatedAt: _updated,
    subscriptionId: _subscription,
    ...transport
  } = node;
  return JSON.stringify(
    canonical({
      transport,
      target,
      ...(node.protocol === 'enterprise'
        ? { enterpriseRevision: node.updatedAt, enterpriseProbeVersion: 4 }
        : {}),
    })
  );
}
export function subscriptionMeasurementIdentity(subscription: SubscriptionConfig): string {
  return JSON.stringify([subscription.url, DEFAULT_SUBSCRIPTION_USER_AGENT]);
}
