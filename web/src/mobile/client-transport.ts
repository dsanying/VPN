import type { PortableClientService } from '@shared/portable-client-service';
import type { ClientTransport } from '@/ipc/ipc-client';

type Listener = (event: unknown, ...args: unknown[]) => void;
/** Mobile event envelope preserves the existing renderer contract without impersonating Electron. */
export class MobileClientTransport implements ClientTransport {
  private listeners = new Map<string, Map<Listener, Set<() => void>>>();
  private closed = false;
  constructor(private service: PortableClientService) {}
  async invoke<T>(channel: string, args?: unknown): Promise<T> {
    if (this.closed) throw new Error('Mobile transport is closed');
    return (await this.service.invoke(channel, args)) as T;
  }
  on(channel: string, listener: Listener): () => void {
    if (this.closed) throw new Error('Mobile transport is closed');
    const callbacks = this.listeners.get(channel) ?? new Map<Listener, Set<() => void>>();
    this.listeners.set(channel, callbacks);
    const removers = callbacks.get(listener) ?? new Set<() => void>();
    callbacks.set(listener, removers);
    const detach = this.service.on(channel, (data) => listener(undefined, data));
    const remove = () => {
      detach();
      removers.delete(remove);
      if (!removers.size) callbacks.delete(listener);
      if (!callbacks.size) this.listeners.delete(channel);
    };
    removers.add(remove);
    return remove;
  }
  once(channel: string, listener: Listener): void {
    const remove = this.on(channel, (...args) => {
      remove();
      listener(...args);
    });
  }
  off(channel: string, listener: Listener): void {
    for (const remove of [...(this.listeners.get(channel)?.get(listener) ?? [])]) remove();
  }
  removeAllListeners(channel: string): void {
    for (const removers of [...(this.listeners.get(channel)?.values() ?? [])])
      for (const remove of [...removers]) remove();
  }
  close(): void {
    for (const channel of [...this.listeners.keys()]) this.removeAllListeners(channel);
    this.closed = true;
  }
}
