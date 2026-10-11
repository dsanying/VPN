import type { ConfigRepository } from '@shared/config-repository';
import type { AndroidCoreHost } from '@shared/android-core-config';
import { buildAndroidNodeProbeConfig } from '@shared/android-node-probe-config';
import type { PortableNodeProbe } from '@shared/portable-node-measurements';
import type { ShadowVpnNative } from './native-contract';

export function createAndroidNodeProbe(
  repository: ConfigRepository,
  prepareHost: () => Promise<Omit<AndroidCoreHost, 'stateDirectory'>>,
  native: ShadowVpnNative
): PortableNodeProbe {
  return {
    async measure(node, target, signal) {
      signal.throwIfAborted();
      const [environment, host, saved] = await Promise.all([
        native.coreEnvironment(),
        prepareHost(),
        repository.read(),
      ]);
      signal.throwIfAborted();
      const compiled = buildAndroidNodeProbeConfig(node, saved, {
        ...host,
        stateDirectory: environment.stateDirectory,
      });
      const id = crypto.randomUUID();
      const cancel = () => {
        void native.cancelProbe({ id }).catch(() => undefined);
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const value = await native.measureNode({
          id,
          ...compiled,
          target,
          address: node.address,
          port: node.port,
        });
        signal.throwIfAborted();
        return value;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
  };
}
