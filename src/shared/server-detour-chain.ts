import type { ServerConfig } from './types';

/** Exact dependency closure; missing references and cycles must never become direct connections. */
export function serverDetourChain(node: ServerConfig, servers: ServerConfig[]): ServerConfig[] {
  const byId = new Map(servers.map((server) => [server.id, server]));
  const chain: ServerConfig[] = [];
  const visited = new Set<string>();
  let current: ServerConfig | undefined = node;
  while (current) {
    if (visited.has(current.id)) throw new Error('Proxy chain contains a cycle');
    visited.add(current.id);
    chain.push(current);
    if (!current.detour) break;
    current = byId.get(current.detour);
    if (!current) throw new Error('Proxy chain target does not exist');
  }
  return chain;
}
