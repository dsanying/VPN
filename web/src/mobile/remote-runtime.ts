import { IPC_CHANNELS as C } from '@shared/ipc-channels';
import type { ClientTransport } from '@/ipc/ipc-client';
import type { NativeListenerHandle, ShadowVpnNative } from './native-contract';
export interface MobileBusinessHost {
  clientBootstrap(): Promise<{ capabilities: Awaited<ReturnType<ShadowVpnNative['capabilities']>> }>;
  clientInvoke(options: { channel: string; args?: unknown }): Promise<unknown>;
  clientDisconnect(): Promise<void>;
  addListener(event: 'clientEvent', listener: (event: { channel: string; data: unknown }) => void): Promise<NativeListenerHandle>;
}
type Listener = (event: unknown, ...args: unknown[]) => void;

/** The renderer subscribes to one native business owner; it never creates service/cache instances. */
export async function connectMobileRuntime(host: MobileBusinessHost) {
  let closed = false;
  const listeners = new Map<string, Set<Listener>>();
  const subscriptions = new Map<string, number>();
  const pendingTopics = new Set<Promise<unknown>>();
  let unavailable = false;
  let generation = 0;
  let recovery: Promise<void> | undefined;
  const recover = () => {
    if (closed) return Promise.reject(new Error('Mobile view is closed'));
    if (recovery) return recovery;
    const expectedGeneration = generation;
    recovery = (async () => {
      await Promise.allSettled([...pendingTopics]);
      await host.clientBootstrap();
      if (closed) { await host.clientDisconnect(); return; }
      for (const [topic, count] of subscriptions) {
        for (let index = 0; index < count; index++) {
          const result = await host.clientInvoke({ channel: C.STATS_SUBSCRIBE, args: { topic } }) as { success?: boolean };
          if (result?.success === false) throw new Error('Mobile subscriptions could not be restored');
        }
      }
      if (generation !== expectedGeneration) throw new Error('Mobile host changed during recovery');
      unavailable = false;
    })().finally(() => { recovery = undefined; });
    return recovery;
  };
  const handle = await host.addListener('clientEvent', ({channel,data}) => {
    if (closed) return;
    if (channel === 'client:hostClosed') {
      generation++;
      unavailable = true;
      void recover().catch(() => {
        if (!closed) for (const listener of [...(listeners.get(C.EVENT_PROXY_ERROR) ?? [])]) {
          try { listener(undefined, { error: '后台业务引擎恢复失败，请重试。' }); } catch { /* Isolated view listener. */ }
        }
      });
      return;
    }
    for (const listener of [...(listeners.get(channel) ?? [])]) {
      try { listener(undefined, data); } catch { /* A detached view cannot interrupt committed state. */ }
    }
  });
  const transport: ClientTransport = {
    async invoke<T>(channel: string, args?: unknown) {
      if (closed) throw new Error('Mobile view is closed');
      if (unavailable || recovery) await recover();
      if (closed) throw new Error('Mobile view is closed');
      // Topic counts express the view's desired collection, even if its old host dies before replying.
      const topicChange = channel === C.STATS_SUBSCRIBE || channel === C.STATS_UNSUBSCRIBE;
      const topic = (args as { topic?: unknown })?.topic;
      if (topicChange && (topic === 'stats' || topic === 'aggregate' || topic === 'detail')) {
        const count = Math.max(0, (subscriptions.get(topic) ?? 0) + (channel === C.STATS_SUBSCRIBE ? 1 : -1));
        if (count) subscriptions.set(topic, count); else subscriptions.delete(topic);
      }
      // Register before native execution; failed writes are never replayed by recovery.
      const operation = Promise.resolve().then(() => host.clientInvoke({channel,args}) as Promise<T>);
      if (topicChange) pendingTopics.add(operation);
      try { return await operation; }
      finally { pendingTopics.delete(operation); }
    },
    on(channel, listener) {
      if (closed) throw new Error('Mobile view is closed');
      const callbacks=listeners.get(channel) ?? new Set();listeners.set(channel,callbacks);callbacks.add(listener);
      return () => { callbacks.delete(listener); if(!callbacks.size)listeners.delete(channel); };
    },
    once(channel, listener) {
      const off=transport.on(channel,(...args)=>{off();listener(...args);});
    },
    off(channel,listener) {listeners.get(channel)?.delete(listener);},
    removeAllListeners(channel) {listeners.delete(channel);},
  };
  try {
    const {capabilities}=await host.clientBootstrap();
    return {transport,capabilities,async close(){if(closed)return;closed=true;listeners.clear();subscriptions.clear();try{await host.clientDisconnect();}finally{await handle.remove();}}};
  } catch(error) {closed=true;listeners.clear();subscriptions.clear();try{await host.clientDisconnect();}catch{/* Preserve the original bootstrap failure. */}await handle.remove();throw error;}
}
