import {
  createHostTextRequester,
  isRetryableHostTextError,
  type HostTextTransport,
  type HostTextResponse,
} from '../host-text-request';

const response: HostTextResponse = { status: 200, body: 'fixture', headers: {} };
function fixture() {
  const host: HostTextTransport = {
    requestText: jest.fn(async () => response),
    cancelRequest: jest.fn(async () => undefined),
  };
  return { host, request: createHostTextRequester(host) };
}
describe('native host text request lifecycle', () => {
  it('uses unique identities and preserves explicit physical/current paths', async () => {
    const { host, request } = fixture();
    await request('https://example.com/subscription', 'direct');
    await request('https://example.com/subscription', 'current');
    const calls = (host.requestText as jest.Mock).mock.calls;
    expect(calls[0][0].route).toBe('direct');
    expect(calls[1][0].route).toBe('current');
    expect(calls[0][0].id).not.toBe(calls[1][0].id);
  });
  it('rejects insecure paths and pre-cancelled requests before native dispatch', async () => {
    const { host, request } = fixture();
    await expect(request('http://example.com/subscription', 'direct')).rejects.toThrow();
    await expect(
      request('https://fixture:fixture@example.com/subscription', 'direct')
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(request('https://example.com', 'current', abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(host.requestText).not.toHaveBeenCalled();
  });
  it('cancels exactly the active request and rejects its late success', async () => {
    const { host, request } = fixture();
    let finish!: (result: HostTextResponse) => void;
    host.requestText = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const abort = new AbortController();
    const pending = request('https://example.com', 'direct', abort.signal);
    abort.abort();
    finish(response);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.cancelRequest).toHaveBeenCalledTimes(1);
    expect(host.cancelRequest).toHaveBeenCalledWith({
      id: (host.requestText as jest.Mock).mock.calls[0][0].id,
    });
  });
  it('does not retry certificate errors, invalid content or cancellation', () => {
    expect(isRetryableHostTextError({ code: 'HTTP_REQUEST_FAILED' })).toBe(true);
    for (const code of ['HTTP_TLS_FAILED', 'HTTP_INVALID_RESPONSE', 'HTTP_CANCELLED', 'HTTP_BUSY'])
      expect(isRetryableHostTextError({ code })).toBe(false);
  });
});
