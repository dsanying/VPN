import { create } from 'zustand';
import type { GlobalUpdateSnapshot } from '@shared/global-update';

export const useUpdateStore = create<{
  snapshot: GlobalUpdateSnapshot;
  setSnapshot: (snapshot: GlobalUpdateSnapshot) => void;
}>((set) => ({
  snapshot: { checking: false, lastCheckedAt: null, items: [] },
  setSnapshot: (snapshot) => set({ snapshot }),
}));
