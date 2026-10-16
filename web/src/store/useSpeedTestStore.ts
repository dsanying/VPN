import i18n from '@/i18n';
import { notifyActionSuccess, notifyActionFailed, notifyWarning } from '@/utils/feedback';
import { create } from 'zustand';
import { api } from '@/ipc';
import { useAppStore } from './app-store';
import { isSpeedTestable } from '@shared/endpoint-routes';
import type { ServerConfig } from '@shared/types';
interface SpeedState {
  testing: string[];
  proxyPending: string[];
  entryPending: string[];
  progress: { tested: number; total: number; ok: number };
  received: (id: string, field: 'proxy' | 'entry') => void;
  run: (nodes: ServerConfig[], all?: boolean) => Promise<void>;
}
/** 测速属于应用会话；切换页面不丢进度，也不能发起第二个重叠任务。 */
export const useSpeedTestStore = create<SpeedState>((set, get) => ({
  testing: [],
  proxyPending: [],
  entryPending: [],
  progress: { tested: 0, total: 0, ok: 0 },
  received: (id, field) =>
    set((s) =>
      field === 'proxy'
        ? { proxyPending: s.proxyPending.filter((value) => value !== id) }
        : { entryPending: s.entryPending.filter((value) => value !== id) }
    ),
  run: async (nodes, all = false) => {
    if (get().testing.length) return;
    const app = useAppStore.getState();
    if (all) useAppStore.setState({ speedTestAttempted: true });
    const ids = nodes
      .filter(
        (node) =>
          node.protocol === 'enterprise' ||
          isSpeedTestable(node, { mainCorePool: !!app.connectionStatus?.proxyCore.running })
      )
      .map((node) => node.id);
    if (!ids.length) {
      notifyWarning(i18n.t('vpn.noTestableNodes'));
      return;
    }
    set({
      testing: ids,
      proxyPending: ids,
      entryPending: ids,
      progress: { tested: 0, total: ids.length, ok: 0 },
    });
    const unsubscribe = api.server.onSpeedTestProgress((progress) => {
      if (
        progress.tested !== undefined &&
        progress.total !== undefined &&
        progress.ok !== undefined
      )
        set({ progress: { tested: progress.tested, total: progress.total, ok: progress.ok } });
    });
    try {
      const result = await api.server.speedTest(ids);
      if (result.details)
        useAppStore
          .getState()
          .applyLatencyResults(result.results, result.notInPool, result.details);
      else useAppStore.getState().applyLatencyResults(result.results, result.notInPool);
      const ok = ids.filter(
        (id) =>
          typeof result.results[id] === 'number' &&
          (result.results[id] >= 0 || result.details?.[id]?.availability === 'available')
      ).length;
      const tested = ids.filter((id) => Object.hasOwn(result.results, id)).length;
      const interrupted = result.outcome === 'interrupted';
      set({
        progress: { tested, total: ids.length, ok },
      });
      const description = i18n.t('vpn.testing', { tested, total: ids.length, ok });
      if (interrupted || ok < ids.length)
        notifyWarning(i18n.t(interrupted ? 'vpn.interrupted' : 'vpn.testComplete'), description);
      else notifyActionSuccess('testLatency', description);
    } catch (error) {
      notifyActionFailed('testLatency', error);
    } finally {
      unsubscribe();
      set({ testing: [], proxyPending: [], entryPending: [] });
    }
  },
}));
