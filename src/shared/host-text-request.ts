export interface HostTextResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}
export interface HostTextTransport {
  requestText(options: {
    id: string;
    url: string;
    route: 'direct' | 'current';
    userAgent?: string;
    headersOnly?: boolean;
  }): Promise<HostTextResponse>;
  cancelRequest(options: { id: string }): Promise<void>;
}

/** One native request identity per operation; cancellation never publishes a late response. */
export function createHostTextRequester(host: HostTextTransport) {
  return async (
    url: string,
    route: 'direct' | 'current',
    signal?: AbortSignal,
    userAgent = 'clash.meta',
    headersOnly = false
  ): Promise<HostTextResponse> => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw new Error('请求必须使用不含用户信息的 HTTPS 地址');
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    const id = crypto.randomUUID();
    const cancel = () => {
      void host.cancelRequest({ id }).catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await host.requestText({
        id,
        url,
        route,
        userAgent,
        ...(headersOnly ? { headersOnly: true } : {}),
      });
      if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
      return response;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  };
}

/** TLS/format errors and user cancellation must not silently switch network paths. */
export function isRetryableHostTextError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    ['HTTP_REQUEST_FAILED', 'HTTP_TIMEOUT', 'HTTP_ROUTE_UNAVAILABLE'].includes(String(error.code))
  );
}
