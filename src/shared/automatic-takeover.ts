import type { UserConfig } from './types';

/** TUN is the only takeover mode. OS proxy preferences and DNS servers remain user-owned. */
export function prepareAutomaticTakeover(config: UserConfig): UserConfig {
  if (
    config.proxyModeType === 'tun' &&
    config.tunConfig?.autoRoute === true &&
    (!config.dnsConfig || config.dnsConfig.takeoverSystemDns === false) &&
    config.forceTun !== true
  )
    return config;
  return {
    ...config,
    proxyModeType: 'tun',
    forceTun: false,
    tunConfig: { ...config.tunConfig, autoRoute: true },
    dnsConfig: config.dnsConfig ? { ...config.dnsConfig, takeoverSystemDns: false } : undefined,
  };
}
