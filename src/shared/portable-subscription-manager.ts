import type { ConfigRepository } from './config-repository';
import { PortableSubscriptionParser } from './subscription-content-parser';
import { commitSubscriptionResult, type SubscriptionCommitResult } from './subscription-commit';
import {
  createHostTextRequester,
  isRetryableHostTextError,
  type HostTextTransport,
} from './host-text-request';
import { requestSubscription } from './subscription-request';
import { classifySubscriptionError, type SubscriptionPreviewResult } from './subscription-preview';
import { parseSubscriptionUserInfo } from './subscription-usage';

/** Durable business orchestration. Native hosts supply network facts and post-commit work. */
export class PortableSubscriptionManager {
  private flights = new Map<
    string,
    { url: string; abort: AbortController; promise: Promise<SubscriptionCommitResult> }
  >();
  private request;
  constructor(
    private readonly config: ConfigRepository,
    host: HostTextTransport,
    private readonly proxyAvailable: () => Promise<boolean>,
    private readonly afterCommit: (groupId: string, restartRequired: boolean) => Promise<void>
  ) {
    this.request = createHostTextRequester(host);
  }
  private async fetch(url: string, signal: AbortSignal) {
    const available = await this.proxyAvailable();
    const response = await requestSubscription(
      'auto',
      () => available,
      async (proxy) => {
        const result = await this.request(url, proxy ? 'current' : 'direct', signal);
        if (result.status < 200 || result.status >= 300) {
          const error = new Error(`Subscription HTTP ${result.status}`);
          Object.assign(error, {
            httpStatus: result.status,
            code:
              result.status === 429 || result.status >= 500
                ? 'HTTP_REQUEST_FAILED'
                : 'HTTP_INVALID_RESPONSE',
          });
          throw error;
        }
        return result;
      },
      isRetryableHostTextError
    );
    return response;
  }
  private previews = new Map<
    string,
    { abort: AbortController; promise: Promise<SubscriptionPreviewResult> }
  >();
  async preview(url: string): Promise<SubscriptionPreviewResult> {
    const existing = this.previews.get(url);
    if (existing) return existing.promise;
    const abort = new AbortController();
    const promise = (async (): Promise<SubscriptionPreviewResult> => {
      try {
        const response = await this.fetch(url, abort.signal);
        const parser = new PortableSubscriptionParser(
          async (provider, signal) => (await this.fetch(provider, signal)).body
        );
        const parsed = await parser.parseSubscriptionContent(response.body.trim(), 'preview', {
          allowProviders: true,
        });
        if (abort.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
        const counts = new Map<string, number>();
        for (const node of parsed.servers)
          counts.set(node.protocol, (counts.get(node.protocol) ?? 0) + 1);
        return {
          ok: parsed.servers.length > 0,
          nodeCount: parsed.servers.length,
          protocols: [...counts].map(([protocol, count]) => ({ protocol, count })),
          ...(parsed.servers.length ? {} : { errorKind: 'empty' as const }),
        };
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
        return {
          ok: false,
          ...classifySubscriptionError({
            code,
            httpStatus:
              error && typeof error === 'object' && 'httpStatus' in error
                ? Number(error.httpStatus)
                : undefined,
            message: error instanceof Error ? error.message : '',
          }),
        };
      }
    })();
    this.previews.set(url, { abort, promise });
    try {
      return await promise;
    } finally {
      if (this.previews.get(url)?.promise === promise) this.previews.delete(url);
    }
  }
  async sync(id: string): Promise<SubscriptionCommitResult> {
    const source = (await this.config.read()).subscriptions?.find((group) => group.id === id);
    if (!source) throw new Error('Subscription not found');
    const existing = this.flights.get(id);
    if (existing?.url === source.url) return existing.promise;
    existing?.abort.abort();
    const abort = new AbortController();
    const task = (async () => {
      const response = await this.fetch(source.url, abort.signal);
      const parser = new PortableSubscriptionParser(
        async (url, signal) => (await this.fetch(url, signal)).body
      );
      const parsed = await parser.parseSubscriptionContent(response.body.trim(), id, {
        allowProviders: true,
      });
      if (abort.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      let committed!: ReturnType<typeof commitSubscriptionResult>;
      await this.config.update((draft) => {
        if (abort.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
        committed = commitSubscriptionResult(
          draft,
          source,
          {
            ...parsed,
            userInfo: parseSubscriptionUserInfo(response.headers['subscription-userinfo'] ?? null),
            etag: response.headers.etag,
            lastModified: response.headers['last-modified'],
            // This host always fetches fresh content. Provider resources cannot be hidden by a 304.
            hasProviders: parsed.servers.some((server) => server.providerName !== undefined),
          },
          new Date().toISOString()
        );
      });
      await this.afterCommit(id, committed.restartRequired);
      return committed.result;
    })();
    const flight = { url: source.url, abort, promise: task };
    this.flights.set(id, flight);
    try {
      return await task;
    } finally {
      if (this.flights.get(id) === flight) this.flights.delete(id);
    }
  }
  cancel(id: string): void {
    this.flights.get(id)?.abort.abort();
  }
  close(): void {
    for (const preview of this.previews.values()) preview.abort.abort();
    for (const flight of this.flights.values()) flight.abort.abort();
  }
}
