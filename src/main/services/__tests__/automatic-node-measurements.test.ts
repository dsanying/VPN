jest.mock('electron', () => ({ app: { getPath: () => '/tmp' }, net: {} }));
jest.mock('../../ipc/ipc-handler', () => ({ registerIpcHandler: jest.fn() }));
jest.mock('../speed-test-runner', () => ({
  runSpeedTest: jest.fn(async () => ({})),
  getNodeMeasurementStore: jest.fn(() => ({ save: async () => {}, get: async () => ({}) })),
}));
jest.mock('../../ipc/handlers/subscription-handlers', () => ({
  getSubscriptionMeasurements: jest.fn(() => undefined),
  getSubscriptionSynchronizer: jest.fn(() => undefined),
}));
import { registerSpeedTestHandlers } from '../../ipc/handlers/speed-test-handlers';
import { runSpeedTest, getNodeMeasurementStore } from '../speed-test-runner';
import { mainEventEmitter, MAIN_EVENTS } from '../../ipc/main-events';
import {
  measurementRefreshEvents,
  measurementConfigSaved,
  requestMeasurementRefresh,
} from '../measurement-refresh';
import {
  getSubscriptionMeasurements,
  getSubscriptionSynchronizer,
} from '../../ipc/handlers/subscription-handlers';
import type { UserConfig } from '../../../shared/types';
it('initializes missing records once, config changes reconcile missing identities, and no periodic/page polling exists', async () => {
  jest.useFakeTimers();
  const run = jest.mocked(runSpeedTest);
  run.mockClear();
  let records = {};
  jest
    .mocked(getNodeMeasurementStore)
    .mockReturnValue({ save: async () => {}, get: async () => records } as never);
  run.mockImplementation(async () => {
    records = { example: { testedAt: 1 } };
    return {} as never;
  });
  const deps = {
    speedTestService: { enableRegionDetection: jest.fn(), isTesting: () => false },
    configManager: {
      loadConfig: async () => ({
        servers: [{ id: 'example', protocol: 'vless', address: 'example.com', port: 443 }],
        selectedServerId: 'example',
      }),
    },
    logManager: { addLog: jest.fn() },
  } as unknown as Parameters<typeof registerSpeedTestHandlers>[0];
  try {
    const refresh = registerSpeedTestHandlers(deps);
    await refresh();
    expect(run).toHaveBeenCalledTimes(1);
    records = { example: { testedAt: 1 } };
    await jest.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    mainEventEmitter.emit(MAIN_EVENTS.CONFIG_CHANGED);
    await refresh();
    expect(run).toHaveBeenCalledTimes(1);
    await refresh(false);
    expect(run).toHaveBeenCalledTimes(2);
    records = {};
    mainEventEmitter.emit(MAIN_EVENTS.CONFIG_CHANGED);
    await refresh();
    expect(run).toHaveBeenCalledTimes(3);
  } finally {
    mainEventEmitter.removeAllListeners(MAIN_EVENTS.CONFIG_CHANGED);
    measurementRefreshEvents.removeAllListeners();
    jest.useRealTimers();
  }
});

it('saved group changes run sync → connectivity → whole-group probes; fresh unrelated groups are untouched', async () => {
  const config = {
    servers: ['a1', 'a2', 'b1'].map((id) => ({
      id,
      name: id,
      protocol: 'vless',
      address: 'example.com',
      port: 443,
      subscriptionId: id.startsWith('a') ? 's1' : 's2',
    })),
    subscriptions: [
      { id: 's1', name: 'A', url: 'https://example.com/a', lastUpdated: '2026-01-01' },
      { id: 's2', name: 'B', url: 'https://example.com/b', lastUpdated: '2026-01-01' },
    ],
  } as unknown as UserConfig;
  const order: string[] = [];
  const records: Record<string, { testedAt: number }> = Object.fromEntries(
    config.servers.map((n) => [n.id, { testedAt: Date.now() - 100 }])
  );
  const manager = { loadConfig: async () => config };
  const run = jest.mocked(runSpeedTest);
  run.mockClear();
  run.mockImplementation(async (_deps, args) => {
    order.push('nodes');
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const id of args?.serverIds ?? []) records[id] = { testedAt: Date.now() };
    return {} as never;
  });
  jest
    .mocked(getNodeMeasurementStore)
    .mockReturnValue({ save: async () => {}, get: async () => records } as never);
  jest.mocked(getSubscriptionMeasurements).mockReturnValue({
    refresh: async () => {
      order.push('links');
    },
  } as never);
  const sync = jest.fn(async (id: string) => {
    order.push('sync');
    config.subscriptions!.find((s) => s.id === id)!.lastUpdated = new Date().toISOString();
    measurementConfigSaved(manager, config);
    return { success: true };
  });
  jest.mocked(getSubscriptionSynchronizer).mockReturnValue(sync as never);
  const deps = {
    configManager: manager,
    speedTestService: { enableRegionDetection: jest.fn() },
    logManager: { addLog: jest.fn() },
  } as unknown as Parameters<typeof registerSpeedTestHandlers>[0];
  try {
    const refresh = registerSpeedTestHandlers(deps);
    await refresh();
    expect(run).not.toHaveBeenCalled();
    order.length = 0;
    config.subscriptions![0].name = 'Edited';
    measurementConfigSaved(manager, config);
    await refresh();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]?.serverIds).toEqual(['a1', 'a2']);
    expect(order.slice(0, 3)).toEqual(['sync', 'links', 'nodes']);
    config.uiTheme = 'dark';
    measurementConfigSaved(manager, config);
    await refresh();
    expect(run).toHaveBeenCalledTimes(1);
    config.subscriptions![1].lastUpdated = new Date().toISOString();
    measurementConfigSaved(manager, config);
    await refresh();
    expect(run.mock.calls[1][1]?.serverIds).toEqual(['b1']);
    requestMeasurementRefresh(manager, { all: true });
    await refresh();
    expect(run.mock.calls[2][1]?.serverIds).toEqual(['a1', 'a2', 'b1']);
  } finally {
    measurementRefreshEvents.removeAllListeners();
    mainEventEmitter.removeAllListeners(MAIN_EVENTS.CONFIG_CHANGED);
    jest.mocked(getSubscriptionMeasurements).mockReturnValue(undefined);
    jest.mocked(getSubscriptionSynchronizer).mockReturnValue(undefined);
  }
});
