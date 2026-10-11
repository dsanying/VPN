import { PortableNodeMeasurements, type PortableNodeProbe } from '../portable-node-measurements';
import { ConfigRepository } from '../config-repository';
import { createDefaultConfig } from '../config-defaults';
import type { ServerConfig } from '../types';
const node = (id: string): ServerConfig => ({
  id,
  name: id,
  address: 'example.com',
  port: 443,
  protocol: 'vless',
  uuid: '00000000-0000-4000-8000-000000000001',
});
const result = {
  latency: 40,
  testedAt: 1000,
  detail: {
    entry: { status: 'ok' as const, latencyMs: 12 },
    proxyTarget: 'https://www.gstatic.com/generate_204',
  },
};
function fixture(probe: PortableNodeProbe, count = 3, concurrency = 2) {
  const docs = new Map<string, string>();
  const store = {
    read: async (name: string) => docs.get(name) ?? null,
    write: jest.fn(async (name: string, content: string) => {
      docs.set(name, content);
    }),
  };
  const repository = new ConfigRepository(
    store,
    () => ({
      ...createDefaultConfig('fixture'),
      servers: Array.from({ length: count }, (_, id) => node(String(id))),
      selectedServerId: '0',
    }),
    () => undefined
  );
  const events = { progress: jest.fn(), result: jest.fn() };
  const hash = async (value: string) =>
    require('crypto').createHash('sha256').update(value).digest('hex') as string;
  return {
    repository,
    store,
    docs,
    events,
    measurements: new PortableNodeMeasurements(repository, store, probe, events, hash, concurrency),
    hash,
  };
}
test('bounded workers perform exact-node requests and reopen their persisted results', async () => {
  let active = 0,
    peak = 0;
  const measure = jest.fn(async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return result;
  });
  const f = fixture({ measure });
  expect((await f.measurements.test()).outcome).toBe('completed');
  expect(peak).toBeLessThanOrEqual(2);
  expect(measure).toHaveBeenCalledTimes(3);
  expect(f.events.result).toHaveBeenCalledTimes(3);
  const reopened = new PortableNodeMeasurements(
    f.repository,
    f.store,
    { measure },
    f.events,
    f.hash
  );
  expect(Object.keys(await reopened.read())).toEqual(['0', '1', '2']);
  expect(measure).toHaveBeenCalledTimes(3);
});
test('late results from replaced transports cannot be saved or emitted', async () => {
  let complete!: (value: typeof result) => void, started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = fixture(
    {
      measure: () => {
        started();
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    },
    1
  );
  const task = f.measurements.test();
  await running;
  await f.repository.update((config) => {
    config.servers[0].port = 8443;
  });
  complete(result);
  expect((await task).outcome).toBe('interrupted');
  expect(await f.measurements.read()).toEqual({});
  expect(f.events.result).not.toHaveBeenCalled();
});
test('storage failure and invalid native results never become a failed-node latency', async () => {
  const f = fixture({ measure: async () => result }, 1);
  await f.repository.read();
  f.store.write.mockRejectedValueOnce(new Error('disk full'));
  expect((await f.measurements.test()).results).toEqual({});
  expect(f.events.result).not.toHaveBeenCalled();
  const bad = fixture({ measure: async () => ({ ...result, latency: Number.NaN }) }, 1);
  expect((await bad.measurements.test()).outcome).toBe('interrupted');
  expect(await bad.measurements.read()).toEqual({});
});
test('cancelled probes cannot persist even if the native callback arrives later', async () => {
  let complete!: (value: typeof result) => void, started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = fixture(
    {
      measure: () => {
        started();
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    },
    1
  );
  const task = f.measurements.test();
  await running;
  f.measurements.close();
  complete(result);
  expect((await task).outcome).toBe('interrupted');
  expect(await f.measurements.read()).toEqual({});
});
test('read does not probe and deletion removes orphaned saved results', async () => {
  const measure = jest.fn(async () => result);
  const f = fixture({ measure }, 1);
  await f.measurements.read();
  expect(measure).not.toHaveBeenCalled();
  await f.measurements.test();
  await f.repository.update((config) => {
    config.servers = [];
    config.selectedServerId = null;
  });
  expect(await f.measurements.read()).toEqual({});
  expect(JSON.parse(f.docs.get('node-measurements')!).records).toEqual({});
});

test('detached views cannot fail committed probes or prevent remaining workers', async () => {
  const f = fixture({ measure: async () => result });
  f.events.progress.mockImplementation(() => {
    throw new Error('view detached');
  });
  f.events.result.mockImplementation(() => {
    throw new Error('view detached');
  });
  const outcome = await f.measurements.test();
  expect(outcome.outcome).toBe('completed');
  expect(Object.keys(outcome.results)).toHaveLength(3);
  expect(Object.keys(await f.measurements.read())).toHaveLength(3);
});
test('a worker config read failure is isolated and the batch settles all workers', async () => {
  const f = fixture({ measure: async () => result });
  await f.repository.read();
  const read = jest.spyOn(f.repository, 'read');
  read.mockImplementationOnce(() =>
    Promise.resolve({
      ...createDefaultConfig('fixture'),
      servers: [node('0'), node('1'), node('2')],
    })
  );
  read.mockRejectedValueOnce(new Error('storage unavailable'));
  const outcome = await f.measurements.test();
  expect(outcome.outcome).toBe('interrupted');
  expect(f.events.progress.mock.calls.at(-1)?.[0].active).toBe(false);
  expect(Object.keys(outcome.results)).toHaveLength(2);
});
