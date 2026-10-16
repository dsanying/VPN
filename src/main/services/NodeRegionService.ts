import { get } from 'https';
import { isIP } from 'net';
import { normalizeCountryCode } from '../../shared/country';
import { isShadowvpnFakeIp, isPrivateIp } from '../../shared/ssrf-guard';
import type { NodeRegionObservation } from '../../shared/speed-test';

/** Only public endpoint addresses leave the app; never send names, credentials or private DNS. */
export function isGeolocatableAddress(ip: string): boolean {
  if (!isIP(ip) || isPrivateIp(ip) || isShadowvpnFakeIp(ip)) return false;
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return (
      a < 224 &&
      !(a === 192 && b === 0 && (c === 0 || c === 2)) &&
      !(a === 198 && b === 51 && c === 100) &&
      !(a === 203 && b === 0 && c === 113)
    );
  }
  return /^[23]/i.test(ip) && !/^2001:db8:/i.test(ip);
}

function requestJson(url: string): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value?: unknown) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      finish();
      req.destroy();
    }, 2500);
    const req = get(
      url,
      { rejectUnauthorized: true, headers: { 'User-Agent': 'ShadowVPN', Connection: 'close' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish();
          return;
        }
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 16_384) {
            finish();
            req.destroy();
          }
        });
        res.on('error', () => finish());
        res.on('end', () => {
          try {
            finish(JSON.parse(body));
          } catch {
            finish();
          }
        });
      }
    );
    req.on('error', () => finish());
  });
}

/** Per-run deduplication only. Persistence, expiry and scheduling belong to NodeMeasurementStore. */
export class NodeRegionService {
  private lookups = new Map<string, Promise<NodeRegionObservation | undefined>>();
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(
    private readonly fetchJson = requestJson,
    private readonly clock = Date.now
  ) {}
  lookup(ip?: string): Promise<NodeRegionObservation | undefined> {
    if (!ip || !isGeolocatableAddress(ip)) return Promise.resolve(undefined);
    let task = this.lookups.get(ip);
    if (!task) {
      task = this.run(ip);
      this.lookups.set(ip, task);
    }
    return task;
  }
  private async run(ip: string): Promise<NodeRegionObservation | undefined> {
    if (this.active >= 4) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      for (const [provider, url] of [
        ['ipwho.is', `https://ipwho.is/${encodeURIComponent(ip)}?fields=ip,success,country_code`],
        ['ipapi.co', `https://ipapi.co/${encodeURIComponent(ip)}/json/`],
      ]) {
        let data: unknown;
        try {
          data = await this.fetchJson(url);
        } catch {
          continue;
        }
        if (!data || typeof data !== 'object') continue;
        const value = data as Record<string, unknown>;
        const code = normalizeCountryCode(value.country_code);
        if (value.ip === ip && value.success !== false && !value.error && code)
          return { ip, countryCode: code, measuredAt: this.clock(), provider };
      }
      return undefined;
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
