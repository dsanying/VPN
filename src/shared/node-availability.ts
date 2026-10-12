import { BACKGROUND_REFRESH_MS } from './background-refresh';

/** A successful proxy request is evidence of availability only within its measurement lifetime. */
export const NODE_MEASUREMENT_FRESH_MS = BACKGROUND_REFRESH_MS;
/** Both display freshness and automatic scheduling use the same boundary. */
export function measurementExpired(testedAt: number, now: number): boolean {
  return (
    !Number.isFinite(testedAt) || testedAt > now || now - testedAt >= NODE_MEASUREMENT_FRESH_MS
  );
}
export type NodeAvailabilityState = 'available' | 'failed' | 'stale' | 'untested' | 'unknown';
export function nodeAvailability(
  latency: number | undefined,
  testedAt: number | undefined,
  now: number,
  invalidated = false,
  reason?: string
): NodeAvailabilityState {
  if (
    invalidated ||
    testedAt === undefined ||
    !Number.isFinite(testedAt) ||
    latency === undefined ||
    !Number.isFinite(latency)
  )
    return 'untested';
  if (measurementExpired(testedAt, now)) return 'stale';
  if (latency < 0 && isProbeUnavailable(reason)) return 'unknown';
  return latency >= 0 ? 'available' : 'failed';
}

/** Local probe failures provide no evidence that the remote node is broken. */
export function isProbeUnavailable(reason?: string): boolean {
  return ['core-not-ready', 'select-failed', 'exception', 'unusable'].includes(reason ?? '');
}
