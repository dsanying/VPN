import { ConfigRepository } from '../config-repository';
import { createDefaultConfig } from '../config-defaults';
import { PortableRefreshCoordinator } from '../portable-refresh-coordinator';
const node = (id: string, subscriptionId?: string) => ({
  id,
  name: id,
  address: 'example.com',
  port: 443,
  protocol: 'vless' as const,
  uuid: '00000000-0000-4000-8000-000000000001',
  subscriptionId,
});
function fixture() {
  const config = new ConfigRepository(
    { read: async () => null, write: async () => undefined },
    () => ({
      ...createDefaultConfig('fixture'),
      servers: [node('a', 'one'), node('b', 'one'), node('c', 'two')],
      subscriptions: ['one', 'two'].map((id) => ({
        id,
        name: id,
        url: 'https://example.com/' + id,
        createdAt: '2026-01-01',
        autoUpdate: true,
      })),
    }),
    () => undefined
  );
  const ports = {
    sync: jest.fn(async (_id: string) => undefined),
    connectivity: jest.fn(async (_id: string) => undefined),
    measure: jest.fn(async (_ids: string[]) => undefined),
    applySaved: jest.fn(async () => undefined),
    cleanup: jest.fn(async () => undefined),
    error: jest.fn(),
  };
  const coordinator = new PortableRefreshCoordinator(config, ports);
  return { config, ports, coordinator };
}
test('coalesced group changes sync first and measure only current group members once', async () => {
  const f = fixture();
  const order: string[] = [];
  f.ports.sync.mockImplementation(async (id) => {
    order.push('sync:' + id);
    await f.config.update((config) => {
      config.servers.push(node('new', id));
    });
    f.coordinator.subscriptionCommitted(id, true);
  });
  f.ports.measure.mockImplementation(async () => {
    order.push('measure');
  });
  f.coordinator.request({ syncGroupIds: ['one'], groupIds: ['one'] });
  f.coordinator.request({ groupIds: ['one'], subscriptionIds: ['one'] });
  await f.coordinator.idle();
  expect(f.ports.sync).toHaveBeenCalledTimes(1);
  expect(f.ports.measure).toHaveBeenCalledTimes(1);
  expect(f.ports.measure).toHaveBeenCalledWith(['a', 'b', 'new']);
  expect(order).toEqual(['sync:one', 'measure']);
  expect(f.ports.connectivity).toHaveBeenCalledWith('one');
  expect(f.ports.applySaved).toHaveBeenCalledTimes(1);
});
test('manual completed sync initializes its entire group without another pull', async () => {
  const f = fixture();
  f.coordinator.subscriptionCommitted('two', false);
  await f.coordinator.idle();
  expect(f.ports.sync).not.toHaveBeenCalled();
  expect(f.ports.measure).toHaveBeenCalledWith(['c']);
});
test('full refresh visits all subscriptions and all nodes, including standalone nodes', async () => {
  const f = fixture();
  await f.config.update((config) => {
    config.servers.push(node('local'));
  });
  f.coordinator.request({ all: true });
  await f.coordinator.idle();
  expect(f.ports.sync.mock.calls.map((call) => call[0])).toEqual(['one', 'two']);
  expect(f.ports.measure).toHaveBeenCalledWith(['a', 'b', 'c', 'local']);
});
test('failed pulls preserve downstream work and do not prevent the other group', async () => {
  const f = fixture();
  f.ports.sync.mockRejectedValueOnce(new Error('offline'));
  f.coordinator.request({ all: true });
  await f.coordinator.idle();
  expect(f.ports.sync).toHaveBeenCalledTimes(2);
  expect(f.ports.error).toHaveBeenCalledWith('subscription:one', expect.any(Error));
  expect(f.ports.measure).toHaveBeenCalledTimes(1);
});
test('configuration scope and screen reads do not invent unrelated work', async () => {
  const f = fixture();
  const previous = await f.config.read();
  const saved = await f.config.update((config) => {
    config.servers[0].port = 8443;
  });
  f.coordinator.saved(previous, saved);
  await f.coordinator.idle();
  expect(f.ports.sync).not.toHaveBeenCalled();
  expect(f.ports.measure).toHaveBeenCalledWith(['a']);
  await f.config.read();
  await f.coordinator.idle();
  expect(f.ports.measure).toHaveBeenCalledTimes(1);
});
test('closed coordinator does not queue work', async () => {
  const f = fixture();
  f.coordinator.close();
  f.coordinator.request({ all: true });
  await f.coordinator.idle();
  expect(f.ports.sync).not.toHaveBeenCalled();
});
