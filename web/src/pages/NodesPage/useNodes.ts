import {saveSubscriptionSource, type SourcePreview} from './subscription-mutations';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/ipc';
import { useAppStore } from '@/store/app-store';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import {useSpeedTestStore} from '@/store/useSpeedTestStore';
import type { SubscriptionConfig } from '@shared/types';

export function useNodes() {
  const testing=useSpeedTestStore(s=>s.testing);const progress=useSpeedTestStore(s=>s.progress);const test=useSpeedTestStore(s=>s.run);
  const [updating, setUpdating] = useState<string[]>([]);
  const { t } = useTranslation();
  const reload = () => useAppStore.getState().loadConfig();
  const refreshSubscription = async (id: string) => {
    setUpdating(old => [...old, id]);
    try {
      const result = await api.subscription.updateServers(id);
      if (!result.success) throw new Error(result.error || t('vpn.subscriptionFailed'));
      await reload(); notifyActionSuccess('sync');
    } catch (error) { notifyActionFailed('sync', error); }
    finally { setUpdating(old => old.filter(value => value !== id)); }
  };
  const saveSubscription = async (values: Omit<SubscriptionConfig, 'id' | 'createdAt'>, original?: SubscriptionConfig, observed?: SourcePreview) => {
    try { await saveSubscriptionSource(api.subscription, values, original, observed); } catch (error) { await reload(); throw error; }
    await reload(); notifyActionSuccess('save'); return true;
  };
  const removeNode = async (id: string) => {
    try { await useAppStore.getState().deleteServer(id); notifyActionSuccess('delete'); return true; }
    catch (error) { notifyActionFailed('delete', error); return false; }
  };
  const removeSubscription = async (id: string) => {
    try { await api.subscription.delete(id); await reload(); notifyActionSuccess('delete'); }
    catch (error) { notifyActionFailed('delete', error); }
  };
  return { test, testing, progress, updating, refreshSubscription, saveSubscription, removeNode, removeSubscription, reload };
}
