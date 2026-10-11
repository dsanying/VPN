import { normalizeCountryCode } from './country';
import type { ServerConfig, SubscriptionConfig } from './types';
import { groupServersBySubscription } from './server-grouping';

/** Display identity only: never mutate stored names, routing tags or subscription data. */
export function nodeRegionSymbol(countryCode: unknown): string {
  const code = normalizeCountryCode(countryCode);
  return code
    ? String.fromCodePoint(
        ...code
          .toUpperCase()
          .split('')
          .map((character) => 127397 + character.charCodeAt(0))
      )
    : '🌐';
}
/** One display contract for DOM, charts and native menus. Parts support cached flag assets. */
export function nodeDisplayIdentity(name: string, countryCode: unknown, groupName?: string) {
  const groupPrefix = groupName ? `${groupName} /` : '';
  const region = nodeRegionSymbol(countryCode);
  return { name, region, groupPrefix, text: [groupPrefix, region, name].filter(Boolean).join(' ') };
}
export function nodeDisplayName(name: string, countryCode: unknown, groupName?: string): string {
  return nodeDisplayIdentity(name, countryCode, groupName).text;
}
/** Follow the same subscription/orphan/endpoint classification as every node picker. */
export function nodeGroupName(
  node: ServerConfig,
  subscriptions: SubscriptionConfig[] | undefined,
  labels: { manual: string; mesh: string }
): string {
  const group = groupServersBySubscription([node], subscriptions)[0];
  return group.isManual ? labels.manual : group.isMesh ? labels.mesh : group.name;
}
/** Routing labels may contain IDs or names. Ambiguous names must not borrow another node's region. */
export function resolveNodeIdentity(
  value: string,
  servers: ServerConfig[]
): ServerConfig | undefined {
  const byId = servers.find((server) => server.id === value);
  if (byId) return byId;
  const matches = servers.filter((server) => server.name === value);
  return matches.length === 1 ? matches[0] : undefined;
}
