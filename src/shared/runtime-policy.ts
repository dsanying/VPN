import type { UserConfig } from './types';

/** Application-managed policies; persisted legacy switches cannot override them. */
export const RUNTIME_POLICY = Object.freeze({ fakeIp: true, logLevel: 'info' as const });

/** Only proxy traffic receives QUIC rejection; explicit direct routes remain untouched. */
export function protectProxyQuic(config: Pick<UserConfig, 'proxyMode' | 'servers'>): boolean {
  return config.proxyMode !== 'direct' && (config.servers?.length ?? 0) > 0;
}
