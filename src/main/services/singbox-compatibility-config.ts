import type { ServerConfig } from '../../shared/types';
import type { BridgeNode } from './compatibility-config';
import {
  buildProxyOutbound,
  buildWireGuardEndpoint,
  buildTailscaleEndpoint,
} from './singbox-outbound-builder';

/** Only node-specific extensions run here; main routing and process matching stay in Mihomo. */
export function buildSingBoxCompatibilityConfig(
  nodes: BridgeNode[],
  directPort: number
): Record<string, unknown> {
  const names = new Map(nodes.map((node, index) => [node.server.id, `node-${index}`]));
  const outbounds: Record<string, unknown>[] = [{ type: 'direct', tag: 'direct' }];
  const endpoints: Record<string, unknown>[] = [];
  const inbounds: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [];
  for (const [index, node] of nodes.entries()) {
    const tag = names.get(node.server.id)!;
    const dialer = `dial-${index}`;
    outbounds.push({
      type: 'socks',
      tag: dialer,
      server: '127.0.0.1',
      server_port: node.dialPort || directPort,
      version: '5',
    });
    // The chain is routed through an explicit main-core inbound, never a second independent chain.
    const server: ServerConfig = { ...node.server, detour: undefined };
    const outbound =
      server.protocol === 'wireguard'
        ? buildWireGuardEndpoint(server, tag, 'bootstrap')
        : server.protocol === 'tailscale'
          ? buildTailscaleEndpoint(server, tag)
          : buildProxyOutbound(server, names, 'bootstrap');
    if (server.protocol === 'wireguard' || server.protocol === 'tailscale')
      endpoints.push({ ...outbound, detour: dialer });
    else outbounds.push({ ...outbound, detour: dialer });
    inbounds.push({
      type: 'socks',
      tag: `bridge-${index}`,
      listen: '127.0.0.1',
      listen_port: node.bridge.port,
      users: [{ username: node.bridge.username, password: node.bridge.password }],
    });
    rules.push({ inbound: [`bridge-${index}`], action: 'route', outbound: tag });
  }
  return {
    log: { level: 'warn' },
    dns: {
      servers: [{ type: 'udp', tag: 'bootstrap', server: '223.5.5.5' }],
      final: 'bootstrap',
    },
    inbounds,
    outbounds,
    ...(endpoints.length ? { endpoints } : {}),
    route: {
      rules,
      final: 'direct',
      default_domain_resolver: 'bootstrap',
      auto_detect_interface: true,
    },
  };
}
