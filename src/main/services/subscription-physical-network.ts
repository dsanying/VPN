import { lookup } from 'dns/promises';
import { isPrivateIp } from '../../shared/ssrf-guard';
import * as http from 'http';
import * as https from 'https';
import { Readable } from 'stream';
import { hasDirectEntryRoute } from './entry-probe';
export class DirectRouteUnavailable extends Error {}
/** No running core: pin each HTTP hop to an IP with a verified physical route.
 * Fail closed where physical routing cannot be verified; never label captured traffic direct. */
export async function physicalSubscriptionFetch(
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal }
) {
  const target = new URL(url);
  const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (addresses.some((item) => isPrivateIp(item.address))) throw new DirectRouteUnavailable();
  const routes = await Promise.all(
    addresses.map(async (item) => ({ ...item, direct: await hasDirectEntryRoute(item.address) }))
  );
  const address = routes.find((item) => item.direct);
  if (!address) throw new DirectRouteUnavailable();
  if (init.signal?.aborted) throw new Error('aborted');
  return new Promise<Response>((resolve, reject) => {
    const request = (target.protocol === 'https:' ? https : http).request(
      target,
      {
        headers: init.headers,
        signal: init.signal,
        agent: false,
        lookup: (_host, options, callback) =>
          options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      },
      (response) => {
        const status = response.statusCode ?? 500;
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const bodyless = [204, 205, 304].includes(status);
        if (bodyless) response.destroy();
        resolve(
          new Response(bodyless ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>), {
            status,
            headers,
          })
        );
      }
    );
    request.on('error', reject);
    request.end();
  });
}
