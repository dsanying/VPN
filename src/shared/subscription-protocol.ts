import type { ServerConfig, Protocol } from './types';
export const SUBSCRIPTION_PROTOCOLS = [
  'auto',
  'vmess',
  'vless',
  'shadowsocks',
  'trojan',
  'hysteria2',
  'tuic',
  'anytls',
  'snell',
  'socks',
  'http',
  'ssh',
  'naive',
  'wireguard',
] as const;
export function selectSubscriptionProtocol(
  servers: ServerConfig[],
  preference?: Protocol | 'auto'
): ServerConfig[] {
  if (!preference || preference === 'auto') return servers;
  if (!(SUBSCRIPTION_PROTOCOLS as readonly string[]).includes(preference))
    throw new Error('Unsupported subscription protocol');
  const selected = servers.filter((server) => server.protocol === preference);
  if (!selected.length) throw new Error(`订阅没有所选协议：${preference}（0 个可用节点）`);
  return selected;
}
