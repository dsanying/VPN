import { createHash } from 'crypto';
import { ConfigRepository } from '../config-repository';
import { createDefaultConfig } from '../config-defaults';
import { PortableSubscriptionMeasurements } from '../portable-subscription-measurements';
import type { HostTextTransport, HostTextResponse } from '../host-text-request';

async function fixture() {
  const documents = new Map<string, string>();
  const store = {
    read: async (name: string) => documents.get(name) ?? null,
    write: async (name: string, content: string) => {
      documents.set(name, content);
    },
  };
  const config = new ConfigRepository(
    store,
    () => createDefaultConfig('fixture'),
    () => undefined
  );
  await config.update((draft) => {
    draft.subscriptions = [
      {
        id: 'group',
        name: 'Fixture',
        autoUpdate: true,
        url: 'https://example.com/subscription',
        createdAt: new Date().toISOString(),
      },
    ];
  });
  const host: HostTextTransport = {
    requestText: jest.fn(async (options) => ({
      status: options.route === 'direct' ? 200 : 403,
      body: '',
      headers: {},
    })),
    cancelRequest: jest.fn(async () => undefined),
  };
  const publish = jest.fn();
  const open = () =>
    new PortableSubscriptionMeasurements(config, store, host, publish, async (value) =>
      createHash('sha256').update(value).digest('hex')
    );
  return { config, host, publish, open, measurements: open() };
}
test('page reads perform no network, manual measurement uses both routes and persists across reopening', async () => {
  const { measurements, host, open } = await fixture();
  expect(await measurements.read()).toEqual({});
  expect(host.requestText).not.toHaveBeenCalled();
  const result = await measurements.check('group');
  expect(result.direct).toMatchObject({ status: 'reachable', httpStatus: 200 });
  expect(result.current).toMatchObject({ status: 'http-error', httpStatus: 403 });
  expect(host.requestText).toHaveBeenCalledTimes(2);
  expect(
    (host.requestText as jest.Mock).mock.calls.every(([options]) => options.headersOnly === true)
  ).toBe(true);
  expect((await open().read()).group).toEqual(result);
});
test('obsolete probes finish without persisting a replaced subscription link', async () => {
  const { measurements, config, host } = await fixture();
  const pending: Array<(response: HostTextResponse) => void> = [];
  host.requestText = jest.fn(() => new Promise((resolve) => pending.push(resolve)));
  const operation = measurements.check('group');
  while (pending.length < 2) await Promise.resolve();
  await config.update((draft) => {
    draft.subscriptions![0].url = 'https://example.com/replaced';
  });
  for (const resolve of pending) resolve({ status: 200, headers: {}, body: '' });
  await operation;
  expect(await measurements.read()).toEqual({});
});
test('route unavailability and deadlines remain distinct from real HTTP failure', async () => {
  const { measurements, host } = await fixture();
  host.requestText = jest.fn(async (options) => {
    throw { code: options.route === 'direct' ? 'HTTP_ROUTE_UNAVAILABLE' : 'HTTP_TIMEOUT' };
  });
  const result = await measurements.check('group');
  expect(result.direct.status).toBe('unavailable');
  expect(result.current.status).toBe('timeout');
});
