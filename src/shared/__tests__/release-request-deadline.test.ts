import { fetchPublisherReleases } from '../publisher-release-source';

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), delay);
    return controller.signal;
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('an unresponsive catalog cannot block the official publisher fallback', async () => {
  const read = jest.fn(async (url: string) => {
    if (url.includes('github.io')) return new Promise<never>(() => undefined);
    return { status: 200, body: '[]' };
  });
  const result = fetchPublisherReleases('dsanying/VPN', read);
  await jest.advanceTimersByTimeAsync(5001);
  expect(await result).toEqual([]);
  expect(read.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
    'dsanying.github.io',
    'api.github.com',
  ]);
});

test('every metadata route times out even when the native reader ignores abort', async () => {
  const read = jest.fn(
    (_url: string, _accept: string, _signal?: AbortSignal) => new Promise<never>(() => undefined)
  );
  const result = fetchPublisherReleases('dsanying/VPN', read);
  const rejected = expect(result).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(36000);
  await rejected;
  expect(read).toHaveBeenCalledTimes(3);
  expect(read.mock.calls.every(([, , signal]) => signal?.aborted)).toBe(true);
});

test('a late expired response cannot replace an already accepted fallback result', async () => {
  let late: (value: { status: number; body: string }) => void = () => undefined;
  const read = jest.fn(async (url: string) => {
    if (url.includes('github.io'))
      return new Promise<{ status: number; body: string }>((resolve) => {
        late = resolve;
      });
    return { status: 200, body: '[]' };
  });
  const result = fetchPublisherReleases('dsanying/VPN', read);
  await jest.advanceTimersByTimeAsync(5001);
  expect(await result).toEqual([]);
  late({ status: 200, body: 'malformed' });
  await Promise.resolve();
  expect(await result).toEqual([]);
});
