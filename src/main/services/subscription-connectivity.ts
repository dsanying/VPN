import { DEFAULT_SUBSCRIPTION_USER_AGENT } from '../../shared/subscription-request';
import { session } from 'electron';
import { performance } from 'perf_hooks';
import type { SubscriptionConfig } from '../../shared/types';
import type {
  SubscriptionConnectivity,
  SubscriptionLinkProbe,
} from '../../shared/subscription-connectivity';
import { safeRedirectFetch } from '../safe-redirect-fetch';
import { physicalSubscriptionFetch, DirectRouteUnavailable } from './subscription-physical-network';

export async function measureSubscriptionLink(
  url: string,
  userAgent: string,
  fetchImpl: Parameters<typeof safeRedirectFetch>[0]['fetchImpl'],
  exemptFakeIp: boolean,
  timeoutMs = 8000
): Promise<SubscriptionLinkProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  let abort: (() => void) | undefined;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { status: 'failed' };
    // DNS/redirect validation also shares the deadline, rather than only the socket.
    const response = await Promise.race([
      safeRedirectFetch({ url, userAgent, fetchImpl, exemptFakeIp, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error('deadline'));
        controller.signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
    try {
      await response.body?.cancel();
    } catch {
      /* body is intentionally unused */
    }
    return {
      status: response.status >= 200 && response.status < 300 ? 'reachable' : 'http-error',
      httpStatus: response.status,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      status: controller.signal.aborted
        ? 'timeout'
        : error instanceof DirectRouteUnavailable
          ? 'unavailable'
          : 'failed',
    };
  } finally {
    clearTimeout(timer);
    if (abort) controller.signal.removeEventListener('abort', abort);
    controller.abort();
  }
}
/** Sessions are exclusive to this operation; core restarts cannot repin another in-flight request. */
export async function checkSubscriptionConnectivity(
  subscription: SubscriptionConfig,
  directPort: number | null,
  onResult?: (route: 'direct' | 'current', probe: SubscriptionLinkProbe) => void
): Promise<SubscriptionConnectivity> {
  const suffix = subscription.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const current = session.fromPartition(`shadowvpn-link-current-${suffix}`);
  await current.setProxy({ mode: 'system' });
  let directFetch: Parameters<typeof safeRedirectFetch>[0]['fetchImpl'] = physicalSubscriptionFetch;
  if (directPort) {
    const direct = session.fromPartition(`shadowvpn-link-direct-${suffix}-${directPort}`);
    await direct.setProxy({
      proxyRules: `http://127.0.0.1:${directPort}`,
      proxyBypassRules: '<-loopback>',
    });
    directFetch = (url, init) => direct.fetch(url, { ...init, cache: 'no-store' });
  }
  const userAgent = DEFAULT_SUBSCRIPTION_USER_AGENT;
  const [direct, normal] = await Promise.all([
    measureSubscriptionLink(subscription.url, userAgent, directFetch, !!directPort).then(
      (value) => {
        onResult?.('direct', value);
        return value;
      }
    ),
    measureSubscriptionLink(
      subscription.url,
      userAgent,
      (url, init) => current.fetch(url, { ...init, cache: 'no-store' }),
      true
    ).then((value) => {
      onResult?.('current', value);
      return value;
    }),
  ]);
  return { direct, current: normal, checkedAt: new Date().toISOString() };
}
