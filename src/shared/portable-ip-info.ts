import type { ConfigDocumentStore } from './config-repository';
import type { IpInfo, IpInfoSnapshot } from './types';
import { parseIpTrace } from './ip-trace';

export interface PortableIpInfoHost {
  identity(): Promise<{ key: string; proxy: boolean }>;
  trace(
    route: 'direct' | 'proxy',
    target: string,
    signal: AbortSignal
  ): Promise<{ status: number; body: string }>;
}
const TARGETS = [
  'https://cloudflare.com/cdn-cgi/trace',
  'https://www.cloudflare.com/cdn-cgi/trace',
];
/** Durable, event-driven facts. Reads never initiate requests and stale generations never commit. */
export class PortableIpInfo {
  private value: IpInfoSnapshot = { direct: null, proxy: null, updatedAt: 0 };
  private identity = '';
  private initialized = false;
  private generation = 0;
  private active?: AbortController;
  private ensuring?: Promise<IpInfoSnapshot>;
  private writes: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(
    private store: ConfigDocumentStore,
    private host: PortableIpInfoHost,
    private emit: (value: IpInfoSnapshot) => void
  ) {}
  async read(): Promise<IpInfoSnapshot> {
    if (!this.initialized) {
      const raw = await this.store.read('ip-info');
      if (!this.initialized && !this.closed) {
        this.initialized = true;
        if (raw) {
          try {
            const saved = JSON.parse(raw) as { identity?: string; value?: IpInfoSnapshot };
            const valid = (entry: IpInfo | null | undefined) =>
              entry === null || (!!entry && parseIpTrace(`ip=${entry.ip}`) !== null);
            if (
              typeof saved.identity === 'string' &&
              saved.value &&
              Number.isFinite(saved.value.updatedAt) &&
              valid(saved.value.direct) &&
              valid(saved.value.proxy)
            ) {
              this.identity = saved.identity;
              this.value = {
                direct: saved.value.direct,
                proxy: saved.value.proxy,
                updatedAt: saved.value.updatedAt,
                ...(saved.value.error ? { error: '出口检测失败' } : {}),
              };
            }
          } catch {
            /* A damaged cache is not a network result. */
          }
        }
      }
    }
    return structuredClone(this.value);
  }
  async ensureCurrent(): Promise<IpInfoSnapshot> {
    if (this.ensuring) return this.ensuring;
    const work = (async () => {
      await this.read();
      const context = await this.host.identity();
      if (
        !this.closed &&
        (context.key !== this.identity || !this.value.direct || this.value.loading)
      )
        await this.refresh();
      return this.read();
    })();
    const flight = work.finally(() => {
      if (this.ensuring === flight) this.ensuring = undefined;
    });
    this.ensuring = flight;
    return flight;
  }
  private publish(value: IpInfoSnapshot) {
    this.value = value;
    this.emit(structuredClone(value));
  }
  async refresh(): Promise<void> {
    if (this.closed) return;
    const generation = ++this.generation;
    this.active?.abort();
    const active = new AbortController();
    this.active = active;
    const timeout = setTimeout(() => active.abort(), 20000);
    const current = () => !this.closed && generation === this.generation;
    try {
      await this.read();
      const context = await this.host.identity();
      if (!current() || active.signal.aborted) return;
      const previous =
        context.key === this.identity ? this.value : { direct: null, proxy: null, updatedAt: 0 };
      this.identity = context.key;
      this.publish({ ...previous, proxy: context.proxy ? previous.proxy : null, loading: true });
      const detect = async (route: 'direct' | 'proxy'): Promise<IpInfo | null> => {
        for (const target of TARGETS) {
          active.signal.throwIfAborted();
          try {
            const response = await this.host.trace(route, target, active.signal);
            active.signal.throwIfAborted();
            if (response.status >= 200 && response.status < 300) {
              const result = parseIpTrace(response.body);
              if (result) return result;
            }
          } catch {
            if (active.signal.aborted) throw new DOMException('已取消', 'AbortError');
          }
        }
        return null;
      };
      const result = await Promise.allSettled([
        detect('direct'),
        context.proxy ? detect('proxy') : Promise.resolve(null),
      ]);
      if (!current()) return;
      const direct = result[0].status === 'fulfilled' ? result[0].value : null;
      const proxy = result[1].status === 'fulfilled' ? result[1].value : null;
      const error = !direct || (context.proxy && !proxy);
      const value: IpInfoSnapshot = {
        direct: direct ?? previous.direct,
        proxy: context.proxy ? (proxy ?? previous.proxy) : null,
        updatedAt: Date.now(),
        ...(error ? { error: '出口检测失败' } : {}),
      };
      const saved = JSON.stringify({ identity: context.key, value });
      this.writes = this.writes
        .catch(() => undefined)
        .then(async () => {
          if (current()) await this.store.write('ip-info', saved);
        });
      await this.writes;
      if (current()) this.publish(value);
    } catch (error) {
      if (current()) {
        this.publish({ ...this.value, loading: false, error: '出口检测失败' });
        if (!active.signal.aborted) throw error;
      }
    } finally {
      clearTimeout(timeout);
      if (this.active === active) this.active = undefined;
    }
  }
  close() {
    this.closed = true;
    ++this.generation;
    this.active?.abort();
  }
}
