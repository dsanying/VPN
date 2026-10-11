import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { registerIpcHandler } from '../ipc-handler';
import { GlobalUpdateService } from '../../services/GlobalUpdateService';
import type { UpdateKind } from '../../../shared/global-update';
import { UpdateService } from '../../services/UpdateService';
import type { UpdateCheckResult, UpdateInfo } from '../../../shared/types/update';

let updateService: UpdateService | null = null;
let globalUpdates: GlobalUpdateService | null = null;
export function setGlobalUpdateService(service: GlobalUpdateService): void {
  globalUpdates = service;
}

export function setUpdateService(service: UpdateService): void {
  updateService = service;
}

export function registerUpdateHandlers(): void {
  registerIpcHandler<{ includePrerelease?: boolean; statusOnly?: boolean }, UpdateCheckResult>(
    IPC_CHANNELS.UPDATE_CHECK,
    async (_event: IpcMainInvokeEvent, args) => {
      if (!updateService) {
        return { hasUpdate: false, error: 'UpdateService not initialized' };
      }
      if (globalUpdates) {
        const snapshot = args?.statusOnly
          ? globalUpdates.getSnapshot()
          : await globalUpdates.checkVersions();
        return {
          hasUpdate: snapshot.items.some(
            (item) => (item.kind === 'software' || item.kind === 'core') && item.status === 'ready'
          ),
          globalUpdates: snapshot,
        };
      }
      return await updateService.prepareUpdate(args?.includePrerelease ?? false);
    }
  );

  registerIpcHandler<
    { updateInfo: UpdateInfo },
    { success: boolean; filePath?: string; error?: string }
  >(IPC_CHANNELS.UPDATE_DOWNLOAD, async (_event: IpcMainInvokeEvent, args) => {
    if (!updateService) {
      return { success: false, error: 'UpdateService not initialized' };
    }
    if (!args?.updateInfo) {
      return { success: false, error: 'Missing updateInfo' };
    }
    const filePath = await updateService.downloadUpdate(args.updateInfo);
    if (filePath) {
      return { success: true, filePath };
    }
    return { success: false, error: '下载失败' };
  });

  registerIpcHandler<
    { filePath?: string; kind?: UpdateKind },
    { success: boolean; error?: string }
  >(IPC_CHANNELS.UPDATE_INSTALL, async (_event: IpcMainInvokeEvent, args) => {
    if (!updateService) {
      return { success: false, error: 'UpdateService not initialized' };
    }
    if (args?.kind && globalUpdates) {
      if (!['software', 'core', 'data', 'subscriptions'].includes(args.kind))
        throw new Error('Invalid update kind');
      await globalUpdates.apply(args.kind);
      return { success: true };
    }
    if (!args?.filePath) {
      return { success: false, error: 'Missing filePath' };
    }
    const success = await updateService.installUpdate(args.filePath);
    return { success };
  });

  registerIpcHandler<{ version: string }, { success: boolean }>(
    IPC_CHANNELS.UPDATE_SKIP,
    async (_event: IpcMainInvokeEvent, args) => {
      if (!updateService) {
        return { success: false };
      }
      if (args?.version) {
        updateService.skipVersion(args.version);
      }
      return { success: true };
    }
  );

  registerIpcHandler<void, { success: boolean }>(IPC_CHANNELS.UPDATE_OPEN_RELEASES, async () => {
    if (updateService) {
      updateService.openReleasesPage();
    }
    return { success: true };
  });
}
