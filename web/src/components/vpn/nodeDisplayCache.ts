import type { ServerConfig } from '@shared/types';

// Derived indexes live with their immutable source snapshot; no extra persisted copy can go stale.
const serverIndexes = new WeakMap<ServerConfig[], Map<string, ServerConfig>>();
export function indexedServer(servers: ServerConfig[] | undefined, id: string) {
  if (!servers) return undefined;
  let index = serverIndexes.get(servers);
  if (!index) { index = new Map(servers.map(server => [server.id, server])); serverIndexes.set(servers, index); }
  return index.get(id);
}
const regionNames = new Map<string, { names: Intl.DisplayNames; values: Map<string, string | undefined> }>();
export function regionDisplayName(language: string, code: string) {
  let cache = regionNames.get(language);
  if (!cache) { cache = { names: new Intl.DisplayNames([language], { type: 'region' }), values: new Map() }; regionNames.set(language, cache); }
  if (!cache.values.has(code)) cache.values.set(code, cache.names.of(code.toUpperCase()));
  return cache.values.get(code);
}
