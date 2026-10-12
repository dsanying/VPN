import { observationIsFresh } from './background-refresh';
import type { UserConfig } from './types';
import { nodeMeasurementIdentity, subscriptionMeasurementIdentity } from './measurement-identity';
import { DEFAULT_SPEED_TEST_URL } from './speed-test';

export interface MeasurementRefreshScope {
  all?: boolean;
  groupIds?: string[];
  syncGroupIds?: string[];
  nodeIds?: string[];
  subscriptionIds?: string[];
}
/** Shared dependency inputs; hashing for durable records remains a host storage concern. */
export function portableMeasurementSnapshot(config: UserConfig): MeasurementConfigSnapshot {
  return {
    target: DEFAULT_SPEED_TEST_URL,
    nodes: new Map(
      config.servers.map((node) => [
        node.id,
        {
          fingerprint: nodeMeasurementIdentity(node, DEFAULT_SPEED_TEST_URL),
          group: node.subscriptionId,
        },
      ])
    ),
    subscriptions: new Map(
      (config.subscriptions ?? []).map((sub) => [
        sub.id,
        {
          fingerprint: subscriptionMeasurementIdentity(sub),
          updated: sub.lastUpdated,
          source: JSON.stringify([sub.name]),
        },
      ])
    ),
  };
}
export interface MeasurementConfigSnapshot {
  target: string;
  nodes: Map<string, { fingerprint: string; group?: string }>;
  subscriptions: Map<string, { fingerprint: string; updated?: string; source: string }>;
}
export function changedMeasurementScope(
  previous: MeasurementConfigSnapshot,
  next: MeasurementConfigSnapshot
): MeasurementRefreshScope {
  const groups = new Set<string>();
  const nodes = new Set<string>();
  const subscriptions = new Set<string>();
  const sync = new Set<string>();
  for (const [id, sub] of next.subscriptions) {
    const old = previous.subscriptions.get(id);
    if (!old || old.fingerprint !== sub.fingerprint || old.source !== sub.source) {
      sync.add(id);
      groups.add(id);
      subscriptions.add(id);
    }
    // A completed sync is a fresh observation request, including HTTP 304 / equal content.
    if (!old || old.fingerprint !== sub.fingerprint || old.updated !== sub.updated) {
      groups.add(id);
      subscriptions.add(id);
    }
  }
  for (const [id, node] of next.nodes) {
    const old = previous.nodes.get(id);
    if (!old || old.fingerprint !== node.fingerprint || old.group !== node.group) {
      nodes.add(id);
      // Membership changes affect the entire group; a transport-only edit affects one node.
      if (!old || old.group !== node.group) {
        if (node.group) groups.add(node.group);
        if (old?.group) groups.add(old.group);
      }
    }
  }
  for (const [id, node] of previous.nodes)
    if (!next.nodes.has(id) && node.group && next.subscriptions.has(node.group))
      groups.add(node.group);
  for (const id of groups) if (next.subscriptions.has(id)) subscriptions.add(id);
  return {
    all: previous.target !== next.target,
    groupIds: [...groups],
    syncGroupIds: [...sync],
    nodeIds: [...nodes],
    subscriptionIds: [...subscriptions],
  };
}

/** Select expired or missing observations after identity reconciliation by the repositories. */
export function dueMeasurementScope(
  config: UserConfig,
  nodes: Record<string, { testedAt: number; detail?: { entry?: { reason?: string } } }>,
  subscriptions: Record<string, { checkedAt: string }>,
  now = Date.now()
): MeasurementRefreshScope {
  return {
    nodeIds: config.servers
      .filter(
        (node) =>
          !observationIsFresh(nodes[node.id]?.testedAt, now) ||
          nodes[node.id]?.detail?.entry?.reason === 'ENTRY_RECHECK_REQUIRED'
      )
      .map((node) => node.id),
    subscriptionIds: (config.subscriptions ?? [])
      .filter((sub) => !observationIsFresh(subscriptions[sub.id]?.checkedAt, now))
      .map((sub) => sub.id),
  };
}
