import { prepareAutomaticTakeover } from '../../../shared/automatic-takeover';
import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import type { UserConfig, ProxyMode } from '../../../shared/types';
import { registerIpcHandler } from '../ipc-handler';
import { ConfigManager } from '../../services/ConfigManager';
import { ipcEventEmitter } from '../ipc-events';
import { mainEventEmitter, MAIN_EVENTS } from '../main-events';
import { clearSingboxDashboardCache } from './helper-handlers';

// SecAudit M5：单键 IPC 通道的键准入。
// 禁读：CONFIG_GET 刻意剥离 privacyPassword（F29），单键读取不得绕过；clashApiSecret 同理。
// 可写：仅 UI「单键即时生效」的既有键。servers/privacyPassword/clashApiSecret 等由 CONFIG_SAVE 全量校验
// 或专用 IPC 通道管理，开放任意 keyof UserConfig 会绕过 validateConfig 的入库校验边界。
const SENSITIVE_SINGLE_KEYS: Record<string, true> = {
  privacyPassword: true,
  clashApiSecret: true,
};
const SINGLE_KEY_WRITABLE: Record<string, true> = { uiTheme: true };

export function registerConfigHandlers(configManager: ConfigManager): void {
  registerIpcHandler<void, UserConfig>(
    IPC_CHANNELS.CONFIG_GET,
    async (_event: IpcMainInvokeEvent) => {
      const cfg = prepareAutomaticTakeover(await configManager.loadConfig());
      // F29：绝不向渲染端下发隐私密码（迁移前的残留明文也一并剥除；哈希本就不在 config 内）
      return { ...cfg, privacyPassword: undefined };
    }
  );

  registerIpcHandler<UserConfig, void>(
    IPC_CHANNELS.CONFIG_SAVE,
    async (_event: IpcMainInvokeEvent, config: UserConfig) => {
      config = prepareAutomaticTakeover(config);
      // 检测面板 download_url 覆盖变更：改了 → 删本地缓存目录，使核下次启动（CONFIG_CHANGED→switchMode 重启）
      // 因目录为空从新 URL 重拉资源。空白归一为 undefined 再比，避免 ''↔undefined 误判变更。在 saveConfig 前取旧值。
      const priorDashUrl = configManager.get<string>('singboxDashboardUrl')?.trim() || undefined;
      const nextDashUrl = config.singboxDashboardUrl?.trim() || undefined;
      if (priorDashUrl !== nextDashUrl) {
        clearSingboxDashboardCache();
      }

      await configManager.saveConfig(config);

      if (config.uiTheme) {
        const { nativeTheme, BrowserWindow } = require('electron');
        nativeTheme.themeSource = config.uiTheme;
        // 同步原生窗口背景色，防止 GPU 待机后圆角处黑色伪影
        const isDark = nativeTheme.shouldUseDarkColors;
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.setBackgroundColor(
              process.platform === 'darwin' ? '#00000000' : isDark ? '#121217' : '#f1f5f9'
            );
          }
        }
      }

      ipcEventEmitter.sendToAll('event:configChanged', { newValue: config });
      // 触发主进程内部事件，用于更新托盘菜单等
      mainEventEmitter.emit(MAIN_EVENTS.CONFIG_CHANGED, config);
    }
  );

  registerIpcHandler<{ mode: ProxyMode }, void>(
    IPC_CHANNELS.CONFIG_UPDATE_MODE,
    async (_event: IpcMainInvokeEvent, args: { mode: ProxyMode }) => {
      // 回调内先改 proxyMode 再套 takeover 归一（prepareAutomaticTakeover 可能返回新对象，
      // Object.assign 把结果拷回链上 config，保证落盘的就是归一后的值）。
      const config = await configManager.mutateConfig((config) => {
        config.proxyMode = args.mode;
        Object.assign(config, prepareAutomaticTakeover(config));
      });
      ipcEventEmitter.sendToAll('event:configChanged', { newValue: config });
      mainEventEmitter.emit(MAIN_EVENTS.CONFIG_CHANGED, config);
    }
  );

  registerIpcHandler<{ key: keyof UserConfig }, any>(
    IPC_CHANNELS.CONFIG_GET_VALUE,
    async (_event: IpcMainInvokeEvent, args: { key: keyof UserConfig }) => {
      // SecAudit M5：CONFIG_GET 对 privacyPassword 剥离（F29），单键读取不得绕过——迁移期残留明文
      // 一旦经此通道回传渲染端，等价于把 F29 的口子重开。clashApiSecret 同理不单键下发。
      if (SENSITIVE_SINGLE_KEYS[args.key as string]) {
        throw new Error(`禁止通过 config:getValue 读取敏感键: ${String(args.key)}`);
      }
      return configManager.get(args.key);
    }
  );

  registerIpcHandler<{ key: keyof UserConfig; value: any }, void>(
    IPC_CHANNELS.CONFIG_SET_VALUE,
    async (_event: IpcMainInvokeEvent, args: { key: keyof UserConfig; value: any }) => {
      // 单键写白名单（SecAudit M5）：CONFIG_SET 整份保存走 validateConfig 全量校验，
      // 而 set() 单键路径绕过——任意 keyof UserConfig 可写会破坏「入库即校验」边界
      //（如 servers/privacyPassword 由专用 IPC 通道管理）。仅放行 UI 单键设置的既有键。
      if (!SINGLE_KEY_WRITABLE[args.key as string]) {
        throw new Error(`不允许通过 config:setValue 修改配置键: ${String(args.key)}`);
      }
      // set() 本身已是 mutateConfig 临界区单键写；此处再经 mutateConfig 把 takeover 归一落进同次配置，
      // 拿到的 config 即为归一后值（prepareAutomaticTakeover 可能换新对象 → Object.assign 拷回）。
      await configManager.set(args.key, args.value);
      const config = await configManager.mutateConfig((config) => {
        Object.assign(config, prepareAutomaticTakeover(config));
      });

      if (args.key === 'uiTheme') {
        const { nativeTheme, BrowserWindow } = require('electron');
        nativeTheme.themeSource = args.value;
        // 同步原生窗口背景色，防止 GPU 待机后圆角处黑色伪影
        const isDark = nativeTheme.shouldUseDarkColors;
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.setBackgroundColor(
              process.platform === 'darwin' ? '#00000000' : isDark ? '#121217' : '#f1f5f9'
            );
          }
        }
      }

      ipcEventEmitter.sendToAll('event:configChanged', { newValue: config });
      mainEventEmitter.emit(MAIN_EVENTS.CONFIG_CHANGED, config);
    }
  );

  registerIpcHandler<void, boolean>(
    IPC_CHANNELS.CONFIG_GET_PRIVACY_MODE,
    async (_event: IpcMainInvokeEvent) => {
      const { getPrivacyMode } = require('../../index');
      return getPrivacyMode();
    }
  );

  registerIpcHandler<boolean, void>(
    IPC_CHANNELS.CONFIG_SET_PRIVACY_MODE,
    async (_event: IpcMainInvokeEvent, value: boolean) => {
      const { setPrivacyMode } = require('../../index');
      setPrivacyMode(value);
    }
  );
}
