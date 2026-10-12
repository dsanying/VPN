import { observationIsFresh } from './background-refresh';
import type { ConfigDocumentStore } from './config-repository';
import { createHostTextRequester, type HostTextTransport } from './host-text-request';
import { SERVICE_IDS, type UnlockSnapshot, type UnlockResult } from './unlock-detection';
import { WEBSITE_CATALOG } from './website-catalog';
import { classifyWebsite } from './website-probe';

export interface WebsiteNetworkContext {
  identity: string;
  route: 'direct' | 'routed';
}
const empty = (): UnlockSnapshot => ({ results: {}, checkedAt: null, egress: null });
/** Durable measurements of the current system route; reading a page never starts requests. */
export class PortableWebsiteMeasurements {
  private request;
  private flight?: Promise<UnlockSnapshot>;
  private abort?: AbortController;
  private closed = false;
  private revision = 0;
  constructor(
    private store: ConfigDocumentStore,
    host: HostTextTransport,
    private context: () => Promise<WebsiteNetworkContext>,
    private publish: (snapshot: UnlockSnapshot) => void
  ) {
    this.request = createHostTextRequester(host);
  }
  async read(): Promise<UnlockSnapshot> {
    const text = await this.store.read('website-measurements');
    if (!text) return empty();
    try {
      const saved = JSON.parse(text);
      const context = await this.context();
      if (saved.schema !== 1 || saved.identity !== context.identity) return empty();
      const snapshot = saved.snapshot;
      if (
        !snapshot ||
        !Number.isFinite(snapshot.checkedAt) ||
        snapshot.checkedAt <= 0 ||
        snapshot.route !== context.route ||
        !snapshot.results ||
        SERVICE_IDS.some((id) => !this.validResult(snapshot.results[id]))
      )
        return empty();
      return {
        route: context.route,
        checkedAt: snapshot.checkedAt,
        egress: null,
        results: Object.fromEntries(
          SERVICE_IDS.map((id) => [
            id,
            {
              status: snapshot.results[id].status,
              ...(snapshot.results[id].httpStatus === undefined
                ? {}
                : { httpStatus: snapshot.results[id].httpStatus }),
            },
          ])
        ),
      };
    } catch {
      return empty();
    }
  }
  private validResult(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const result = value as UnlockResult;
    return (
      ['ok', 'blocked', 'timeout', 'error'].includes(result.status) &&
      (result.httpStatus === undefined ||
        (Number.isInteger(result.httpStatus) &&
          result.httpStatus >= 200 &&
          result.httpStatus <= 599))
    );
  }
  async ensureCurrent(): Promise<UnlockSnapshot> {
    const snapshot = await this.read();
    return observationIsFresh(snapshot.checkedAt) ? snapshot : this.run();
  }
  run(): Promise<UnlockSnapshot> {
    if (this.closed) return Promise.reject(new Error('网站检测服务已关闭'));
    if (this.flight) return this.flight;
    const abort = new AbortController();
    this.abort = abort;
    const revision = this.revision;
    const operation = (async () => {
      const context = await this.context();
      const results: Record<string, UnlockResult> = {};
      let cursor = 0;
      const worker = async () => {
        while (cursor < SERVICE_IDS.length) {
          if (abort.signal.aborted) throw new DOMException('检测已取消', 'AbortError');
          const id = SERVICE_IDS[cursor++];
          try {
            const response = await this.request(
              WEBSITE_CATALOG[id].url,
              'current',
              abort.signal,
              'ShadowVPN',
              true
            );
            results[id] = classifyWebsite(id, {
              status: response.status,
              body: '',
              redirectChain: [],
            });
          } catch (error) {
            if (abort.signal.aborted) throw error;
            const code =
              error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            results[id] = { status: code === 'HTTP_TIMEOUT' ? 'timeout' : 'error' };
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      if (
        abort.signal.aborted ||
        revision !== this.revision ||
        (await this.context()).identity !== context.identity
      )
        throw new DOMException('网络路径已变更', 'AbortError');
      const snapshot: UnlockSnapshot = {
        route: context.route,
        results,
        checkedAt: Date.now(),
        egress: null,
      };
      await this.store.write(
        'website-measurements',
        JSON.stringify({ schema: 1, identity: context.identity, snapshot })
      );
      // A state change during the write leaves an obsolete record that read() rejects by identity.
      if (abort.signal.aborted || revision !== this.revision)
        throw new DOMException('网络路径已变更', 'AbortError');
      try {
        this.publish(structuredClone(snapshot));
      } catch {
        /* Views cannot fail a committed measurement. */
      }
      return snapshot;
    })();
    const flight = operation.finally(() => {
      if (this.flight === flight) {
        this.flight = undefined;
        this.abort = undefined;
      }
    });
    this.flight = flight;
    return flight;
  }
  invalidate(): void {
    this.revision++;
    this.abort?.abort();
  }
  close(): void {
    this.closed = true;
    this.invalidate();
  }
}
