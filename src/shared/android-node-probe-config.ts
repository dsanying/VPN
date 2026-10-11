import { buildAndroidCoreConfig, type AndroidCoreHost } from './android-core-config';
import type { ServerConfig, UserConfig } from './types';
import { serverDetourChain } from './server-detour-chain';

/** Compile only this node's complete detour chain; unrelated compatibility engines cannot block it. */
export function buildAndroidNodeProbeConfig(
  node: ServerConfig,
  saved: UserConfig,
  host: AndroidCoreHost
): { config: string; tag: string } {
  const chain = serverDetourChain(node, saved.servers);
  const value = buildAndroidCoreConfig(
    {
      ...saved,
      servers: chain,
      selectedServerId: node.id,
      proxyMode: 'global',
      customRules: [],
      appRules: [],
    },
    host
  );
  const { inbounds: _inbounds, services: _services, ...probeConfig } = value;
  // A dial-only probe has no inbound traffic to sniff or hijack.
  if (value.route) value.route.rules = [];
  return { config: JSON.stringify(probeConfig), tag: `node-${node.id}` };
}
