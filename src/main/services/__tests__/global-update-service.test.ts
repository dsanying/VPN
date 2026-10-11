import { GlobalUpdateService } from '../GlobalUpdateService';
import type { GlobalUpdateItem, UpdateKind } from '../../../shared/global-update';
const kinds: UpdateKind[] = ['software', 'core', 'data', 'subscriptions'];
function fixture() {
  const prepare = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      jest.fn(async (): Promise<GlobalUpdateItem> => ({ kind, status: 'latest' })),
    ])
  ) as Record<UpdateKind, jest.Mock<Promise<GlobalUpdateItem>>>;
  let receipt: string | null = null;
  const store = {
    read: jest.fn(async () => receipt),
    write: jest.fn(async (_name: string, content: string) => {
      receipt = content;
    }),
  };
  const maintenanceError = jest.fn();
  const apply = jest.fn(async () => {});
  const publish = jest.fn();
  return {
    store,
    maintenanceError,
    prepare,
    apply,
    publish,
    service: new GlobalUpdateService({ store, maintenanceError, prepare, apply, publish }),
  };
}
it('one startup and six-hour clock serve all update types and stop cancels both', async () => {
  jest.useFakeTimers();
  try {
    const { service, prepare } = fixture();
    service.start();
    service.start();
    await jest.advanceTimersByTimeAsync(30_000);
    for (const kind of kinds) expect(prepare[kind]).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(6 * 60 * 60_000);
    for (const kind of kinds) expect(prepare[kind]).toHaveBeenCalledTimes(2);
    service.stop();
    await jest.advanceTimersByTimeAsync(12 * 60 * 60_000);
    for (const kind of kinds) expect(prepare[kind]).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
it('concurrent maintenance checks share preparation, resolve settled status and never apply a restart update', async () => {
  const { service, prepare, apply } = fixture();
  prepare.core.mockResolvedValue({
    kind: 'core',
    status: 'ready',
    version: '1.13.9',
    restart: 'proxy',
  });
  const [one, two] = await Promise.all([service.check(), service.check()]);
  expect(one).toEqual(two);
  expect(one.checking).toBe(false);
  expect(prepare.core).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
  await service.apply('core');
  expect(apply).toHaveBeenCalledWith('core');
  expect(service.getSnapshot().items.find((item) => item.kind === 'core')?.status).toBe('applied');
});
it('a failed recheck preserves prepared updates and does not block unrelated checks', async () => {
  const { service, prepare } = fixture();
  prepare.core.mockResolvedValue({
    kind: 'core',
    status: 'ready',
    version: '1.13.9',
    restart: 'proxy',
  });
  await service.check();
  prepare.core.mockRejectedValue(new Error('offline'));
  const snapshot = await service.check();
  expect(snapshot.items.find((item) => item.kind === 'core')).toMatchObject({
    status: 'ready',
    version: '1.13.9',
    error: 'offline',
  });
  expect(snapshot.items.find((item) => item.kind === 'subscriptions')?.status).toBe('latest');
});
it('failed apply keeps the update ready and snapshots cannot mutate service state', async () => {
  const { service, prepare, apply } = fixture();
  prepare.data.mockResolvedValue({ kind: 'data', status: 'ready', restart: 'proxy' });
  await service.check();
  apply.mockRejectedValue(new Error('restart failed'));
  await expect(service.apply('data')).rejects.toThrow('restart failed');
  const snapshot = service.getSnapshot();
  snapshot.items.length = 0;
  expect(service.getSnapshot().items.find((item) => item.kind === 'data')?.status).toBe('ready');
  await expect(service.apply('software')).rejects.toThrow('No prepared update');
});

it('applying prepared proxy changes does not turn a failed check into an applied update', async () => {
  const { service, prepare } = fixture();
  prepare.core.mockResolvedValue({ kind: 'core', status: 'ready', restart: 'proxy' });
  prepare.subscriptions.mockRejectedValue(new Error('offline'));
  await service.check();
  service.markApplied(['core', 'subscriptions']);
  expect(service.getSnapshot().items.find((item) => item.kind === 'core')?.status).toBe('applied');
  expect(service.getSnapshot().items.find((item) => item.kind === 'subscriptions')).toMatchObject({
    status: 'error',
    error: 'offline',
  });
});

it('subscription lane overlaps artifact work, artifacts remain serial, measurements run only after all sources settle', async () => {
  const deps = fixture();
  const order: string[] = [];
  let finish!: () => void;
  deps.prepare.software.mockImplementation(async () => {
    order.push('software');
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { kind: 'software', status: 'latest' };
  });
  deps.prepare.subscriptions.mockImplementation(async () => {
    order.push('subscriptions');
    return { kind: 'subscriptions', status: 'latest' };
  });
  deps.prepare.core.mockImplementation(async () => {
    order.push('core');
    return { kind: 'core', status: 'latest' };
  });
  deps.prepare.data.mockImplementation(async () => {
    order.push('data');
    return { kind: 'data', status: 'latest' };
  });
  const service = new GlobalUpdateService({
    ...deps,
    refreshMeasurements: async () => {
      order.push('measurements');
    },
  });
  const check = service.check();
  expect(order).toEqual(['software', 'subscriptions']);
  finish();
  await check;
  expect(order).toEqual(['software', 'subscriptions', 'core', 'data', 'measurements']);
});

it('manual version checks never synchronize subscriptions, data or measurements', async () => {
  const deps = fixture();
  const refreshMeasurements = jest.fn(async () => {});
  const service = new GlobalUpdateService({ ...deps, refreshMeasurements });
  const [one, two] = await Promise.all([service.checkVersions(), service.checkVersions()]);
  expect(one).toEqual(two);
  expect(one.checking).toBe(false);
  expect(deps.prepare.software).toHaveBeenCalledTimes(1);
  expect(deps.prepare.core).toHaveBeenCalledTimes(1);
  expect(deps.prepare.data).not.toHaveBeenCalled();
  expect(deps.prepare.subscriptions).not.toHaveBeenCalled();
  expect(refreshMeasurements).not.toHaveBeenCalled();
  expect(deps.apply).not.toHaveBeenCalled();
});

it('manual checks share an active version flight but do not wait for subscription maintenance', async () => {
  const deps = fixture();
  let finish!: () => void;
  deps.prepare.subscriptions.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { kind: 'subscriptions', status: 'latest' };
  });
  const maintenance = deps.service.check();
  await deps.service.checkVersions();
  expect(deps.prepare.core).toHaveBeenCalledTimes(1);
  expect(deps.service.getSnapshot().checking).toBe(true);
  finish();
  await maintenance;
  expect(deps.service.getSnapshot().checking).toBe(false);
});

it('relaunch uses the saved deadline instead of running another startup refresh', async () => {
  jest.useFakeTimers();
  const f = fixture();
  const second = new GlobalUpdateService(f);
  try {
    f.service.start();
    await jest.advanceTimersByTimeAsync(30_000);
    f.service.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    second.start();
    await jest.advanceTimersByTimeAsync(30_000);
    for (const kind of kinds) expect(f.prepare[kind]).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(6 * 60 * 60_000 - 90_000);
    for (const kind of kinds) expect(f.prepare[kind]).toHaveBeenCalledTimes(2);
  } finally {
    f.service.stop();
    second.stop();
    jest.useRealTimers();
  }
});

it('manual version checks neither read nor move the maintenance deadline', async () => {
  const f = fixture();
  await f.service.checkVersions();
  expect(f.store.read).not.toHaveBeenCalled();
  expect(f.store.write).not.toHaveBeenCalled();
});

it('stopping during durable startup read prevents new network work and rearming', async () => {
  jest.useFakeTimers();
  const f = fixture();
  let release!: (value: string | null) => void;
  f.store.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  try {
    f.service.start();
    await jest.advanceTimersByTimeAsync(30_000);
    f.service.stop();
    release(null);
    await jest.advanceTimersByTimeAsync(12 * 60 * 60_000);
    for (const kind of kinds) expect(f.prepare[kind]).not.toHaveBeenCalled();
    expect(f.store.write).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    f.service.stop();
    jest.useRealTimers();
  }
});
