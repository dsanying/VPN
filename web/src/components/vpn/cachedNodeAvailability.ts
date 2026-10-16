import {indexedServer} from './nodeDisplayCache';
import {nodeAvailability} from '@shared/node-availability';
import type {useAppStore} from '@/store/app-store';
type Context = Pick<ReturnType<typeof useAppStore.getState>,'config'|'latencyMap'|'latencyTestedAt'|'pendingChanges'|'tailscaleLoginStates'> & Partial<Pick<ReturnType<typeof useAppStore.getState>,'probeDetails'|'connectionStatus'|'ipInfo'>> & {proxyBlocked?:boolean;running?:boolean};
export function cachedNodeAvailability(state:Context,id:string,time:number) {
 const node=indexedServer(state.config?.servers,id);
 const invalid=state.pendingChanges.modified.includes(id)||state.pendingChanges.added.includes(id)||!node||
  (node.protocol==='tailscale'&&(!node.tailscaleSettings?.authKey?.trim()&&state.tailscaleLoginStates[id]!==true||state.config?.selectedServerId===id&&(state.running??!!state.connectionStatus?.proxyCore.running)&&!!(state.proxyBlocked??state.ipInfo?.proxyBlocked)));
 return nodeAvailability(state.latencyMap[id],state.latencyTestedAt[id],time,invalid,state.probeDetails?.[id]?.proxyReason,state.probeDetails?.[id]?.availability);
}
