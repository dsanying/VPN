import { prepareAutomaticTakeover } from '../shared/automatic-takeover';
/** 启动安全窗口负责内核落位和用户选择的自动连接；后台检查由统一维护周期负责。 */

import type { LogManager } from './services/LogManager';
import type { ConfigManager } from './services/ConfigManager';
import type { ProxyManager } from './services/ProxyManager';
import type { CoreUpdateService } from './services/CoreUpdateService';
import { getWarpDeregisterQueue } from './services/WarpDeregisterQueue';

/** 注入依赖：服务单例 + proxyManager getter（call-time 取值）+ 托盘状态刷新。 */
export interface StartupTaskDeps {
  configManager: ConfigManager;
  coreUpdateService: CoreUpdateService;
  logManager: LogManager;
  getProxyManager: () => ProxyManager | null;
  updateTrayMenuState: (isProxyRunning: boolean, hasError?: boolean) => void;
}

/**
 * 调度自动连接与待注销队列清理，独立于后台维护时钟。
 */
export function scheduleStartupTasks(deps: StartupTaskDeps): void {
  const { configManager, coreUpdateService, logManager, getProxyManager, updateTrayMenuState } =
    deps;

  // 启动时自动连接（延迟 2 秒，等待窗口和服务初始化完成）
  setTimeout(async () => {
    const proxyManager = getProxyManager();
    try {
      const config = prepareAutomaticTakeover(await configManager.loadConfig());

      // 内核自动更新：App 启动序列的安全窗口（代理尚未 autoConnect）→ 先尝试落位上轮暂存的 staged 内核，
      // 再做版本变更检测+autoConnect。落位仅在代理未运行时发生（此刻必然未连），不断流硬不变量。
      try {
        await coreUpdateService.tryApplyStaged('startup');
      } catch (stagedErr) {
        logManager.addLog('warn', `启动期落位 staged 内核异常: ${stagedErr}`, 'Main');
      }

      // 启动期随包核对齐（用户反馈：部署/自更新新随包核后运行时受保护核不自愈、须连接才刷新）：helper 在位=静默 reseed；
      // 无 helper 孤儿态 = 一次性 osascript 授权兜底（首启弹一次，防每启弹）。安全窗口 = 代理未连（此刻必然未连）。
      try {
        const r = await proxyManager?.reseedBundledCoreOnStartup();
        if (r?.needsMacElevatedReseed) {
          await coreUpdateService.tryElevatedReseedProtectedCoreOnStartup(r.bundledVersion);
        }
      } catch (reseedErr) {
        logManager.addLog('warn', `启动期随包核对齐异常: ${reseedErr}`, 'Main');
      }

      // 启动期「内核版本变更」横幅已移除：基线对齐缺收口 → 每次启动重复弹扰民（基线 core-version.json 与实际核不一致
      // 时反复触发）。更新当下已有一次性反馈（applyStagedNow 的 EVENT_CORE_VERSION_CHANGED），回滚入口常驻内核管理设置，
      // 故启动期不再主动弹。

      if (config.autoConnect && config.selectedServerId) {
        logManager.addLog('info', '启动时自动连接已启用，正在连接...', 'Main');

        if (proxyManager) {
          // 系统代理 enable/clear 已收口于 start()（拆双轨），自动连接不再重复设置。
          await proxyManager.start(config);

          logManager.addLog('info', '启动时自动连接成功', 'Main');
          updateTrayMenuState(true);
        }
      } else if (config.autoConnect && !config.selectedServerId) {
        logManager.addLog('warn', '启动时自动连接已启用，但未选择服务器', 'Main');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logManager.addLog('error', `启动时自动连接失败: ${errorMessage}`, 'Main');
      updateTrayMenuState(false, true);
    }
  }, 2000);

  // 启动后机会式 drain WARP 待注销队列（延迟 8 秒，让网络/服务先就绪；fire-and-forget 不阻塞、绝不抛）。
  // 与「成功注册 WARP 后」并为两个触发点；无常驻定时器——不重开 app 者既不 drain 也不产生新孤儿（副作用自洽）。
  // 复用进程内单例（与 server-handlers 同实例）：串行链覆盖启动 drain 与删除入队，杜绝跨实例并发写同一队列文件。
  setTimeout(() => {
    getWarpDeregisterQueue(logManager).drainInBackground();
  }, 8000);
}
