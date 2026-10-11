import type { ServerConfig } from '../../shared/types';
import { buildMihomoProxy, MihomoCompatibilityRequired } from './mihomo-proxy-builder';

export function mihomoCompatibilityEngine(server: ServerConfig): 'sing-box' | 'xray' | undefined {
  try {
    buildMihomoProxy(server, 'capability-check');
    return undefined;
  } catch (error) {
    if (error instanceof MihomoCompatibilityRequired) return error.engine;
    throw error;
  }
}
