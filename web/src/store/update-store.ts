import { create } from 'zustand';
import type { GlobalUpdateSnapshot } from '@shared/global-update';

export const useUpdateStore = create<{
  snapshot: GlobalUpdateSnapshot;
  dismissed: string;
  setSnapshot: (snapshot: GlobalUpdateSnapshot) => void;
  dismiss: (fingerprint: string) => void;
}>((set) => ({
  snapshot: { checking: false, lastCheckedAt: null, items: [] },
  dismissed: '',
  setSnapshot: (snapshot) => set({ snapshot }),
  dismiss: (dismissed) => set({ dismissed }),
}));
