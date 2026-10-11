import type { ServerConfig } from '../../shared/types';
import { parseXHttpSettings, type CoreBridge } from '../../shared/core-capabilities';
import { rejectExternalCoreReferences } from './compatibility-config';
import { parseWsEarlyData } from '../../shared/ws-early-data';

export class MihomoCompatibilityRequired extends Error {
  constructor(
    public readonly engine: 'sing-box' | 'xray',
    public readonly field: string
  ) {
    super(`${field} requires the ${engine} compatibility core`);
  }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Node translation is shared by the main runtime and isolated proxy measurement. */
export function buildMihomoProxy(
  server: ServerConfig,
  name: string,
  dialer?: string,
  bridge?: CoreBridge
): Record<string, unknown> {
  if (bridge)
    return {
      name,
      type: 'socks5',
      server: '127.0.0.1',
      port: bridge.port,
      username: bridge.username,
      password: bridge.password,
      udp: true,
    };
  if (server.compatibilitySettings?.engine === 'xray')
    throw new MihomoCompatibilityRequired('xray', 'native Xray configuration');
  if (server.compatibilitySettings?.engine === 'mihomo') {
    const proxy = clone(server.compatibilitySettings.outbound);
    rejectExternalCoreReferences(proxy);
    return {
      ...proxy,
      name,
      server: server.address,
      port: server.port,
      ...(['vless', 'vmess'].includes(server.protocol) ? { uuid: server.uuid } : {}),
      ...(server.password !== undefined ? { password: server.password } : {}),
      ...(dialer ? { 'dialer-proxy': dialer } : {}),
    };
  }
  const tls = server.tlsSettings;
  for (const [field, enabled] of Object.entries({
    naive: server.protocol === 'naive',
    tailscale: server.protocol === 'tailscale',
    custom: server.protocol === 'custom',
    'TLS native engine': tls?.engine && tls.engine !== 'go',
    'TLS spoof': tls?.spoofSni || tls?.spoofMethod,
    'reverse WireGuard mesh': server.wireguardSettings?.reverseMesh,
  }))
    if (enabled) throw new MihomoCompatibilityRequired('sing-box', field);
  if (server.network === 'xhttp' && server.protocol !== 'vless')
    throw new MihomoCompatibilityRequired('xray', `${server.protocol} XHTTP`);
  if (server.security === 'reality' && !['vless', 'vmess', 'trojan'].includes(server.protocol))
    throw new MihomoCompatibilityRequired('sing-box', `${server.protocol} Reality`);

  const proxy: Record<string, unknown> = {
    name,
    type:
      server.protocol === 'shadowsocks'
        ? 'ss'
        : server.protocol === 'socks'
          ? 'socks5'
          : server.protocol,
    server: server.address,
    port: server.port,
    udp: true,
    ...(dialer ? { 'dialer-proxy': dialer } : {}),
  };
  switch (server.protocol) {
    case 'vless':
      Object.assign(proxy, { uuid: server.uuid, encryption: server.encryption || 'none' });
      if (server.flow) proxy.flow = server.flow;
      if (server.packetEncoding) proxy['packet-encoding'] = server.packetEncoding;
      break;
    case 'vmess':
      Object.assign(proxy, {
        uuid: server.uuid,
        alterId: server.alterId ?? 0,
        cipher: server.vmessSecurity || 'auto',
      });
      break;
    case 'trojan':
    case 'anytls':
    case 'hysteria2':
      proxy.password = server.password;
      break;
    case 'tuic':
      Object.assign(proxy, { uuid: server.uuid, password: server.password });
      break;
    case 'shadowsocks': {
      const ss = server.shadowsocksSettings;
      Object.assign(proxy, { cipher: ss?.method, password: ss?.password });
      // Plugin strings have their own grammar. Keep them in the compatibility core
      // until parsed without changing values or silently dropping unknown options.
      if (ss?.plugin) throw new MihomoCompatibilityRequired('sing-box', 'Shadowsocks plugin');
      break;
    }
    case 'http':
    case 'socks':
      if (server.username !== undefined) proxy.username = server.username;
      if (server.password !== undefined) proxy.password = server.password;
      break;
    case 'snell':
      throw new MihomoCompatibilityRequired('sing-box', 'Snell options');
    case 'ssh':
      throw new MihomoCompatibilityRequired('sing-box', 'SSH options');
    case 'wireguard':
      throw new MihomoCompatibilityRequired('sing-box', 'WireGuard mesh policy');
    default:
      throw new MihomoCompatibilityRequired('sing-box', server.protocol);
  }

  const tlsEnabled =
    server.security === 'tls' ||
    server.security === 'reality' ||
    ['trojan', 'anytls', 'hysteria2', 'tuic'].includes(server.protocol);
  if (tlsEnabled) {
    Object.assign(proxy, { tls: true, 'skip-cert-verify': tls?.allowInsecure === true });
    const sniKey = ['vless', 'vmess'].includes(server.protocol) ? 'servername' : 'sni';
    proxy[sniKey] = tls?.serverName || server.address;
    if (tls?.alpn) proxy.alpn = clone(tls.alpn);
    if (tls?.fingerprint) proxy['client-fingerprint'] = tls.fingerprint;
    if (tls?.ech)
      proxy['ech-opts'] = { enable: true, ...(tls.echConfig ? { config: tls.echConfig } : {}) };
    if (tls?.fragment) throw new MihomoCompatibilityRequired('sing-box', 'TLS fragment');
    if (server.security === 'reality')
      proxy['reality-opts'] = {
        'public-key': server.realitySettings?.publicKey,
        'short-id': server.realitySettings?.shortId || '',
      };
  }
  const network = server.network || 'tcp';
  switch (network) {
    case 'tcp':
      break;
    case 'ws':
    case 'httpupgrade': {
      const early =
        network === 'ws'
          ? parseWsEarlyData(server.wsSettings?.path || '/')
          : {
              path: server.wsSettings?.path || '/',
              maxEarlyData: undefined,
              earlyDataHeaderName: undefined,
            };
      const maxEarlyData = early.maxEarlyData ?? server.wsSettings?.maxEarlyData;
      const earlyDataHeaderName =
        early.earlyDataHeaderName ?? server.wsSettings?.earlyDataHeaderName;
      proxy.network = 'ws';
      proxy['ws-opts'] = {
        path: early.path,
        ...(server.wsSettings?.headers ? { headers: clone(server.wsSettings.headers) } : {}),
        ...(maxEarlyData !== undefined ? { 'max-early-data': maxEarlyData } : {}),
        ...(earlyDataHeaderName ? { 'early-data-header-name': earlyDataHeaderName } : {}),
        ...(network === 'httpupgrade' ? { 'v2ray-http-upgrade': true } : {}),
      };
      break;
    }
    case 'grpc':
      if (server.grpcSettings?.multiMode)
        throw new MihomoCompatibilityRequired('sing-box', 'gRPC multiMode');
      proxy.network = 'grpc';
      proxy['grpc-opts'] = { 'grpc-service-name': server.grpcSettings?.serviceName || '' };
      break;
    case 'http':
      if (server.protocol !== 'vmess')
        throw new MihomoCompatibilityRequired('sing-box', `${server.protocol} HTTP transport`);
      proxy.network = 'http';
      proxy['http-opts'] = {
        method: server.httpSettings?.method || 'GET',
        path: [server.httpSettings?.path || '/'],
        headers: {
          ...clone(server.httpSettings?.headers || {}),
          ...(server.httpSettings?.host ? { Host: clone(server.httpSettings.host) } : {}),
        },
      };
      break;
    case 'xhttp': {
      const settings = parseXHttpSettings(server.xhttpSettings ?? {});
      // Native advanced XHTTP keeps its original dialect through compatibilitySettings.
      const keys = Object.keys(settings);
      if (keys.some((key) => !['host', 'path', 'mode'].includes(key)))
        throw new MihomoCompatibilityRequired('xray', 'advanced XHTTP fields');
      proxy.network = 'xhttp';
      proxy['xhttp-opts'] = clone(settings);
      break;
    }
    default:
      throw new Error(`Unknown transport: ${network}`);
  }
  if (server.multiplexSettings?.enabled) {
    const m = server.multiplexSettings;
    proxy.smux = {
      enabled: true,
      protocol: m.protocol || 'h2mux',
      ...(m.maxConnections !== undefined ? { 'max-connections': m.maxConnections } : {}),
      ...(m.minStreams !== undefined ? { 'min-streams': m.minStreams } : {}),
      ...(m.padding !== undefined ? { padding: m.padding } : {}),
    };
  }
  if (server.shadowTlsSettings)
    throw new MihomoCompatibilityRequired('sing-box', 'ShadowTLS settings');
  if (server.protocol === 'hysteria2') {
    const h = server.hysteria2Settings;
    if (h?.network || h?.disableChromeParrot)
      throw new MihomoCompatibilityRequired('sing-box', 'Hysteria2 transport fingerprint options');
    if (h?.upMbps !== undefined) proxy.up = `${h.upMbps} Mbps`;
    if (h?.downMbps !== undefined) proxy.down = `${h.downMbps} Mbps`;
    if (h?.bbrProfile) proxy['bbr-profile'] = h.bbrProfile;
    if (h?.serverPorts) proxy.ports = h.serverPorts.replace(/:/g, '-');
    if (h?.hopInterval) proxy['hop-interval'] = seconds(h.hopInterval);
    if (h?.obfs)
      Object.assign(proxy, {
        obfs: h.obfs.type || 'salamander',
        'obfs-password': h.obfs.password,
        ...(h.obfs.minPacketSize !== undefined
          ? { 'obfs-min-packet-size': h.obfs.minPacketSize }
          : {}),
        ...(h.obfs.maxPacketSize !== undefined
          ? { 'obfs-max-packet-size': h.obfs.maxPacketSize }
          : {}),
      });
  }
  if (server.protocol === 'tuic') {
    const t = server.tuicSettings;
    if (t?.congestionControl) proxy['congestion-controller'] = t.congestionControl;
    if (t?.udpRelayMode) proxy['udp-relay-mode'] = t.udpRelayMode;
    if (t?.zeroRttHandshake !== undefined) proxy['reduce-rtt'] = t.zeroRttHandshake;
    if (t?.heartbeat) proxy['heartbeat-interval'] = seconds(t.heartbeat) * 1000;
  }
  if (server.protocol === 'anytls') {
    const a = server.anyTlsSettings;
    if (a?.idleSessionCheckInterval)
      proxy['idle-session-check-interval'] = seconds(a.idleSessionCheckInterval);
    if (a?.idleSessionTimeout) proxy['idle-session-timeout'] = seconds(a.idleSessionTimeout);
    if (a?.minIdleSession !== undefined) proxy['min-idle-session'] = a.minIdleSession;
  }
  return proxy;
}

function seconds(duration: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(duration);
  if (!match) throw new Error('Invalid protocol duration');
  return Number(match[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]]!;
}
