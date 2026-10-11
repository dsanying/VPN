import { ConfigRepository } from '../config-repository';
import { createDefaultConfig } from '../config-defaults';
import { PortableSubscriptionManager } from '../portable-subscription-manager';
import type { HostTextResponse, HostTextTransport } from '../host-text-request';

const response: HostTextResponse = {
  status: 200,
  body: 'vless://11111111-1111-4111-8111-111111111111@new.example.com:443?security=tls&type=ws&path=%2Ffixture#Fixture',
  headers: { 'subscription-userinfo': 'download=100; total=1000' },
};
async function setup() {
  let stored: string | null = null;
  const store = {
    read: async () => stored,
    write: jest.fn(async (_name: string, content: string) => {
      stored = content;
    }),
  };
  const initial = () => ({
    ...createDefaultConfig('fixture'),
    subscriptions: [
      {
        id: 'group',
        name: 'Fixture',
        url: 'https://example.com/subscription',
        autoUpdate: true,
        createdAt: new Date().toISOString(),
      },
    ],
  });
  const repo = new ConfigRepository(store, initial, () => {});
  await repo.read();
  const host: HostTextTransport = {
    requestText: jest.fn(async () => response),
    cancelRequest: jest.fn(async () => {}),
  };
  const after = jest.fn(async () => {});
  const manager = new PortableSubscriptionManager(repo, host, async () => true, after);
  return {
    repo,
    store,
    host,
    manager,
    after,
    reopen: () => new ConfigRepository(store, initial, () => {}),
  };
}
test('concurrent manual and automatic synchronization share one request, durable commit and group lifecycle', async () => {
  const { host, manager, after, reopen } = await setup();
  await Promise.all([manager.sync('group'), manager.sync('group')]);
  expect(host.requestText).toHaveBeenCalledTimes(1);
  expect(after).toHaveBeenCalledTimes(1);
  expect(after).toHaveBeenCalledWith('group', true);
  const saved = await reopen().read();
  expect(saved.servers).toHaveLength(1);
  expect(saved.servers[0]).toMatchObject({
    subscriptionId: 'group',
    protocol: 'vless',
    network: 'ws',
    wsSettings: { path: '/fixture' },
  });
  expect(saved.subscriptions![0].userInfo).toMatchObject({ download: 100, total: 1000 });
});
test('deleted groups cannot be resurrected by a late response', async () => {
  const { host, manager, repo, after } = await setup();
  let finish!: (result: HostTextResponse) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  host.requestText = jest.fn(() => {
    began();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = manager.sync('group');
  await started;
  await repo.update((config) => {
    config.subscriptions = [];
  });
  finish(response);
  await expect(pending).rejects.toThrow('changed');
  expect((await repo.read()).servers).toEqual([]);
  expect(after).not.toHaveBeenCalled();
});
test('failed durable write preserves prior configuration and does not start post-commit work', async () => {
  const { manager, store, repo, after } = await setup();
  const before = await repo.read();
  store.write.mockRejectedValueOnce(new Error('disk full'));
  await expect(manager.sync('group')).rejects.toThrow('disk full');
  expect(await repo.read()).toEqual(before);
  expect(after).not.toHaveBeenCalled();
});
test('network failures retry the current network once while TLS failures retain their original failure', async () => {
  const { manager, host } = await setup();
  const request = jest.mocked(host.requestText);
  request.mockRejectedValueOnce(
    Object.assign(new Error('offline'), { code: 'HTTP_REQUEST_FAILED' })
  );
  await manager.sync('group');
  expect(request.mock.calls.map(([value]) => value.route)).toEqual(['direct', 'current']);
  request.mockClear();
  request.mockRejectedValueOnce(
    Object.assign(new Error('TLS rejected'), { code: 'HTTP_TLS_FAILED' })
  );
  await expect(manager.sync('group')).rejects.toThrow('TLS rejected');
  expect(request).toHaveBeenCalledTimes(1);
});

test('preview detects real protocols without persisting or scheduling measurement work', async () => {
  const { manager, store, host, after } = await setup();
  const writes = store.write.mock.calls.length;
  const results = await Promise.all([
    manager.preview('https://example.com/new'),
    manager.preview('https://example.com/new'),
  ]);
  expect(results[0]).toMatchObject({
    ok: true,
    nodeCount: 1,
    protocols: [{ protocol: 'vless', count: 1 }],
  });
  expect(host.requestText).toHaveBeenCalledTimes(1);
  expect(store.write).toHaveBeenCalledTimes(writes);
  expect(after).not.toHaveBeenCalled();
});
test('preview exposes HTTP classification without returning the credential-bearing URL', async () => {
  const { manager, host } = await setup();
  jest.mocked(host.requestText).mockResolvedValueOnce({ ...response, status: 403 });
  expect(await manager.preview('https://example.com/new?token=fictional')).toEqual({
    ok: false,
    errorKind: 'http',
    httpStatus: 403,
  });
});
