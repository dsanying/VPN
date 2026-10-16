import { prepareAutomaticTakeover } from '../shared/automatic-takeover';
/** Shared Dock and tray actions use the current client routes and business services. */

import { app, BrowserWindow } from 'electron';
import type { LogManager } from './services/LogManager';
import type { ConfigManager } from './services/ConfigManager';
import type { ProxyManager } from './services/ProxyManager';
import type { SpeedTestService } from './services/SpeedTestService';
import type { TrayManager } from './services/TrayManager';
import type { ProxyMode } from '../shared/types';
import { ipcEventEmitter } from './ipc/ipc-events';
import { resourceManager } from './services/ResourceManager';
import { runSpeedTest } from './services/speed-test-runner';
import { releaseWindowMemory } from './services/window-memory';

/** 注入依赖：服务单例（值，tray 创建前已初始化）+ 可变引用 getter（call-time 取值）+ 主进程局部动作。 */
export interface TrayActionDeps {
  getMainWindow: () => BrowserWindow | null;
  getTrayManager: () => TrayManager | null;
  getProxyManager: () => ProxyManager | null;
  logManager: LogManager;
  configManager: ConfigManager;
  speedTestService: SpeedTestService;
  showWindow: (route?: string) => void | Promise<void>;
  updateTrayMenuState: (isProxyRunning: boolean, hasError?: boolean) => void;
  /**
   * 标记「即将发生的窗口销毁是轻量模式触发的」，供 window-all-closed 据此跳过 minimizeToTray 退出判定
   * ——轻量模式（手动/10 分钟空闲自动）语义上恒不应退出 app（代理不中断），与「用户点关闭按钮」是两件
   * 不同的事，但两者都会让窗口计数归零、触发同一个原生 window-all-closed 事件，需要这个信号区分。
   */
  markLightweightModeTransition: () => void;
}

/**
 * 构造 TrayManager 的回调对象（与 whenReady 内原内联回调逐字等价）。
 */
export function buildTrayCallbacks(deps: TrayActionDeps) {
  const {
    getMainWindow,
    getTrayManager,
    getProxyManager,
    logManager,
    configManager,
    speedTestService,
    showWindow,
    updateTrayMenuState,
    markLightweightModeTransition,
  } = deps;

  return {
    onStartProxy: async () => {
      const proxyManager = getProxyManager();
      try {
        const config = prepareAutomaticTakeover(await configManager.loadConfig());
        // helper 引导已收敛到 ProxyManager.start() 单点（promptHelperGate 注入），托盘启动自动覆盖。
        if (proxyManager) {
          // 系统代理 enable/clear 已收口于 start()（拆双轨），托盘不再重复设置。
          await proxyManager.start(config);

          logManager.addLog('info', 'Proxy started from tray', 'Main');
          updateTrayMenuState(true);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logManager.addLog('error', `Failed to start proxy: ${errorMessage}`, 'Main');
      }
    },
    onStopProxy: async () => {
      const proxyManager = getProxyManager();
      try {
        // 用户主动停止：先清系统代理（stop() 前调，stopping 仍 false → 会真正清）。经 ensureSystemProxyCleared
        // 的 marker + 指向门控，仅清 暗影VPN 自己设置的，不 stomp 用户自配/TUN 模式（修 M4）。
        if (proxyManager) {
          await proxyManager.ensureSystemProxyCleared().catch(() => {});
          await proxyManager.stop();
          logManager.addLog('info', 'Proxy stopped from tray', 'Main');
          updateTrayMenuState(false);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logManager.addLog('error', `Failed to stop proxy: ${errorMessage}`, 'Main');
      }
    },
    onShowWindow: () => {
      void showWindow();
    },
    onQuit: () => {
      // 收敛到单一退出管线：app.quit() → before-quit(置 isQuitting) → close 放行 → will-quit → cleanupResources → exit
      app.quit();
    },
    onSelectServer: async (serverId: string) => {
      const proxyManager = getProxyManager();
      try {
        const config = prepareAutomaticTakeover(await configManager.loadConfig());
        config.selectedServerId = serverId;
        await configManager.saveConfig(config);
        logManager.addLog('info', `Server selected from tray: ${serverId}`, 'Main');

        // 如果代理正在运行，应用新服务器：切节点走 switchMode（clash_api 热切换、不断流），
        // 失败自动退回重启——与渲染端切换路径行为一致，避免托盘切节点硬重启断流。
        if (proxyManager && proxyManager.getStatus().running) {
          await proxyManager.switchMode(config);
          logManager.addLog('info', 'Applied server switch from tray', 'Main');
        }

        updateTrayMenuState(proxyManager?.getStatus().running ?? false);
        ipcEventEmitter.sendToAll('event:configChanged', { newValue: config });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logManager.addLog('error', `Failed to select server: ${errorMessage}`, 'Main');
      }
    },
    onChangeProxyMode: async (mode: ProxyMode) => {
      const proxyManager = getProxyManager();
      try {
        const config = prepareAutomaticTakeover({
          ...(await configManager.loadConfig()),
          proxyMode: mode,
        });
        await configManager.saveConfig(config);
        logManager.addLog('info', `Proxy mode changed from tray: ${mode}`, 'Main');

        // 如果代理正在运行，重启以应用新模式（走 restart()：start 腿失败会清残留系统代理，防死端口断网）
        if (proxyManager && proxyManager.getStatus().running) {
          await proxyManager.restart(config);
          logManager.addLog('info', 'Proxy restarted with new mode', 'Main');
        }

        updateTrayMenuState(proxyManager?.getStatus().running ?? false);
        ipcEventEmitter.sendToAll('event:configChanged', { newValue: config });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logManager.addLog('error', `Failed to change proxy mode: ${errorMessage}`, 'Main');
        // helper gate 取消等导致 start 中止 → 代理已停，刷新托盘态防显示陈旧「运行中」
        updateTrayMenuState(proxyManager?.getStatus().running ?? false);
      }
    },
    onOpenSettings: () => {
      void showWindow('/settings');
    },
    onManageServers: () => {
      void showWindow('/nodes/groups');
    },
    onSpeedTest: async () => {
      // 全量测速经唯一编排器 runSpeedTest：传播副作用（渲染广播 + 托盘回写 + 测速态）统一在一处。
      // notifyTrayToast:true —— 托盘入口需要完成汇总 toast（App.tsx 监听 RESULT_LIST）；渲染入口不传（use-speed-test 自弹）。
      // runSpeedTest 内已记日志 + 复位测速态后 rethrow（IPC 入口需要它）；托盘入口 fire-and-forget，此处吞掉避免未处理 rejection。
      await runSpeedTest(
        {
          configManager,
          speedTestService,
          entryHelperPath: resourceManager.getEntryProbeHelperPath(),
          isTunActive: () => {
            const manager = getProxyManager();
            return !!manager?.getStatus().running && manager.isTunModeNow();
          },
          getMainWindow,
          getTrayManager,
          logManager,
        },
        { notifyTrayToast: true }
      ).catch(() => {});
    },
    onLightweightMode: () => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        markLightweightModeTransition();
        releaseWindowMemory({
          window: mainWindow,
          logManager,
          clearLogsAndGc: true,
          reason: 'lightweight-mode',
        });
      }
    },
  };
}
