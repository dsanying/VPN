import { PortableClientService, type PortableClientPorts } from '../portable-client-service';
import { PortableCoreController } from '../portable-core-controller';
import { PortableConfigOperations } from '../portable-config-operations';
import { ConfigRepository } from '../config-repository';
import { createDefaultConfig } from '../config-defaults';
import { IPC_CHANNELS as C } from '../ipc-channels';
import type { PortableSubscriptionManager } from '../portable-subscription-manager';
import type { PortableSubscriptionMeasurements } from '../portable-subscription-measurements';

function fixture() {
  let content: string | null = null;
  const write = jest.fn(async (_name: string, value: string) => {
    content = value;
  });
  const repository = new ConfigRepository(
    { read: async () => content, write },
    () => createDefaultConfig('fixture'),
    () => undefined
  );
  const callbacks = new Set<(status: { running: boolean; busy: boolean }) => void>();
  const native = {
    status: jest.fn(async () => ({ running: false, busy: false })),
    subscribe: jest.fn(async (cb: (status: { running: boolean; busy: boolean }) => void) => {
      callbacks.add(cb);
      return () => {
        callbacks.delete(cb);
      };
    }),
    checkConfig: jest.fn(async () => undefined),
    start: jest.fn(async () => ({ running: true, busy: false })),
    stop: jest.fn(async () => ({ running: false, busy: false })),
  };
  const compiled: unknown[] = [];
  const core = new PortableCoreController(repository, native, async (config) => {
    compiled.push(config);
    return JSON.stringify(config);
  });
  const operations = new PortableConfigOperations(repository, {
    saved: async () => undefined,
    removeServer: async () => undefined,
    removeSubscription: () => undefined,
  });
  const ports: PortableClientPorts = {
    config: repository,
    operations,
    core,
    subscriptions: {
      sync: jest.fn(async () => ({ success: true })),
      close: jest.fn(),
    } as unknown as PortableSubscriptionManager,
    links: {
      read: jest.fn(async () => ({})),
      check: jest.fn(),
      close: jest.fn(),
    } as unknown as PortableSubscriptionMeasurements,
    preview: jest.fn(async () => ({ ok: true, nodeCount: 1 })),
    applications: jest.fn(async () => []),
    nodeMeasurements: jest.fn(async () => ({})),
    speedTest: jest.fn(),
    version: jest.fn(),
    logs: jest.fn(async () => []),
    clearLogs: jest.fn(),
  };
  return {
    service: new PortableClientService(ports),
    ports,
    native,
    write,
    repository,
    callbacks,
    compiled,
  };
}
test('shared service starts from the durable config, never from a renderer supplied draft', async () => {
  const f = fixture();
  await f.service.invoke(C.CONFIG_SET_VALUE, { key: 'proxyMode', value: 'direct' });
  expect((await f.service.invoke(C.PROXY_START, { proxyMode: 'global' })).success).toBe(true);
  expect(f.compiled).toEqual([expect.objectContaining({ proxyMode: 'direct' })]);
  expect(f.native.checkConfig).toHaveBeenCalledTimes(1);
});
test('storage rejection is returned and cannot publish a successful mutation', async () => {
  const f = fixture();
  await f.service.initialize();
  const changed = jest.fn();
  f.service.on(C.EVENT_CONFIG_CHANGED, changed);
  f.write.mockRejectedValueOnce(new Error('disk full'));
  expect(
    await f.service.invoke(C.CONFIG_SET_VALUE, { key: 'autoConnect', value: true })
  ).toMatchObject({ success: false, error: 'disk full' });
  expect(changed).not.toHaveBeenCalled();
  expect((await f.repository.read()).autoConnect).toBe(false);
});
test('reading pages never starts synchronization or probes; explicit group refresh has exact scope', async () => {
  const f = fixture();
  await f.service.invoke(C.CONFIG_GET);
  await f.service.invoke(C.SUBSCRIPTION_MEASUREMENTS);
  expect(f.ports.subscriptions.sync).not.toHaveBeenCalled();
  expect(f.ports.links.check).not.toHaveBeenCalled();
  await f.service.invoke(C.SUBSCRIPTION_UPDATE_SERVERS, { subscriptionId: 'group-one' });
  expect(f.ports.subscriptions.sync).toHaveBeenCalledWith('group-one');
});
test('unavailable native operations fail with a stable capability code', async () => {
  const f = fixture();
  expect(await f.service.invoke(C.AUTO_START_SET, { enabled: true })).toMatchObject({
    success: false,
    code: 'HOST_CAPABILITY_UNAVAILABLE',
  });
  expect(f.native.start).not.toHaveBeenCalled();
});
test('concurrent initialization owns one native subscription and close detaches all callbacks', async () => {
  const f = fixture();
  await Promise.all([f.service.initialize(), f.service.initialize()]);
  expect(f.native.subscribe).toHaveBeenCalledTimes(1);
  expect(f.callbacks.size).toBe(1);
  f.service.close();
  expect(f.callbacks.size).toBe(0);
  expect((await f.service.invoke(C.CONFIG_GET)).success).toBe(false);
});
