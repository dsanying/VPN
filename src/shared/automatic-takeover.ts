import type { UserConfig } from './types';

/**
 * TUN is the only takeover mode. OS proxy preferences remain user-owned.
 *
 * TUN 连接恒接管系统 DNS：TUN 的路由劫持抓不到 macOS scoped resolver——系统解析器绑定物理
 * 接口直连 LAN DNS（真机实测：本机应用 getaddrinfo 恒拿真实 IP，FakeIP 对本机应用不生效、
 * 无 SNI 协议无法按域名规则分流），只有把系统 DNS 指向隧道内地址，查询才会经 hijack-dns
 * 真进 sing-box。接管由 SystemDnsManager 全程托管（marker + 停止/退出/崩溃恢复 + 启动
 * reconcile），不留半接管残留。无开关：不存在「TUN 但不接管系统 DNS」的形态。
 */
export function prepareAutomaticTakeover(config: UserConfig): UserConfig {
  if (
    config.proxyModeType === 'tun' &&
    config.tunConfig?.autoRoute === true &&
    config.forceTun !== true
  )
    return config;
  return {
    ...config,
    proxyModeType: 'tun',
    forceTun: false,
    tunConfig: { ...config.tunConfig, autoRoute: true },
  };
}
