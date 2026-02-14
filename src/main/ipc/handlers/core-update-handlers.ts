import { registerIpcHandler } from '../ipc-handler';
import { CoreUpdateService } from '../../services/CoreUpdateService';
import { LogManager } from '../../services/LogManager';

let coreUpdateService: CoreUpdateService | null = null;


export function setCoreUpdateService(service: CoreUpdateService, _logger: LogManager) {
  coreUpdateService = service;
}

export function registerCoreUpdateHandlers() {
  registerIpcHandler('core-update:check', async () => {
    if (!coreUpdateService) {
      throw new Error('CoreUpdateService not initialized');
    }
    return await coreUpdateService.checkUpdate();
  });

  registerIpcHandler('core-update:update', async (_, downloadUrl: string) => {
    if (!coreUpdateService) {
      throw new Error('CoreUpdateService not initialized');
    }
    return await coreUpdateService.updateCore(downloadUrl);
  });

  registerIpcHandler('core-update:get-version', async () => {
    if (!coreUpdateService) {
      throw new Error('CoreUpdateService not initialized');
    }
    return await coreUpdateService.getCurrentVersion();
  });
}
