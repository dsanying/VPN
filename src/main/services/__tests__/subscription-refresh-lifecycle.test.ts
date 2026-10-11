jest.mock('electron', () => ({ dialog: {}, app: { getPath: () => '/tmp' } }));
jest.mock('../../ipc/ipc-handler', () => ({ registerIpcHandler: jest.fn() }));
jest.mock('../../ipc/ipc-events', () => ({ ipcEventEmitter: { sendToAll: jest.fn() } }));
jest.mock('../SubscriptionService', () => ({ SubscriptionService: {} }));
import {
  registerSubscriptionHandlers,
  getSubscriptionSynchronizer,
} from '../../ipc/handlers/subscription-handlers';
import { measurementRefreshEvents } from '../measurement-refresh';
import type { UserConfig } from '../../../shared/types';
import { registerIpcHandler } from '../../ipc/ipc-handler';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
const initial = () =>
  ({
    servers: [],
    subscriptions: [{ id: 's1', name: 'A', url: 'https://example.com/a' }],
  }) as unknown as UserConfig;
it('automatic and manual subscription synchronization share one request; a renamed group save requests the full lifecycle', async () => {
  let config = initial();
  const manager = {
    loadConfig: async () => config,
    saveConfig: jest.fn(async (next) => {
      config = next;
    }),
  };
  let finish!: (value: { notModified: true }) => void;
  const fetchSubscription = jest.fn(
    () =>
      new Promise<{ notModified: true }>((resolve) => {
        finish = resolve;
      })
  );
  const refresh = jest.fn();
  measurementRefreshEvents.on('refresh', refresh);
  try {
    registerSubscriptionHandlers({ fetchSubscription } as never, manager as never);
    const synchronize = getSubscriptionSynchronizer(manager as never)!;
    const a = synchronize('s1');
    const b = synchronize('s1');
    await new Promise((resolve) => setImmediate(resolve));
    finish({ notModified: true });
    expect((await a).unchanged).toBe(true);
    expect((await b).unchanged).toBe(true);
    expect(fetchSubscription).toHaveBeenCalledTimes(1);
    const update = jest
      .mocked(registerIpcHandler)
      .mock.calls.find(([channel]) => channel === IPC_CHANNELS.SUBSCRIPTION_UPDATE)![1];
    await update({} as never, { subscription: { ...config.subscriptions![0], name: 'Renamed' } });
    expect(refresh).toHaveBeenCalledWith(manager, { syncGroupIds: ['s1'], groupIds: ['s1'] });
  } finally {
    measurementRefreshEvents.removeAllListeners();
  }
});
it('an in-flight response cannot restore a deleted or edited subscription; unrelated edits survive a 304 response', async () => {
  let config = initial();
  const manager = {
    loadConfig: async () => config,
    saveConfig: jest.fn(async (next) => {
      config = next;
    }),
  };
  let finish!: (value: { notModified: true }) => void;
  const fetchSubscription = jest.fn(
    () =>
      new Promise<{ notModified: true }>((resolve) => {
        finish = resolve;
      })
  );
  registerSubscriptionHandlers({ fetchSubscription } as never, manager as never);
  const synchronize = getSubscriptionSynchronizer(manager as never)!;
  for (const change of ['delete', 'url', 'preference'] as const) {
    config = initial();
    manager.saveConfig.mockClear();
    const pending = synchronize('s1');
    await new Promise((resolve) => setImmediate(resolve));
    if (change === 'delete') config = { ...config, subscriptions: [] };
    if (change === 'url') config.subscriptions![0].url = 'https://example.com/changed';
    if (change === 'preference') config = { ...config, uiTheme: 'dark' };
    finish({ notModified: true });
    const result = await pending;
    expect(result.success).toBe(change === 'preference');
    expect(manager.saveConfig).toHaveBeenCalledTimes(change === 'preference' ? 1 : 0);
    if (change === 'preference') expect(config.uiTheme).toBe('dark');
  }
});

it('parallel group fetches serialize commits and preserve both refreshed groups', async () => {
  let config = initial();
  config.subscriptions!.push({
    ...config.subscriptions![0],
    id: 's2',
    url: 'https://example.com/b',
  });
  const manager = {
    loadConfig: async () => structuredClone(config),
    saveConfig: async (next: UserConfig) => {
      await new Promise((resolve) => setImmediate(resolve));
      config = next;
    },
  };
  registerSubscriptionHandlers(
    { fetchSubscription: async () => ({ notModified: true }) } as never,
    manager as never
  );
  const synchronize = getSubscriptionSynchronizer(manager as never)!;
  await Promise.all([synchronize('s1'), synchronize('s2')]);
  expect(config.subscriptions!.every((s) => !!s.lastUpdated)).toBe(true);
});
it('the unified update can prepare a changed group without restarting the active core', async () => {
  const { SubscriptionService } = require('../SubscriptionService');
  const node = {
    id: 'a',
    name: 'A',
    protocol: 'vless',
    address: 'example.com',
    port: 443,
    subscriptionId: 's1',
  };
  SubscriptionService.reconcileServers = () => ({
    servers: [node],
    added: 1,
    updated: 0,
    deleted: 0,
    deletedIds: new Set(),
    contentChanged: true,
  });
  let config = initial();
  const manager = {
    loadConfig: async () => config,
    saveConfig: async (next: UserConfig) => {
      config = next;
    },
  };
  const apply = jest.fn();
  registerSubscriptionHandlers(
    { fetchSubscription: async () => ({ servers: [node] }) } as never,
    manager as never,
    apply
  );
  const result = await getSubscriptionSynchronizer(manager as never)!('s1', { prepareOnly: true });
  expect(result.addedServers).toBe(1);
  expect(apply).not.toHaveBeenCalled();
  expect(config.servers).toHaveLength(1);
});
