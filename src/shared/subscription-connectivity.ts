/** HTTP reachability only; never a subscription parse or node availability result. */
export interface SubscriptionLinkProbe {
  status: 'reachable' | 'http-error' | 'timeout' | 'failed' | 'unavailable';
  httpStatus?: number;
  latencyMs?: number;
}
export interface SubscriptionConnectivity {
  direct: SubscriptionLinkProbe;
  current: SubscriptionLinkProbe;
  checkedAt: string;
}

/** Transient route progress is never written as a completed cache observation. */
export interface SubscriptionProbeProgress {
  subscriptionId: string;
  url: string;
  startedAt?: number;
  route?: 'direct' | 'current';
  probe?: SubscriptionLinkProbe;
}
