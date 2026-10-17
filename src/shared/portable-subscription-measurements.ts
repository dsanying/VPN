import type { ConfigRepository, ConfigDocumentStore } from './config-repository';
import { PortableMeasurementRepository } from './portable-measurement-repository';
import { subscriptionMeasurementIdentity } from './measurement-identity';
import { createHostTextRequester, type HostTextTransport } from './host-text-request';
import { DEFAULT_SUBSCRIPTION_USER_AGENT } from './subscription-request';
import type {
  SubscriptionConnectivity,
  SubscriptionLinkProbe,
  SubscriptionProbeProgress,
} from './subscription-connectivity';

export async function portableSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function isSubscriptionConnectivity(value: unknown): value is SubscriptionConnectivity {
  if (!value || typeof value !== 'object') return false;
  const data = value as SubscriptionConnectivity;
  const validProbe = (probe: SubscriptionLinkProbe): boolean =>
    !!probe &&
    ['reachable', 'http-error', 'timeout', 'failed', 'unavailable'].includes(probe.status) &&
    (probe.httpStatus === undefined ||
      (Number.isInteger(probe.httpStatus) && probe.httpStatus >= 100 && probe.httpStatus <= 599)) &&
    (probe.latencyMs === undefined || (Number.isFinite(probe.latencyMs) && probe.latencyMs >= 0));
  return (
    typeof data.checkedAt === 'string' &&
    Number.isFinite(Date.parse(data.checkedAt)) &&
    validProbe(data.direct) &&
    validProbe(data.current)
  );
}

/** Pages read saved results. Configuration changes and explicit refresh invoke check(). */
export class PortableSubscriptionMeasurements {
  private readonly records;
  private readonly request;
  private flights = new Map<
    string,
    { abort: AbortController; promise: Promise<SubscriptionConnectivity> }
  >();
  constructor(
    private readonly config: ConfigRepository,
    store: ConfigDocumentStore,
    host: HostTextTransport,
    private readonly publish: (records: Record<string, SubscriptionConnectivity>) => void,
    private readonly hash: (value: string) => Promise<string> = portableSha256,
    private readonly progress?: (value: SubscriptionProbeProgress) => void
  ) {
    this.records = new PortableMeasurementRepository(
      store,
      'subscription-measurements',
      async () =>
        new Map(
          await Promise.all(
            ((await config.read()).subscriptions ?? []).map(
              async (sub) => [sub.id, await hash(subscriptionMeasurementIdentity(sub))] as const
            )
          )
        ),
      isSubscriptionConnectivity
    );
    this.request = createHostTextRequester(host);
  }
  async read(): Promise<Record<string, SubscriptionConnectivity>> {
    return Object.fromEntries(
      Object.entries(await this.records.read()).map(([id, record]) => [id, record.value])
    );
  }
  async check(id: string): Promise<SubscriptionConnectivity> {
    const sub = (await this.config.read()).subscriptions?.find((item) => item.id === id);
    if (!sub) throw new Error('Subscription not found');
    const fingerprint = await this.hash(subscriptionMeasurementIdentity(sub));
    const key = JSON.stringify([id, fingerprint]);
    const existing = this.flights.get(key);
    if (existing) return existing.promise;
    const abort = new AbortController();
    const observedAt = Date.now();
    const promise = (async () => {
      const emit = (value: SubscriptionProbeProgress) => {
        try {
          this.progress?.(value);
        } catch {
          /* Detached view cannot interrupt measurement. */
        }
      };
      emit({ subscriptionId: id, url: sub.url, startedAt: observedAt });
      const probe = async (route: 'direct' | 'current'): Promise<SubscriptionLinkProbe> => {
        const start = Date.now();
        try {
          const response = await this.request(
            sub.url,
            route,
            abort.signal,
            DEFAULT_SUBSCRIPTION_USER_AGENT,
            true
          );
          return {
            status: response.status >= 200 && response.status < 300 ? 'reachable' : 'http-error',
            httpStatus: response.status,
            latencyMs: Math.round(Date.now() - start),
          };
        } catch (error) {
          if (abort.signal.aborted) throw error;
          const code =
            error && typeof error === 'object' && 'code' in error ? error.code : undefined;
          return {
            status:
              code === 'HTTP_ROUTE_UNAVAILABLE'
                ? 'unavailable'
                : code === 'HTTP_TIMEOUT'
                  ? 'timeout'
                  : 'failed',
          };
        }
      };
      // Independent routes share a bounded native request deadline, never confirmation polling.
      const run = async (route: 'direct' | 'current') => {
        const value = await probe(route);
        if (!abort.signal.aborted) emit({ subscriptionId: id, url: sub.url, route, probe: value });
        return value;
      };
      const [direct, current] = await Promise.all([run('direct'), run('current')]);
      if (abort.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      const value = { direct, current, checkedAt: new Date(observedAt).toISOString() };
      await this.records.save(id, { fingerprint, observedAt, value });
      this.publish(await this.read());
      return value;
    })();
    this.flights.set(key, { abort, promise });
    try {
      return await promise;
    } finally {
      if (this.flights.get(key)?.promise === promise) this.flights.delete(key);
    }
  }
  cancel(id: string): void {
    for (const [key, flight] of this.flights) if (JSON.parse(key)[0] === id) flight.abort.abort();
  }
  close(): void {
    for (const flight of this.flights.values()) flight.abort.abort();
  }
}
