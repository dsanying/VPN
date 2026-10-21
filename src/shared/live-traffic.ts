import type { ConnectionEntry, InstalledApplication } from './types';

export type ConnectionGrouping = 'domain' | 'application';
export interface ConnectionFlow {
  key: string;
  name: string;
  identity: string;
  outbound: string;
  count: number;
}
export const UNKNOWN_APPLICATION = '\u0000application';
export const UNKNOWN_DESTINATION = '\u0000destination';
export const UNKNOWN_OUTBOUND = '\u0000outbound';
const normalizePath = (path: string) =>
  path.includes('\\') || /^[a-z]:\//i.test(path) ? path.replace(/\\/g, '/').toLowerCase() : path;
type ApplicationIdentity = { identity: string; name: string };
const applicationIdentities = new WeakMap<
  InstalledApplication[],
  Map<string, ApplicationIdentity>
>();
/** Resolve a process once per catalogue snapshot, retaining first-match catalogue ordering. */
export function connectionApplication(
  c: ConnectionEntry,
  apps: InstalledApplication[] = []
): ApplicationIdentity {
  const path = c.metadata?.processPath?.trim();
  if (!path) {
    const pid = c.metadata?.processId;
    const name = c.metadata?.processName?.trim();
    return pid
      ? { identity: `\u0000process:${pid}`, name: name || `PID ${pid}` }
      : name
        ? { identity: `\u0000process-name:${name}`, name }
        : { identity: UNKNOWN_APPLICATION, name: UNKNOWN_APPLICATION };
  }
  let cache = applicationIdentities.get(apps);
  if (!cache) {
    cache = new Map();
    applicationIdentities.set(apps, cache);
  }
  const cached = cache.get(path);
  if (cached) return cached;
  const identity = resolveConnectionApplication(c, apps);
  // Process command paths can be unbounded over a long session; keep only recent display lookups.
  if (cache.size >= 1024) cache.delete(cache.keys().next().value!);
  cache.set(path, identity);
  return identity;
}
function resolveConnectionApplication(
  c: ConnectionEntry,
  apps: InstalledApplication[] = []
): { identity: string; name: string } {
  const path = c.metadata?.processPath?.trim();
  if (!path) return { identity: UNKNOWN_APPLICATION, name: UNKNOWN_APPLICATION };
  const normalized = normalizePath(path);
  const app = apps.find(
    (a) =>
      a.coverage !== 'unsupported' &&
      (a.processPaths.some((p) => normalizePath(p) === normalized) ||
        (a.coverage === 'bundle' &&
          normalized.startsWith(`${normalizePath(a.path).replace(/\/$/, '')}/`)))
  );
  if (app) return { identity: app.path, name: app.name };
  // The outer macOS bundle is an actual path boundary, not a guessed process-name relationship.
  const bundle = path.match(/^(.+?\.app)\//i)?.[1];
  if (bundle)
    return {
      identity: bundle,
      name: bundle
        .split('/')
        .at(-1)!
        .replace(/\.app$/i, ''),
    };
  return { identity: path, name: path.split(/[/\\]/).at(-1) || path };
}
export function connectionDestination(c: ConnectionEntry): string {
  return c.metadata?.host?.trim() || c.metadata?.destinationIP?.trim() || UNKNOWN_DESTINATION;
}
/** Keep the reported outbound or whole chain. Missing data never means Direct. */
export function connectionOutbound(c: ConnectionEntry): string {
  return c.outbound?.trim() || (c.chains ?? []).filter(Boolean).join(' → ') || UNKNOWN_OUTBOUND;
}
export function connectionFlows(
  connections: ConnectionEntry[],
  grouping: ConnectionGrouping,
  apps: InstalledApplication[] = []
): ConnectionFlow[] {
  const groups = new Map<string, ConnectionFlow>();
  for (const c of connections) {
    const { identity, name } =
      grouping === 'application'
        ? connectionApplication(c, apps)
        : { identity: connectionDestination(c), name: connectionDestination(c) };
    const outbound = connectionOutbound(c);
    const key = JSON.stringify([identity, outbound]);
    const flow = groups.get(key);
    if (flow) flow.count++;
    else groups.set(key, { key, identity, name, outbound, count: 1 });
  }
  return [...groups.values()].sort((a, b) =>
    a.identity < b.identity
      ? -1
      : a.identity > b.identity
        ? 1
        : a.outbound < b.outbound
          ? -1
          : a.outbound > b.outbound
            ? 1
            : 0
  );
}

/** Search the full snapshot before grouping/pagination; reported and localized values both match. */
export function filterConnections(
  connections: ConnectionEntry[],
  query: string,
  apps: InstalledApplication[] = [],
  display: (value: string) => string = (value) => value
): ConnectionEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return connections;
  return connections.filter((c) => {
    const fields = [
      connectionApplication(c, apps).name,
      connectionDestination(c),
      connectionOutbound(c),
      c.metadata?.processPath,
      c.metadata?.destinationIP,
      c.metadata?.destinationPort,
      c.metadata?.sourceIP,
      c.metadata?.sourcePort,
      c.metadata?.network,
      c.rule,
      c.rulePayload,
      ...c.chains,
    ].filter((value): value is string => !!value);
    const text = fields
      .flatMap((value) => [value, display(value)])
      .join(' ')
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

/** Byte counters/timestamps do not change graph bands. Reuse the previous flow snapshot when counts and identities match. */
export function createConnectionFlowSelector() {
  let previous: ConnectionFlow[] = [];
  return (connections: ConnectionEntry[], apps: InstalledApplication[]) => {
    const next = connectionFlows(connections, 'application', apps);
    if (
      next.length === previous.length &&
      next.every((flow, index) => {
        const old = previous[index];
        return flow.key === old.key && flow.name === old.name && flow.count === old.count;
      })
    )
      return previous;
    previous = next;
    return next;
  };
}

/** Two layers: source groups to shared exits. All connections originate on this device, so no constant root node. */
export function connectionSankey(flows: ConnectionFlow[]) {
  const nodes: Array<{
    id: string;
    name: string;
    value: number;
    depth: number;
    identity?: string;
    outbound?: string;
  }> = [];
  const groups = new Map<string, number>();
  const exits = new Map<string, number>();
  const links: Array<{ source: string; target: string; value: number }> = [];
  for (const flow of flows) {
    let group = groups.get(flow.identity);
    if (group === undefined) {
      group = nodes.length;
      groups.set(flow.identity, group);
      nodes.push({
        id: `group:${flow.identity}`,
        name: flow.name,
        value: 0,
        depth: 0,
        identity: flow.identity,
      });
    }
    let exit = exits.get(flow.outbound);
    if (exit === undefined) {
      exit = nodes.length;
      exits.set(flow.outbound, exit);
      nodes.push({
        id: `exit:${flow.outbound}`,
        name: flow.outbound,
        value: 0,
        depth: 1,
        outbound: flow.outbound,
      });
    }
    nodes[group].value += flow.count;
    nodes[exit].value += flow.count;
    links.push({ source: nodes[group].id, target: nodes[exit].id, value: flow.count });
  }
  return { nodes, links };
}
