/**
 * 测速相关 IPC 处理器
 */

import { IpcMainInvokeEvent } from 'electron';
import * as net from 'net';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { registerIpcHandler } from '../ipc-handler';
import { ConfigManager } from '../../services/ConfigManager';

/**
 * 注册测速相关的 IPC 处理器
 */
export function registerSpeedTestHandlers(configManager: ConfigManager): void {
  // 服务器测速
  registerIpcHandler<void, Record<string, number>>(
    IPC_CHANNELS.SERVER_SPEED_TEST,
    async (_event: IpcMainInvokeEvent) => {
      const config = await configManager.loadConfig();
      const results: Record<string, number> = {};

      const testPromises = config.servers.map(async (server) => {
        const start = Date.now();
        try {
          await new Promise<void>((resolve, reject) => {
            const socket = new net.Socket();
            const timeout = 5000; // 5秒超时

            socket.setTimeout(timeout);

            socket.on('connect', () => {
              socket.destroy();
              resolve();
            });

            socket.on('timeout', () => {
              socket.destroy();
              reject(new Error('Timeout'));
            });

            socket.on('error', (err) => {
              socket.destroy();
              reject(err);
            });

            socket.connect(server.port, server.address);
          });

          // 连接成功，记录耗时
          results[server.id] = Date.now() - start;
        } catch (error) {
          // 连接失败或超时，记录为 -1
          results[server.id] = -1;
        }
      });

      await Promise.all(testPromises);
      return results;
    }
  );

  console.log('[SpeedTest Handlers] Registered speed test IPC handlers');
}
