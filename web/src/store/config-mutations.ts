import { useAppStore } from './app-store';
import type { UserConfig } from '@shared/types';
let writes: Promise<void> = Promise.resolve();
/** 每次写入基于前一次提交后的配置，失败不阻塞后续操作。 */
export function patchConfig(update: (current: UserConfig) => UserConfig): Promise<void> {
  const write = writes.then(async () => {
    const current = useAppStore.getState().config;
    if (!current) throw new Error('Configuration is unavailable');
    await useAppStore.getState().saveConfig(update(current));
  });
  writes = write.catch(() => {});
  return write;
}
