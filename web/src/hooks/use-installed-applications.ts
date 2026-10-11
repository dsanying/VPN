import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '@/ipc';
import type { InstalledApplication } from '@shared/types';

let pending: Promise<void> | undefined;
const useCatalogue = create<{ applications: InstalledApplication[]; error?: Error; loading: boolean; loaded: boolean; refresh: () => Promise<void> }>((set) => ({
  applications: [], loading: false, loaded: false,
  refresh: () => {
    if (pending) return pending;
    set({ loading: true });
    pending = api.system.listApplications().then(applications => { set({ applications, error: undefined, loaded: true }); })
      .catch(error => { set({ error: error instanceof Error ? error : new Error(String(error)), loaded: true }); })
      .finally(() => { set({ loading: false }); pending = undefined; });
    return pending;
  },
}));
export function useInstalledApplications() {
  const catalogue = useCatalogue();
  const { loaded, refresh } = catalogue;
  useEffect(() => { if (!loaded) void refresh(); }, [loaded, refresh]);
  return catalogue;
}
