import type { ServiceId, UnlockResult } from './unlock-detection';
export interface WebsiteProbeResponse {
  status: number;
  body: string;
  error?: string;
  redirectChain: Array<{ location: string }>;
}
export function classifyWebsite(_id: ServiceId, res: WebsiteProbeResponse): UnlockResult {
  if (!res.status)
    return {
      status: res.error === 'timeout' ? 'timeout' : 'error',
      reason: res.error ?? 'no-response',
    };
  const detail = { httpStatus: res.status };
  if (res.status < 200 || res.status >= 600)
    return { ...detail, status: 'error', reason: 'invalid-http-response' };
  // Only inspect a short error response or an explicit denial redirect. No absence-of-marker inference.
  const denialRedirect = res.redirectChain.some((hop) => {
    try {
      const u = new URL(hop.location);
      return u.hostname === 'www.anthropic.com' && u.pathname === '/app-unavailable-in-region';
    } catch {
      return false;
    }
  });
  const denialBody =
    (res.status === 403 || res.status === 451) &&
    /not available in your (?:country|region)|unavailable in your (?:country|region)|unsupported_country/i.test(
      res.body
    );
  if (denialRedirect || denialBody)
    return { ...detail, status: 'blocked', reason: 'explicit-region-restriction' };
  // HTTP 403/404/5xx still proves that the TLS-authenticated remote server answered. Display the status code.
  return { ...detail, status: 'ok', reason: 'http-response-received' };
}
