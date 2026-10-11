import { ConfigRepository } from '@shared/config-repository';
import { createDefaultConfig } from '@shared/config-defaults';
import { clearRetiredConfigData } from '@shared/retired-config-data';
import { applyAndroidConfigPolicy } from '@shared/android-config-policy';
import type { ShadowVpnNative } from './native-contract';

export function androidConfigRepository(native: ShadowVpnNative): ConfigRepository {
  let revision: string | null = null;
  return new ConfigRepository(
    {
      read: async (name) => {
        const record = await native.readState({ name });
        revision = record.revision;
        return record.content;
      },
      write: async (name, content) => {
        const committed = await native.writeState({ name, content, expectedRevision: revision });
        revision = committed.revision ?? null;
      },
    },
    () => {
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      return createDefaultConfig(secret);
    },
    (config) => {
      clearRetiredConfigData(config);
    },
    applyAndroidConfigPolicy
  );
}
