import type { UserConfig } from '@shared/types';
import type { ConfigRepository } from '@shared/config-repository';
import { PortableCoreController } from '@shared/portable-core-controller';
import { buildAndroidCoreConfig, type AndroidCoreHost } from '@shared/android-core-config';
import type { ShadowVpnNative } from './native-contract';

export function createAndroidCoreController(
  repository: ConfigRepository,
  prepareHost: (config: UserConfig) => Promise<Omit<AndroidCoreHost, 'stateDirectory'>>,
  native: ShadowVpnNative
): PortableCoreController {
  return new PortableCoreController(
    repository,
    {
      status: () => native.status(),
      checkConfig: (options) => native.checkConfig(options),
      start: (options) => native.start(options),
      appliedReceipt: () => native.appliedReceipt(),
      stop: () => native.stop(),
      subscribe: async (listener) => {
        const handle = await native.addListener('statusChanged', listener);
        return () => {
          void handle.remove();
        };
      },
    },
    async (config) => {
      const environment = await native.coreEnvironment();
      const host = await prepareHost(config);
      return JSON.stringify(
        buildAndroidCoreConfig(config, { ...host, stateDirectory: environment.stateDirectory })
      );
    }
  );
}
