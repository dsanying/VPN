import { request } from 'https';
import {
  identifyEnterpriseGateway,
  normalizeEnterpriseGateway,
  type EnterpriseDetection,
} from '../../../shared/enterprise-vpn';
import { observationIsFresh } from '../../../shared/background-refresh';
/** Read-only, bounded detection. Never follows a cross-origin redirect or sends credentials. */
export async function readEnterpriseGateway(
  target: string,
  signal: AbortSignal
): Promise<{ body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'GET',
        signal,
        headers: {
          'User-Agent': 'ShadowVPN',
          Accept: 'text/html,application/json,application/xml',
        },
        rejectUnauthorized: true,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 512 * 1024) {
            req.destroy(new Error('网关响应过大'));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.join(',') : (v ?? ''),
              ])
            ),
          })
        );
      }
    );
    req.once('error', () =>
      reject(
        new Error(
          signal.aborted ? '网关识别已取消或超时' : '无法安全访问 VPN 网关，请检查网络及证书'
        )
      )
    );
    req.end();
  });
}
export class EnterpriseDiscovery {
  private cache = new Map<string, { time: number; result: EnterpriseDetection }>();
  private inflight = new Map<string, Promise<EnterpriseDetection>>();
  constructor(
    private readonly read = readEnterpriseGateway,
    private readonly forms?: (
      detected: EnterpriseDetection
    ) => Promise<NonNullable<EnterpriseDetection['fields']>>
  ) {}
  detect(value: string, force = false): Promise<EnterpriseDetection> {
    const gateway = normalizeEnterpriseGateway(value);
    const cached = this.cache.get(gateway);
    if (!force && cached && observationIsFresh(cached.time)) return Promise.resolve(cached.result);
    const pending = this.inflight.get(gateway);
    if (pending) return pending;
    const operation = this.perform(gateway)
      .then((result) => {
        if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(gateway, { time: Date.now(), result });
        return result;
      })
      .finally(() => this.inflight.delete(gateway));
    this.inflight.set(gateway, operation);
    return operation;
  }
  private async perform(gateway: string): Promise<EnterpriseDetection> {
    const signal = AbortSignal.timeout(8000);
    let target = gateway;
    for (let hop = 0; hop < 4; hop++) {
      const response = await this.read(target, signal);
      const detected = identifyEnterpriseGateway(gateway, response.body, response.headers);
      if (detected.protocol) {
        if (this.forms && detected.protocol !== 'easyconnect')
          return { ...detected, fields: await this.forms(detected) };
        return detected;
      }
      const location = response.headers.location;
      if (!location) return detected;
      const next = new URL(location, target);
      if (next.origin !== new URL(gateway).origin)
        return { ...detected, reason: '网关跳转到了外部认证页面，尚无法识别 VPN 类型' };
      target = normalizeEnterpriseGateway(next.href);
    }
    return { gateway, authentication: 'unknown', reason: '网关重定向次数过多' };
  }
}
