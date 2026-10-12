import { clientHost } from '@/config/client-host';
import { useSpeedTestStore } from '@/store/useSpeedTestStore';
import i18n from '@/i18n';
import { notifyActionFailed, notifyActionSuccess, notifyWarning } from '@/utils/feedback';
import { useThemeStore } from '@/stores/useThemeStore';
import { patchConfig } from '@/store/config-mutations';
import { useEffect, useEffectEvent } from 'react';
import { useNavigate } from 'react-router';
import { unlockApi, api } from '@/ipc';
import { ipcClient } from '@/ipc/ipc-client';
import { useAppStore } from '@/store/app-store';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { UserConfig } from '@shared/types';

const state = () => useAppStore.getState();
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
  const navigateFromEvent = useEffectEvent((path: string) =>
    navigate(path)
  );
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
        const store = useSpeedTestStore.getState();
        useSpeedTestStore.setState({
          ...(event.active === true
            ? { testing: event.serverIds ?? [] }
            : event.active === false
              ? { testing: [] }
              : {}),
          progress: {
            tested: event.tested ?? store.progress.tested,
            ok: event.ok ?? store.progress.ok,
            total: event.total ?? store.progress.total,
          },
        });
      }),
      api.server.onSpeedTestResult(({ serverId, latency }) =>
        state().applyLatencyResults({ [serverId]: latency })
      ),
      api.server.onSpeedTestDetails(({ serverId, detail }) =>
        state().applyLatencyResults({}, [], { [serverId]: detail })
      ),
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
