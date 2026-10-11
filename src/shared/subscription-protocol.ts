import type { ServerConfig } from './types';

/** 只返回协议与数量，预览不会向渲染层泄露节点凭据。 */
export function summarizeNodeProtocols(
  servers: readonly ServerConfig[]
): { protocol: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const server of servers) counts.set(server.protocol, (counts.get(server.protocol) ?? 0) + 1);
  return [...counts]
    .map(([protocol, count]) => ({ protocol, count }))
    .sort((a, b) => a.protocol.localeCompare(b.protocol));
}
