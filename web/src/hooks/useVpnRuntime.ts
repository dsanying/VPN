import { clientHost } from '@/config/client-host';
import { useSpeedTestStore } from '@/store/useSpeedTestStore';
import i18n from '@/i18n';
import { notifyActionFailed, notifyActionSuccess, notifyWarning } from '@/utils/feedback';
import { useThemeStore } from '@/store/useThemeStore';
import { patchConfig } from '@/store/config-mutations';
import { useEffect, useEffectEvent } from 'react';
import { useNavigate } from 'react-router';
import { unlockApi, api } from '@/ipc';
import { ipcClient } from '@/ipc/ipc-client';
import { useAppStore } from '@/store/app-store';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { NodeProbeDetails } from '@shared/speed-test';
import type { UserConfig } from '@shared/types';

const state = () => useAppStore.getState();

// 测速流合批：主进程按节点逐条推 EVENT_SPEED_TEST_RESULT / DETAILS / progress
// （51 节点全量测速 ≈ 153 次事件），每次直达 store 都会让全部 app-store 订阅者
// （节点页 50+ 组件）跑一轮选择器。80ms 窗口合并为一次写入，视觉无感——延迟
// 标签本就以秒级节奏逐个亮起，合批只把「逐条闪烁」变成「小批亮起」。
// active true/false 的起止事件不经窗口立即生效（开始/结束必须即时反馈）。
interface LatencyBatch {
  results: Record<string, number>;
  details: Record<string, NodeProbeDetails>;
  proxyIds: string[];
  entryIds: string[];
  progress?: { tested: number; ok: number; total: number };
}
const latencyBatch: LatencyBatch = { results: {}, details: {}, proxyIds: [], entryIds: [] };
let latencyBatchTimer: ReturnType<typeof setTimeout> | undefined;
function flushLatencyBatch(): void {
  latencyBatchTimer = undefined;
  const { results, details, proxyIds, entryIds, progress } = latencyBatch;
  latencyBatch.results = {};
  latencyBatch.details = {};
  latencyBatch.proxyIds = [];
  latencyBatch.entryIds = [];
  delete latencyBatch.progress;
  if (Object.keys(results).length || Object.keys(details).length)
    state().applyLatencyResults(results, [], details);
  if (proxyIds.length || entryIds.length) {
    const pending = useSpeedTestStore.getState();
    useSpeedTestStore.setState({
      proxyPending: pending.proxyPending.filter((id) => !proxyIds.includes(id)),
      entryPending: pending.entryPending.filter((id) => !entryIds.includes(id)),
    });
  }
  if (progress) useSpeedTestStore.setState({ progress });
}
const handleProxyError: Parameters<typeof api.proxy.onError>[0] = ({ message, error }) => {
  const reason = message ?? error ?? i18n.t('common.requestFailed');
  const current = state();
  useAppStore.setState({ proxyError: reason });
  if (current.proxyPhase === 'idle') notifyActionFailed('connect', reason);
};
const handleInvalidNodes: Parameters<typeof api.proxy.onInvalidNodes>[0] = (nodes) => {
  useAppStore.setState({ invalidNodes: Object.fromEntries(nodes.map((n) => [n.id, n])) });
  if (nodes.length) notifyWarning(i18n.t('vpn.invalidNodes', { count: nodes.length }));
};
const handleTailscaleStatus: Parameters<typeof api.proxy.onTailscaleStatus>[0] = (data) => {
  const before = state();
  const loginCompleted =
    data.loggedIn &&
    before.tailscaleLoginInitiated[data.serverId] &&
    !before.tailscaleLoginStates[data.serverId];
  if (loginCompleted) {
    state().setTailscaleLoginInitiated(data.serverId, false);
    notifyActionSuccess('login');
  }
  if (
    data.loggedIn ||
    data.expired ||
    ['NeedsLogin', 'NeedsMachineAuth'].includes(data.backendState)
  )
    state().setTailscaleLoginState(data.serverId, data.loggedIn);
  state().setTailscaleIps(data.serverId, data.tailscaleIPs ?? []);
  state().setTailscalePeers(data.serverId, data.peers ?? []);
  if (data.authURL) state().setTailscaleAuthUrl(data.serverId, data.authURL);
};

function subscribeOperationalFeedback() {
  const refresh = () => {
    void state().refreshConnectionStatus();
    void state().refreshPendingChanges();
  };
  const unsubscribers = [
    api.proxy.onMeshLoginFallback(({ engaged }) => {
      if (engaged) notifyWarning(i18n.t('vpn.meshFallback'));
    }),
    api.proxy.onSystemProxyResidual(() => notifyWarning(i18n.t('vpn.proxyResidual'))),
    api.proxy.onCoreBaselineWarning(({ current, bundled }) =>
      notifyWarning(i18n.t('vpn.coreBaseline', { current, bundled }))
    ),
    api.proxy.onAutoNodeSwitched(({ newServerName }) => {
      notifyWarning(i18n.t('vpn.autoSwitched', { name: newServerName }));
      refresh();
    }),
  ];
  // 动作完成后反馈；后台事件刷新不重复弹通知，切页也不会丢结果。
  const offProxyFeedback = useAppStore.subscribe((next, previous) => {
    if (previous.proxyPhase === 'idle' || next.proxyPhase !== 'idle') return;
    const action = previous.proxyPhase === 'starting' ? 'connect' : 'disconnect';
    if (next.proxyError) {
      notifyActionFailed(action, next.proxyError);
      return;
    }
    const status = next.connectionStatus;
    const running = !!status?.proxyCore.running;
    const confirmed =
      action === 'connect'
        ? running && (status?.proxyModeType !== 'systemProxy' || status.proxy.enabled)
        : !running;
    if (confirmed) notifyActionSuccess(action);
    else notifyActionFailed(action, i18n.t('common.requestFailed'));
  });
  const offTheme = useThemeStore.subscribe((next, previous) => {
    if (
      next.preference !== previous.preference &&
      state().config &&
      state().config?.uiTheme !== next.preference
    )
      void patchConfig((config) => ({ ...config, uiTheme: next.preference }))
        .then(() => notifyActionSuccess('save'))
        .catch((error) => {
          useAppStore.setState({
            configError: error instanceof Error ? error : new Error(String(error)),
          });
          notifyActionFailed('save', error);
        });
  });
  const languageChanged = (language: string) => {
    if (state().config && state().config?.language !== language)
      void patchConfig((config) => ({ ...config, language }))
        .then(() => notifyActionSuccess('save'))
        .catch((error) => {
          useAppStore.setState({
            configError: error instanceof Error ? error : new Error(String(error)),
          });
          notifyActionFailed('save', error);
        });
  };
  i18n.on('languageChanged', languageChanged);
  return () => {
    offProxyFeedback();
    offTheme();
    i18n.off('languageChanged', languageChanged);
    unsubscribers.forEach((off) => off());
  };
}

/** 唯一常驻事件入口：页面切换不丢配置、测速或组网状态，卸载逐一退订。 */
export function useVpnRuntime() {
  const navigate = useNavigate();
  const navigateFromEvent = useEffectEvent((path: string) => navigate(path));
  useEffect(() => {
    const state = () => useAppStore.getState();
    const refresh = () => {
      void state().refreshConnectionStatus();
      void state().refreshPendingChanges();
    };
    const unsubscribers = [
      subscribeOperationalFeedback(),
      unlockApi.onProgress(({ serviceId, result }) => state().setUnlockProgress(serviceId, result)),
      unlockApi.onUpdated((snapshot) => state().applyUnlockSnapshot(snapshot)),
      unlockApi.onInvalidated(() => state().beginUnlockCheck()),
      api.config.onChanged(({ newValue }) => {
        if (newValue && Array.isArray((newValue as UserConfig).servers))
          state().applyConfigFromEvent(newValue);
        else void state().loadConfig();
        refresh();
      }),
      api.proxy.onStarted(refresh),
      api.proxy.onStopped(refresh),
      api.proxy.onError((error) => {
        handleProxyError(error);
        refresh();
      }),
      api.proxy.onInvalidNodes(handleInvalidNodes),
      api.server.onSpeedTestProgress((event) => {
        // 起止事件（active true/false）立即生效；进行中的计数进 80ms 合批窗口，
        // 只保留最新值（进度条读数只关心终点）。
        if (event.active !== undefined) {
          if (latencyBatchTimer) {
            clearTimeout(latencyBatchTimer);
            flushLatencyBatch();
          }
          const store = useSpeedTestStore.getState();
          useSpeedTestStore.setState({
            ...(event.active === true
              ? {
                  testing: event.serverIds ?? [],
                  ...(event.tested === 0
                    ? { proxyPending: event.serverIds ?? [], entryPending: event.serverIds ?? [] }
                    : {}),
                }
              : event.active === false
                ? { testing: [], proxyPending: [], entryPending: [] }
                : {}),
            progress: {
              tested: event.tested ?? store.progress.tested,
              ok: event.ok ?? store.progress.ok,
              total: event.total ?? store.progress.total,
            },
          });
          return;
        }
        latencyBatch.progress = {
          tested: event.tested ?? latencyBatch.progress?.tested ?? 0,
          ok: event.ok ?? latencyBatch.progress?.ok ?? 0,
          total: event.total ?? latencyBatch.progress?.total ?? 0,
        };
        latencyBatchTimer ??= setTimeout(flushLatencyBatch, 80);
      }),
      api.server.onSpeedTestResult(({ serverId, latency }) => {
        latencyBatch.results[serverId] = latency;
        latencyBatch.proxyIds.push(serverId);
        latencyBatchTimer ??= setTimeout(flushLatencyBatch, 80);
      }),
      api.server.onSpeedTestDetails(({ serverId, detail }) => {
        latencyBatch.details[serverId] = detail;
        latencyBatch.entryIds.push(serverId);
        latencyBatchTimer ??= setTimeout(flushLatencyBatch, 80);
      }),
      api.ipInfo.onUpdated((ipInfo) => useAppStore.setState({ ipInfo })),
      api.proxy.onTailscaleAuth(({ serverId, url }) => {
        if (serverId) state().setTailscaleAuthUrl(serverId, url);
      }),
      api.proxy.onTailscaleStatus(handleTailscaleStatus),
      api.proxy.onTailscaleStateCleared(({ serverId }) =>
        state().setTailscaleLoginState(serverId, false)
      ),
      ipcClient.on<string>(IPC_CHANNELS.EVENT_NAVIGATE, (path) => navigateFromEvent(path)),
    ];
    void state().loadConfig();
    void unlockApi
      .get()
      .then((snapshot) => {
        if (snapshot) state().applyUnlockSnapshot(snapshot);
      })
      .catch(() => {});
    refresh();
    if (clientHost().desktopHelper) void state().refreshHelperStatus();
    void api.ipInfo
      .peek()
      .then((ipInfo) => useAppStore.setState({ ipInfo }))
      .catch(() => {});
    void window.electron?.ipcRenderer.invoke(IPC_CHANNELS.RENDERER_READY).catch(() => {});
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);
}
