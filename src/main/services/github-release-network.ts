import { net, type Session } from 'electron';
import { APP_USER_AGENT } from '../../shared/constants';
import type { ReleaseResponse } from './github-release-source';

/** Bounded metadata reader; redirects may not leave the trusted HTTPS publisher hosts. */
export function readPublisherResponse(
  url: string,
  accept: string,
  session: Session | undefined,
  signal?: AbortSignal
): Promise<ReleaseResponse> {
  if (signal?.aborted) return Promise.reject(new Error('检查更新已取消'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const request = net.request({ method: 'GET', url, session });
    const finish = (error?: Error, result?: ReleaseResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () => {
      finish(new Error('检查更新已取消'));
      request.abort();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      finish(new Error('检查更新超时'));
      request.abort();
    }, 15000);
    request.setHeader('User-Agent', APP_USER_AGENT);
    request.setHeader('Accept', accept);
    request.on('redirect', (_status, _method, location) => {
      try {
        const next = new URL(location);
        if (
          next.protocol !== 'https:' ||
          !['https://github.com', 'https://api.github.com', 'https://dsanying.github.io'].includes(
            next.origin
          ) ||
          next.username ||
          next.password
        ) {
          finish(new Error('Untrusted release metadata redirect'));
          request.abort();
        }
      } catch {
        finish(new Error('Invalid release metadata redirect'));
        request.abort();
      }
    });
    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 16 * 1024 * 1024) {
          finish(new Error('GitHub 响应过大'));
          request.abort();
          return;
        }
        chunks.push(bytes);
      });
      response.on('end', () =>
        finish(undefined, {
          status: response.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
      response.on('error', (error: Error) => finish(error));
    });
    request.on('error', (error: Error) => finish(error));
    request.end();
  });
}
