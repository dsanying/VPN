import {
  checkSubscriptionConnectivity,
  measureSubscriptionLink,
} from '../subscription-connectivity';
import { session } from 'electron';
import { safeRedirectFetch } from '../../safe-redirect-fetch';
jest.mock('electron', () => ({ session: { fromPartition: jest.fn() } }));
jest.mock('../../safe-redirect-fetch', () => ({ safeRedirectFetch: jest.fn() }));
const safeFetch = jest.mocked(safeRedirectFetch);
const subscription = {
  id: 's1',
  name: 'Test',
  url: 'https://example.com/sub',
  autoUpdate: true,
  createdAt: '2026-10-01',
};
beforeEach(() => {
  jest.clearAllMocks();
});
function response(status: number) {
  return { status, headers: { get: () => null }, body: { cancel: jest.fn(async () => {}) } };
}
test('HTTP response errors remain distinct from unreachable links, and response bodies are released', async () => {
  const result = response(403);
  safeFetch.mockResolvedValue(result);
  expect(await measureSubscriptionLink(subscription.url, 'test', jest.fn(), false)).toMatchObject({
    status: 'http-error',
    httpStatus: 403,
  });
  expect(result.body.cancel).toHaveBeenCalledTimes(1);
  safeFetch.mockRejectedValue(new Error('network'));
  expect(await measureSubscriptionLink(subscription.url, 'test', jest.fn(), false)).toEqual({
    status: 'failed',
  });
});
test('deadline also bounds DNS or redirect validation and aborts the request', async () => {
  safeFetch.mockImplementation(
    async (options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('abort')));
      })
  );
  expect(await measureSubscriptionLink(subscription.url, 'test', jest.fn(), false, 5)).toEqual({
    status: 'timeout',
  });
});
test('current network uses system proxy; forced direct exclusively pins the fixed direct inbound', async () => {
  const current = { setProxy: jest.fn(async () => {}), fetch: jest.fn(async () => response(200)) };
  const direct = { setProxy: jest.fn(async () => {}), fetch: jest.fn(async () => response(204)) };
  jest
    .mocked(session.fromPartition)
    .mockReturnValueOnce(current as never)
    .mockReturnValueOnce(direct as never);
  safeFetch.mockImplementation(async (opts) =>
    opts.fetchImpl(opts.url, { headers: {}, redirect: 'manual', signal: opts.signal })
  );
  const result = await checkSubscriptionConnectivity(subscription, 12345);
  expect(current.setProxy).toHaveBeenCalledWith({ mode: 'system' });
  expect(direct.setProxy).toHaveBeenCalledWith({
    proxyRules: 'http://127.0.0.1:12345',
    proxyBypassRules: '<-loopback>',
  });
  expect(result.direct).toMatchObject({ status: 'reachable', httpStatus: 204 });
  expect(result.current).toMatchObject({ status: 'reachable', httpStatus: 200 });
  expect(current.fetch).toHaveBeenCalledWith(
    subscription.url,
    expect.objectContaining({ cache: 'no-store', redirect: 'manual' })
  );
});

test('without a core, unverified physical routing is explicitly unavailable, never substituted with current-network success', async () => {
  const dns = await import('dns/promises');
  const entry = await import('../entry-probe');
  jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '203.0.113.10', family: 4 }] as never);
  jest.spyOn(entry, 'hasDirectEntryRoute').mockResolvedValue(false);
  const current = { setProxy: jest.fn(async () => {}), fetch: jest.fn(async () => response(200)) };
  jest.mocked(session.fromPartition).mockReturnValueOnce(current as never);
  safeFetch.mockImplementation(async (opts) =>
    opts.fetchImpl(opts.url, { headers: {}, redirect: 'manual', signal: opts.signal })
  );
  const result = await checkSubscriptionConnectivity(subscription, null);
  expect(result.direct).toEqual({ status: 'unavailable' });
  expect(result.current.status).toBe('reachable');
  expect(session.fromPartition).toHaveBeenCalledTimes(1);
  jest.restoreAllMocks();
});

test('publishes the fast route before the other route completes', async () => {
  let complete!: (value: ReturnType<typeof response>) => void;
  const slow = new Promise<ReturnType<typeof response>>((resolve) => {
    complete = resolve;
  });
  const current = { setProxy: jest.fn(async () => {}), fetch: jest.fn(async () => response(200)) };
  const direct = { setProxy: jest.fn(async () => {}), fetch: jest.fn(() => slow) };
  jest
    .mocked(session.fromPartition)
    .mockReturnValueOnce(current as never)
    .mockReturnValueOnce(direct as never);
  safeFetch.mockImplementation(async (opts) =>
    opts.fetchImpl(opts.url, { headers: {}, redirect: 'manual', signal: opts.signal })
  );
  const updates = jest.fn();
  const task = checkSubscriptionConnectivity(subscription, 12345, updates);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(updates).toHaveBeenCalledWith(
    'current',
    expect.objectContaining({ status: 'reachable', httpStatus: 200 })
  );
  expect(updates).not.toHaveBeenCalledWith('direct', expect.anything());
  complete(response(204));
  await task;
  expect(updates).toHaveBeenCalledWith(
    'direct',
    expect.objectContaining({ status: 'reachable', httpStatus: 204 })
  );
});
