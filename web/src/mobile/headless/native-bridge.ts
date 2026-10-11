import type { ShadowVpnNative, NativeCoreEvent, NativeVpnStatus } from '../native-contract';

export type NativeInvocation = { kind: 'call'; id: number; method: string; data?: unknown };
export type NativeReply = { kind: 'reply'; id: number; value?: unknown; error?: { code: string; message: string } };
export type NativeEvent = { kind: 'event'; event: 'statusChanged' | 'networkChanged' | 'coreEvent'; data: unknown };
export const nativeMethods = [
  'capabilities','exportDocument','importDocument','openVpnSettings','openExternal',
  'prepareCountryRuleSet','networkContext','status','listApplications','measureNode','cancelProbe',
  'clientInfo','closeConnections','prepareSoftwareUpdate','installSoftwareUpdate','preparedSoftwareUpdate',
  'clearLogs','coreVersion','coreEnvironment','checkConfig','start','appliedReceipt','stop',
  'readState','writeState','deleteState','subscribeCoreEvents','requestText','cancelRequest',
] as const satisfies readonly (keyof ShadowVpnNative)[];

/** Events carry data, never executable source. Native owns primitives; one isolate owns business state. */
export function createHeadlessNativeBridge(send: (request: NativeInvocation) => void) {
  let sequence = 0;
  let closed = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const request = (method: string, data?: unknown): Promise<unknown> => {
    if (closed) return Promise.reject(new Error('Native bridge is closed'));
    if (pending.size >= 128) return Promise.reject(new Error('Native request capacity exceeded'));
    const id = ++sequence;
    if (!Number.isSafeInteger(id)) return Promise.reject(new Error('Native request identity exhausted'));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { send({ kind: 'call', id, method, data }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  const methods = Object.fromEntries(nativeMethods.map(method => [method, (data?: unknown) => request(method, data)]));
  const native = {
    ...methods,
    async addListener(event: string, listener: (data: unknown) => void) {
      if (!['statusChanged','networkChanged','coreEvent'].includes(event)) throw new Error('Unknown native event');
      if (closed) throw new Error('Native bridge is closed');
      const callbacks = listeners.get(event) ?? new Set(); listeners.set(event, callbacks);
      callbacks.add(listener);
      return { async remove() { callbacks.delete(listener); if (!callbacks.size) listeners.delete(event); } };
    },
  } as ShadowVpnNative;
  return {
    native,
    request,
    receive(message: NativeReply | NativeEvent) {
      if (closed) return;
      if (message.kind === 'reply') {
        const call = pending.get(message.id);
        if (!call) throw new Error('Unknown native reply identity');
        pending.delete(message.id);
        if (message.error) {
          const error = new Error(message.error.message);
          Object.assign(error, { code: message.error.code }); call.reject(error);
        } else call.resolve(message.value);
      } else if (message.kind === 'event' && listeners.has(message.event)) {
        for (const callback of listeners.get(message.event)!) {
          try { callback(message.data as NativeVpnStatus | NativeCoreEvent); }
          catch { /* A listener cannot prevent other subscribers receiving committed state. */ }
        }
      }
    },
    close() {
      if (closed) return;
      closed = true;
      for (const call of pending.values()) call.reject(new Error('Native bridge is closed'));
      pending.clear(); listeners.clear();
    },
  };
}
