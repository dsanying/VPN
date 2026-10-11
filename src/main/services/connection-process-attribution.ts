import type { ConnectionsSnapshot, ConnectionEntry } from '../../shared/types';

const ip = (value?: string) => value?.toLowerCase().replace(/^::ffff:/, '');
const loopback = (value?: string) => value === '::1' || /^127\./.test(value || '');
const sourceKey = (c: ConnectionEntry) => {
  const m = c.metadata;
  return m?.network && m.sourceIP && m.sourcePort
    ? JSON.stringify([m.network.toLowerCase(), ip(m.sourceIP), m.sourcePort])
    : undefined;
};

/** Supplement missing kernel attribution using the exact client socket to our
 * known loopback proxy listener. No destination/name inference, stale replay,
 * ambiguous owners, or overriding authoritative kernel paths.
 */
export function attributeLocalProxyConnections(
  snapshot: ConnectionsSnapshot,
  observed: ConnectionsSnapshot | undefined,
  proxyPorts: number[],
  now = Date.now()
): ConnectionsSnapshot {
  if (!observed || observed.unavailable || now < observed.at || now - observed.at > 5000)
    return snapshot;
  const owners = new Map<string, ConnectionEntry | null>();
  for (const c of observed.connections) {
    const m = c.metadata;
    const key = sourceKey(c);
    if (
      !key ||
      (!m?.processPath && !m?.processId) ||
      !loopback(ip(m.destinationIP)) ||
      !proxyPorts.includes(Number(m.destinationPort))
    )
      continue;
    const prior = owners.get(key);
    if (prior === null) continue;
    owners.set(
      key,
      prior &&
        (prior.metadata?.processPath !== m.processPath || prior.metadata?.processId !== m.processId)
        ? null
        : c
    );
  }
  return {
    ...snapshot,
    connections: snapshot.connections.map((c) => {
      if (c.metadata?.processPath) return c;
      const key = sourceKey(c);
      const owner = key ? owners.get(key)?.metadata : undefined;
      if (!owner || (c.metadata?.processId && c.metadata.processId !== owner.processId)) return c;
      return {
        ...c,
        metadata: {
          ...c.metadata,
          processPath: owner.processPath,
          processId: owner.processId,
          processName: owner.processName,
        },
      };
    }),
  };
}
