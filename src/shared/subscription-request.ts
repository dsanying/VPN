export type SubscriptionRequestRoute = boolean | 'auto';
export const DEFAULT_SUBSCRIPTION_USER_AGENT = 'clash.meta';

/** At most one direct attempt and one proxy attempt. Validation failures never change paths. */
export async function requestSubscription<T>(
  route: SubscriptionRequestRoute,
  proxyAvailable: () => boolean,
  request: (proxy: boolean) => Promise<T>,
  retryable: (error: unknown) => boolean
): Promise<T> {
  if (route !== 'auto') return request(route);
  try {
    return await request(false);
  } catch (error) {
    if (!proxyAvailable() || !retryable(error)) throw error;
    return request(true);
  }
}
