import type { ServerConfig, XHttpSettings } from './types';

export type CompatibilityEngine = 'xray' | 'mihomo';
export interface CoreBridge {
  port: number;
  username: string;
  password: string;
}

export function compatibilityEngine(server: ServerConfig): CompatibilityEngine | undefined {
  if (server.compatibilitySettings) return server.compatibilitySettings.engine;
  if (
    server.network === 'xhttp' ||
    (server.protocol === 'vless' && server.encryption && server.encryption !== 'none')
  )
    return 'xray';
  return undefined;
}

export function parseXHttpSettings(value: unknown): XHttpSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('XHTTP settings must be an object');
  const settings = JSON.parse(JSON.stringify(value)) as XHttpSettings;
  for (const key of ['host', 'path']) {
    if (settings[key] !== undefined && typeof settings[key] !== 'string')
      throw new Error(`Invalid XHTTP ${key}`);
  }
  if (
    settings.mode !== undefined &&
    !['auto', 'packet-up', 'stream-up', 'stream-one'].includes(settings.mode)
  )
    throw new Error('Invalid XHTTP mode');
  if (
    settings.extra !== undefined &&
    (!settings.extra || typeof settings.extra !== 'object' || Array.isArray(settings.extra))
  )
    throw new Error('Invalid XHTTP extra');
  return settings;
}
