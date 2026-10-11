import { PortableSubscriptionParser } from '../subscription-content-parser';
import { encodeBase64Utf8 } from '../portable-codec';
const uuid = '00000000-0000-4000-8000-000000000001';
const link = `vless://${uuid}@example.com:443?security=tls&type=ws&path=%2Ffixture#fixture`;

test('main and provider content share a portable parser without Node Buffer', async () => {
  const content = encodeBase64Utf8(link);
  const fetch = jest.fn(async (_url: string, signal: AbortSignal) => {
    expect(signal.aborted).toBe(false);
    return content;
  });
  const buffer = globalThis.Buffer;
  let result;
  try {
    globalThis.Buffer = undefined as never;
    result = await new PortableSubscriptionParser(fetch).parseSubscriptionContent(
      JSON.stringify({
        'proxy-providers': { remote: { type: 'http', url: 'https://example.com/provider' } },
      }),
      'group',
      { allowProviders: true }
    );
  } finally {
    globalThis.Buffer = buffer;
  }
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result?.servers).toHaveLength(1);
  expect(result?.servers[0]).toMatchObject({
    subscriptionId: 'group',
    providerName: 'remote',
    network: 'ws',
    security: 'tls',
    wsSettings: { path: '/fixture' },
  });
});

test('nested providers do not fetch recursively and failed providers retain their precise identity', async () => {
  const fetch = jest.fn(async (url: string) => {
    if (url.endsWith('/failed')) throw new Error('timeout');
    return JSON.stringify({
      proxies: [
        {
          name: 'fixture',
          type: 'trojan',
          server: 'example.com',
          port: 443,
          password: 'fictional',
        },
      ],
      'proxy-providers': { nested: { type: 'http', url: 'https://example.com/nested' } },
    });
  });
  const result = await new PortableSubscriptionParser(fetch).parseSubscriptionContent(
    JSON.stringify({
      'proxy-providers': {
        success: { type: 'http', url: 'https://example.com/success' },
        failed: { type: 'http', url: 'https://example.com/failed' },
      },
    }),
    'group',
    { allowProviders: true }
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.servers).toHaveLength(1);
  expect(result.partial).toBe(true);
  expect(result.failedProviders).toEqual(['failed']);
});

test('empty or oversized subscriptions fail rather than allowing stored nodes to be replaced with nothing', async () => {
  const parser = new PortableSubscriptionParser(jest.fn());
  await expect(
    parser.parseSubscriptionContent('{"proxies":[]}', 'group', { allowProviders: true })
  ).rejects.toThrow('0 个可用节点');
  await expect(
    parser.parseSubscriptionContent('中'.repeat(4 * 1024 * 1024), 'group', { allowProviders: true })
  ).rejects.toThrow('体积超过上限');
});
