import { ConfigRepository, type ConfigDocumentStore } from '../config-repository';
import { createDefaultConfig } from '../config-defaults';
import { clearRetiredConfigData } from '../retired-config-data';

function setup(content: string | null = null) {
  let persisted = content;
  const store: ConfigDocumentStore = {
    read: jest.fn(async () => persisted),
    write: jest.fn(async (_name, value) => {
      persisted = value;
    }),
  };
  const seed = () => createDefaultConfig('0123456789abcdef0123456789abcdef');
  const repo = () => new ConfigRepository(store, seed, clearRetiredConfigData);
  return { store, repo: repo(), reopen: repo, persisted: () => persisted };
}

test('parallel first reads create one installation and copies cannot mutate stored data', async () => {
  const { store, repo, reopen } = setup();
  const [one, two] = await Promise.all([repo.read(), repo.read()]);
  one.language = 'en-US';
  expect(two.language).toBe('auto');
  expect(store.write).toHaveBeenCalledTimes(1);
  expect((await reopen().read()).language).toBe('auto');
});

test('concurrent changes preserve both edits and survive reopening the database', async () => {
  const { repo, reopen } = setup();
  await Promise.all([
    repo.update((config) => {
      config.autoConnect = true;
    }),
    repo.update((config) => {
      config.proxyMode = 'smart';
    }),
  ]);
  expect(await reopen().read()).toMatchObject({ autoConnect: true, proxyMode: 'smart' });
});

test('failed write preserves last data and emits nothing; a later change can recover', async () => {
  const { repo, store, reopen } = setup();
  await repo.read();
  const listener = jest.fn();
  repo.subscribe(listener);
  jest.mocked(store.write).mockRejectedValueOnce(new Error('disk full'));
  await expect(
    repo.update((config) => {
      config.autoConnect = true;
    })
  ).rejects.toThrow('disk full');
  expect(listener).not.toHaveBeenCalled();
  expect((await reopen().read()).autoConnect).toBe(false);
  await repo.update((config) => {
    config.autoConnect = true;
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect((await reopen().read()).autoConnect).toBe(true);
});

test.each([
  '{',
  JSON.stringify({ schema: 99, value: {} }),
  JSON.stringify({ schema: 1, value: {} }),
])('invalid or future-schema data is never overwritten: %s', async (content) => {
  const { repo, store, persisted } = setup(content);
  await expect(repo.read()).rejects.toThrow();
  expect(store.write).not.toHaveBeenCalled();
  expect(persisted()).toBe(content);
});

test('migration removes retired fields durably while preserving unknown supplier fields', async () => {
  const config = {
    ...createDefaultConfig('fake-secret'),
    logLevel: 'debug',
    vendorField: { enabled: true },
  };
  const { repo, reopen } = setup(JSON.stringify({ schema: 1, value: config }));
  expect(await repo.read()).not.toHaveProperty('logLevel');
  expect(await reopen().read()).toHaveProperty('vendorField', { enabled: true });
});

test('reject dangling selection and bad mode before write; unsubscribe is precise', async () => {
  const { repo, store } = setup();
  await repo.read();
  jest.mocked(store.write).mockClear();
  await expect(
    repo.update((config) => {
      config.selectedServerId = 'deleted';
    })
  ).rejects.toThrow('Selected server');
  await expect(
    repo.update((config) => {
      config.proxyMode = 'invalid' as never;
    })
  ).rejects.toThrow('routing mode');
  expect(store.write).not.toHaveBeenCalled();
  const first = jest.fn(),
    second = jest.fn();
  repo.subscribe(first)();
  repo.subscribe(second);
  await repo.update((config) => {
    config.language = 'en-US';
  });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

test('global direct selection remains valid through storage and reopening, without a fake node', async () => {
  const { repo, reopen } = setup();
  await repo.update((config) => {
    config.selectedServerId = '__direct__';
  });
  expect((await reopen().read()).selectedServerId).toBe('__direct__');
  expect((await repo.read()).servers).toEqual([]);
});

test('canonical port migration is durable and retired fields never return after reopening', async () => {
  const config = {
    ...createDefaultConfig('fake-secret'),
    mixedPort: undefined,
    httpPort: 4567,
    socksPort: 4568,
    remoteInstances: [{ secret: 'fictional-secret' }],
  };
  const { repo, reopen, store } = setup(JSON.stringify({ schema: 1, value: config }));
  const migrated = await repo.read();
  expect(migrated.mixedPort).toBe(4567);
  expect(migrated).not.toHaveProperty('httpPort');
  expect(migrated).not.toHaveProperty('socksPort');
  expect(migrated).not.toHaveProperty('remoteInstances');
  expect(store.write).toHaveBeenCalledTimes(1);
  expect((await reopen().read()).mixedPort).toBe(4567);
  expect(store.write).toHaveBeenCalledTimes(1);
});

test('canonical validation failures do not replace valid database content', async () => {
  const { repo, store, persisted } = setup();
  await repo.read();
  const before = persisted();
  jest.mocked(store.write).mockClear();
  await expect(
    repo.update((config) => {
      config.autoConnect = 'invalid' as never;
    })
  ).rejects.toThrow('autoConnect must be a boolean');
  expect(store.write).not.toHaveBeenCalled();
  expect(persisted()).toBe(before);
  expect((await repo.read()).autoConnect).toBe(false);
});
test('a native write conflict invalidates stale cache, emits nothing and rereads the committed configuration', async () => {
  const { repo, store } = setup();
  const initial = await repo.read();
  const changes = jest.fn();
  repo.subscribe(changes);
  const external = structuredClone(initial);
  external.language = 'en-US';
  jest.mocked(store.read).mockResolvedValue(JSON.stringify({ schema: 1, value: external }));
  jest
    .mocked(store.write)
    .mockRejectedValueOnce(
      Object.assign(new Error('configuration conflict'), { code: 'CONFIG_WRITE_CONFLICT' })
    );
  await expect(
    repo.update((config) => {
      config.autoConnect = true;
    })
  ).rejects.toThrow('conflict');
  expect(changes).not.toHaveBeenCalled();
  expect(await repo.read()).toMatchObject({ language: 'en-US', autoConnect: false });
  await repo.update((config) => {
    config.autoConnect = true;
  });
  expect(await repo.read()).toMatchObject({ language: 'en-US', autoConnect: true });
});
