import { RUNTIME_POLICY } from '../shared/runtime-policy';
import { prepareAutomaticTakeover } from '../shared/automatic-takeover';
/**
 * 配置变更监听器 —— 从 index.ts whenReady 抽出。
 *
 * 监听 MAIN_EVENTS.CONFIG_CHANGED：运行日志策略同步 / 托盘刷新 / 运行中切配置(switchMode 热切换) /
 * 自动换节点开关同步。经 deps 注入主进程服务与可变引用
 * （proxyManager/autoSwitchService 用 getter 取 call-time 当前值）+ index.ts 函数
 * （getPrivacyMode/updateTrayMenuState，注入避免重建 TrayManager 已断的服务→入口循环依赖）。
 * 无 config 快照网（app 生命周期域）；真机冒烟验证（自动换节点开关/语言 等热生效）。
 */

import type { UserConfig } from '../shared/types';
import type { LogManager } from './services/LogManager';
import type { ConfigManager } from './services/ConfigManager';
import type { ProxyManager } from './services/ProxyManager';
import type { AutoSwitchService } from './services/AutoSwitchService';
import { mainEventEmitter, MAIN_EVENTS } from './ipc/main-events';
import { effectiveLogLevel } from '../shared/log-level';
import { setDesktopNotificationsEnabled } from './notify-user';

/** 注入依赖：服务单例/可变引用 getter（call-time 取值）+ index.ts 闭包/函数（注入防循环依赖）。 */
export interface ConfigChangeDeps {
  configManager: ConfigManager;
  logManager: LogManager;
  getProxyManager: () => ProxyManager | null;
  getAutoSwitchService: () => AutoSwitchService | null;
  updateTrayMenuState: (isProxyRunning: boolean, hasError?: boolean) => void;
  getPrivacyMode: () => boolean;
  /** 据最新 config.language（读 configManager 缓存）重设主进程 i18n；注入自 index.ts（需系统偏好，避免本文件依赖 electron）。 */
  applyLanguageFromConfig: () => void;
}

/**
 * 注册 CONFIG_CHANGED 监听器（与 whenReady 内原内联 mainEventEmitter.on 逐字等价）。
 */
export function registerConfigChangeListener(deps: ConfigChangeDeps): void {
  const {
    configManager,
    logManager,
    getProxyManager,
    getAutoSwitchService,
    updateTrayMenuState,
    getPrivacyMode,
    applyLanguageFromConfig,
  } = deps;

  mainEventEmitter.on(MAIN_EVENTS.CONFIG_CHANGED, async (changedConfig?: UserConfig) => {
    const proxyManager = getProxyManager();
    const autoSwitchService = getAutoSwitchService();
    // 语言热同步：据最新 config.language（configManager 缓存）重设主进程 i18n，必须在下方 updateTrayMenuState
    // 之前——托盘菜单经 mt() 取文案，先切语言再重渲染才能立即以新语言呈现（用户在设置页改语言即时生效，无需重启 app）。
    applyLanguageFromConfig();
    logManager.setLogLevel(effectiveLogLevel(RUNTIME_POLICY.logLevel, getPrivacyMode()));

    // 0b. 桌面通知总开关热同步（changedConfig 即最新整份配置；缺省视为开）。
    setDesktopNotificationsEnabled(
      (changedConfig as { desktopNotifications?: boolean } | undefined)?.desktopNotifications
    );

    const isRunning = proxyManager?.getStatus().running ?? false;
    updateTrayMenuState(isRunning);

    // 2. 代理运行中【或 lifecycle 在飞】都交给 switchMode——重启执行窗口（stop→spawn，pid 尚无）内 isRunning=false，
    //    旧闸门把变更静默丢弃：删选中节点触发 fallback 重启，其窗口内完成克隆+选中 → 核 selector 永停 fallback 节点
    //    而 UI 显新节点（bug#5 真机实证）。busy 时 switchMode 内部暂存、settle 后重放对账。
    if (proxyManager && (isRunning || proxyManager.isLifecycleBusy())) {
      try {
        const latestConfig = prepareAutomaticTakeover(await configManager.loadConfig());
        await proxyManager.switchMode(latestConfig);
        logManager.addLog('info', 'Applied configuration change', 'Main');

        // 应用后再次更新托盘（以防状态有变）
        updateTrayMenuState(proxyManager.getStatus().running);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logManager.addLog('error', `Failed to apply config change: ${errorMessage}`, 'Main');
        updateTrayMenuState(false, true);
      }
    }

    // 3. 同步自动换节点服务状态
    if (autoSwitchService) {
      const latestCfg = await configManager.loadConfig().catch(() => null);
      if (latestCfg?.autoSwitchNode) {
        autoSwitchService.enable();
      } else {
        autoSwitchService.disable();
      }
    }
  });
}
