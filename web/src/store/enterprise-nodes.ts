import { create } from 'zustand';
import type { EnterpriseSession } from '@shared/enterprise-vpn';
export const useEnterpriseNodes = create<{sessions:EnterpriseSession[];setSessions:(sessions:EnterpriseSession[])=>void}>(set => ({sessions:[],setSessions:sessions=>set({sessions})}));
