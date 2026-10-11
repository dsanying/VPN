import type { ServerConfig } from './types';
import { compatibilityEngine, parseXHttpSettings, type CoreBridge } from './core-capabilities';

export interface BridgeNode {
  server: ServerConfig;
  bridge: CoreBridge;
  dialPort?: number;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Subscription data is node-only. Core-native local file references are not a download format.
export function rejectExternalCoreReferences(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (
      /^(certificateFile|keyFile|caFile|cert-file|key-file|private-key-path|plugin-path|script|dialer-proxy|dialerProxy|proxySettings|sendThrough)$/i.test(
        key
      )
    )
      throw new Error(`Unsupported external core reference: ${key}`);
    if (/^(certificate|private-key|ca|ca-cert)$/i.test(key)) {
      const certificate = Array.isArray(item)
        ? item.every((value) => typeof value === 'string')
          ? item.join('\n')
          : ''
        : item;
      if (
        typeof certificate !== 'string' ||
        !certificate.includes('-----BEGIN ') ||
        !certificate.includes('-----END ')
      )
        throw new Error(`Unsupported external core reference: ${key}`);
    }
    rejectExternalCoreReferences(item);
  }
}

export function buildXrayOutbound(
  server: ServerConfig,
  tag: string,
  dialerTag?: string
): Record<string, unknown> {
  let outbound: Record<string, any>;
  if (server.compatibilitySettings?.engine === 'xray') {
    outbound = clone(server.compatibilitySettings.outbound);
    rejectExternalCoreReferences(outbound);
    const destination = outbound.settings?.vnext?.[0] ?? outbound.settings?.servers?.[0];
    if (destination) {
      destination.address = server.address;
      destination.port = server.port;
      const user = destination.users?.[0];
      if (user && server.uuid) user.id = server.uuid;
      if (user && server.protocol === 'vless') {
        user.encryption = server.encryption || 'none';
        if (server.flow !== undefined) user.flow = server.flow;
      }
      if (server.protocol === 'trojan' && server.password !== undefined)
        destination.password = server.password;
      if (server.protocol === 'shadowsocks' && server.shadowsocksSettings) {
        destination.method = server.shadowsocksSettings.method;
        destination.password = server.shadowsocksSettings.password;
      }
    }
  } else {
    if (!['vless', 'vmess', 'trojan'].includes(server.protocol))
      throw new Error('XHTTP requires VLESS, VMess or Trojan');
    const settings =
      server.protocol === 'trojan'
        ? { servers: [{ address: server.address, port: server.port, password: server.password }] }
        : {
            vnext: [
              {
                address: server.address,
                port: server.port,
                users: [
                  {
                    id: server.uuid,
                    ...(server.protocol === 'vless'
                      ? {
                          encryption: server.encryption || 'none',
                          ...(server.flow ? { flow: server.flow } : {}),
                        }
                      : { security: server.vmessSecurity || 'auto', alterId: server.alterId || 0 }),
                  },
                ],
              },
            ],
          };
    const network = server.network || 'tcp';
    if (!['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'].includes(network))
      throw new Error(`Unsupported Xray transport mapping: ${network}`);
    const stream: Record<string, any> = { network, security: server.security || 'none' };
    if (network === 'ws') stream.wsSettings = clone(server.wsSettings ?? {});
    if (network === 'grpc') stream.grpcSettings = clone(server.grpcSettings ?? {});
    if (network === 'httpupgrade')
      stream.httpupgradeSettings = {
        path: server.wsSettings?.path || '/',
        host: server.wsSettings?.headers?.Host || '',
      };
    if (server.network === 'xhttp')
      stream.xhttpSettings = parseXHttpSettings(server.xhttpSettings ?? {});
    if (server.security === 'tls') {
      stream.tlsSettings = {
        serverName: server.tlsSettings?.serverName || server.address,
        allowInsecure: server.tlsSettings?.allowInsecure === true,
        ...(server.tlsSettings?.alpn ? { alpn: server.tlsSettings.alpn } : {}),
        ...(server.tlsSettings?.fingerprint ? { fingerprint: server.tlsSettings.fingerprint } : {}),
      };
    } else if (server.security === 'reality') {
      stream.realitySettings = {
        serverName: server.tlsSettings?.serverName || server.address,
        fingerprint: server.tlsSettings?.fingerprint || 'chrome',
        publicKey: server.realitySettings?.publicKey,
        shortId: server.realitySettings?.shortId || '',
      };
    }
    outbound = { protocol: server.protocol, settings, streamSettings: stream };
  }
  rejectExternalCoreReferences(outbound);
  outbound.tag = tag;
  // All auxiliary dials return to sing-box's explicit direct inbound, including separated downloads.
  // This avoids TUN recursion and retains domain destinations for the main core's node resolver.
  const routeStream = (stream: Record<string, any>): void => {
    if (dialerTag)
      stream.sockopt = {
        ...(stream.sockopt ?? {}),
        dialerProxy: dialerTag,
        domainStrategy: 'AsIs',
      };
    for (const key of ['xhttpSettings', 'splithttpSettings']) {
      const transport = stream[key];
      if (!transport) continue;
      const settings = transport.extra ?? transport;
      if (settings.downloadSettings) routeStream(settings.downloadSettings);
    }
  };
  outbound.streamSettings ??= { network: 'tcp', security: 'none' };
  routeStream(outbound.streamSettings);
  return outbound;
}

export function buildXrayConfig(nodes: BridgeNode[], directPort: number): Record<string, unknown> {
  return {
    log: { loglevel: 'warning' },
    inbounds: nodes.map(({ bridge }, index) => ({
      tag: `in-${index}`,
      listen: '127.0.0.1',
      port: bridge.port,
      protocol: 'socks',
      settings: {
        auth: 'password',
        accounts: [{ user: bridge.username, pass: bridge.password }],
        udp: true,
        ip: '127.0.0.1',
      },
    })),
    outbounds: [
      ...nodes.map(({ server }, index) =>
        buildXrayOutbound(server, `node-${index}`, `dial-${index}`)
      ),
      ...nodes.map(({ dialPort }, index) => ({
        tag: `dial-${index}`,
        protocol: 'socks',
        settings: { servers: [{ address: '127.0.0.1', port: dialPort || directPort }] },
      })),
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: nodes.map((_, index) => ({
        type: 'field',
        inboundTag: [`in-${index}`],
        outboundTag: `node-${index}`,
      })),
    },
  };
}

export function buildMihomoConfig(
  nodes: BridgeNode[],
  directPort: number
): Record<string, unknown> {
  const proxies = nodes.map(({ server }, index) => {
    if (compatibilityEngine(server) !== 'mihomo') throw new Error('Invalid mihomo node');
    const proxy = clone(server.compatibilitySettings!.outbound);
    rejectExternalCoreReferences(proxy);
    // Parsed native dialects still use the editable node identity. Preserve
    // all native transport options while applying address/credential edits.
    proxy.server = server.address;
    proxy.port = server.port;
    if (server.protocol === 'vmess' || server.protocol === 'vless') {
      proxy.uuid = server.uuid;
    }
    return { ...proxy, name: `node-${index}`, 'dialer-proxy': `dial-${index}` };
  });
  return {
    'log-level': 'warning',
    'allow-lan': false,
    ipv6: true,
    mode: 'rule',
    // No provider, geodata, controller, TUN or remote rule downloads in auxiliary cores.
    'geo-auto-update': false,
    proxies: [
      ...proxies,
      ...nodes.map(({ dialPort }, index) => ({
        name: `dial-${index}`,
        type: 'socks5',
        server: '127.0.0.1',
        port: dialPort || directPort,
        udp: true,
      })),
    ],
    listeners: nodes.map(({ bridge }, index) => ({
      name: `in-${index}`,
      type: 'socks',
      listen: '127.0.0.1',
      port: bridge.port,
      udp: true,
      users: [{ username: bridge.username, password: bridge.password }],
      proxy: `node-${index}`,
    })),
    rules: ['MATCH,REJECT'],
  };
}

export function buildBridgeOutbound(tag: string, bridge: CoreBridge): Record<string, unknown> {
  return {
    type: 'socks',
    tag,
    server: '127.0.0.1',
    server_port: bridge.port,
    version: '5',
    username: bridge.username,
    password: bridge.password,
  };
}
