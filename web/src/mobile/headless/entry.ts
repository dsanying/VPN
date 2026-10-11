import { installHeadlessEnvironment } from './environment';
import { createHeadlessNativeBridge, type NativeInvocation, type NativeReply, type NativeEvent } from './native-bridge';
import { createMobileServiceRuntime } from '../service-runtime';
import { IPC_CHANNELS as C } from '@shared/ipc-channels';

type Outgoing = NativeInvocation | { kind: 'timer'; id: number; delay: number; repeat: boolean } |
  { kind: 'cancelTimer'; id: number } | { kind: 'clientEvent'; channel: string; data: unknown } | { kind: 'bridgeReady' };
declare const android: { consumeNamedDataAsArrayBuffer(name: string): Promise<ArrayBuffer> };
const outbox: Outgoing[] = [];
let bridge: ReturnType<typeof createHeadlessNativeBridge> | undefined;
let environment: ReturnType<typeof installHeadlessEnvironment> | undefined;
let runtime: Awaited<ReturnType<typeof createMobileServiceRuntime>> | undefined;
let activated = false;
const views = new Set<string>();
let closing = false;
const detach: (() => void)[] = [];
const send = (message: Outgoing) => {
  if (closing) throw new Error('Business host is closing');
  if (outbox.length >= 256) throw new Error('Native outbox capacity exceeded');
  outbox.push(message);
  // This notification contains no configuration or user data. Native drains a bounded return value.
  if (outbox.length === 1) console.info('shadow-native-wake');
};
const receive = async (name: string) => {
  const buffer = await android.consumeNamedDataAsArrayBuffer(name);
  return JSON.parse(new TextDecoder().decode(buffer));
};
export async function boot(entropyName: string): Promise<string> {
  if (bridge || closing) throw new Error('Business host already initialized');
  const initial = new Uint8Array(await android.consumeNamedDataAsArrayBuffer(entropyName));
  bridge = createHeadlessNativeBridge(send);
  environment = installHeadlessEnvironment({
    entropy: initial,
    async refillEntropy() {
      const result = await bridge!.request('entropy') as { base64: string };
      return Uint8Array.from(atob(result.base64), character => character.charCodeAt(0));
    },
    scheduleTimer: (id, delay, repeat) => send({ kind: 'timer', id, delay, repeat }),
    cancelTimer: id => send({ kind: 'cancelTimer', id }),
  });
  initial.fill(0);
  send({ kind: 'bridgeReady' });
  try {
    runtime = await createMobileServiceRuntime(bridge.native, { foreground: false });
    for (const [name, channel] of Object.entries(C)) {
      if (name.startsWith('EVENT_')) detach.push(runtime.service.on(channel, data => send({ kind: 'clientEvent', channel, data })));
    }
    return JSON.stringify({ capabilities: runtime.capabilities });
  } catch (error) { await close(); throw error; }
}
export function drain(): string { return JSON.stringify(outbox.splice(0)); }
export async function deliver(name: string): Promise<string> {
  if (!bridge || closing) throw new Error('Business host unavailable');
  bridge.receive(await receive(name) as NativeReply | NativeEvent);
  return 'delivered';
}
export function fireTimer(id: number): string { environment?.fireTimer(id); return 'fired'; }
export async function invokeClient(name: string): Promise<string> {
  if (!runtime || closing) throw new Error('Business host unavailable');
  const message = await receive(name) as { channel: string; args?: unknown; viewOwner?: string };
  if (typeof message.channel !== 'string') throw new Error('Invalid client command');
  if (message.viewOwner !== 'native-test' && !views.has(message.viewOwner ?? '')) throw new Error('View lease has expired');
  if (message.channel === C.STATS_SUBSCRIBE || message.channel === C.STATS_UNSUBSCRIBE) {
    if (typeof message.viewOwner !== 'string') throw new Error('Missing view owner');
    message.args = { ...(message.args as object), viewOwner: message.viewOwner };
  }
  return JSON.stringify(await runtime.transport.invoke(message.channel, message.args));
}
export async function attachView(name: string): Promise<string> {
  const { owner } = await receive(name) as { owner: string };
  if (!runtime || closing || typeof owner !== 'string' || !owner) throw new Error('Invalid view owner');
  if (views.size >= 128 && !views.has(owner)) throw new Error('Too many active views');
  views.add(owner);
  return 'attached';
}
export async function releaseView(name: string): Promise<string> {
  const { owner } = await receive(name) as { owner: string };
  if (typeof owner !== 'string') throw new Error('Invalid view owner');
  views.delete(owner);
  await runtime?.releaseView(owner);
  return 'released';
}
export async function activate(): Promise<string> {
  if (!runtime || closing) throw new Error('Business host unavailable');
  if (!activated) {
    activated = true;
    const config = await runtime.config.read();
    if (config.autoConnect) return JSON.stringify(await runtime.transport.invoke(C.PROXY_START));
  }
  return 'active';
}
export async function maintain(): Promise<string> {
  if (!runtime || closing) throw new Error('Business host unavailable');
  return JSON.stringify(await runtime.runMaintenance());
}
export async function close(): Promise<string> {
  if (closing) return 'closed';
  detach.splice(0).forEach(off => off());
  // Let the runtime unsubscribe and cancel native operations before disconnecting its bridge.
  try { await runtime?.close(); }
  finally { views.clear(); closing = true; bridge?.close(); environment?.close(); outbox.length = 0; }
  return 'closed';
}
