import type { Protocol } from './types';
/** Supported domain, independent of the current records or a filtered page. */
const supported: Record<Protocol, true> = {
  vless: true,
  trojan: true,
  hysteria2: true,
  shadowsocks: true,
  anytls: true,
  tuic: true,
  vmess: true,
  naive: true,
  snell: true,
  socks: true,
  http: true,
  ssh: true,
  wireguard: true,
  tailscale: true,
  custom: true,
  enterprise: true,
};
export const NODE_PROTOCOLS = Object.keys(supported) as Protocol[];
