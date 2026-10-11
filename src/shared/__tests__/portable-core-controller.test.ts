import {
  PortableCoreController,
  type PortableCorePort,
  type PortableCoreStatus,
} from '../portable-core-controller';
import { ConfigRepository } from '../config-repository';
import { createDefaultConfig } from '../config-defaults';
import { portableSha256 } from '../portable-subscription-measurements';
import { nodeMeasurementIdentity } from '../measurement-identity';

function fixture() {
  let listener: (status: PortableCoreStatus) => void = () => undefined;
  const native: PortableCorePort = {
    status: jest.fn(async () => ({ running: false, busy: false })),
    checkConfig: jest.fn(async () => undefined),
    start: jest.fn(async () => ({ running: true, busy: false })),
    stop: jest.fn(async () => ({ running: false, busy: false })),
    subscribe: jest.fn(async (callback) => {
      listener = callback;
      return jest.fn();
    }),
  };
  const repository = new ConfigRepository(
    { read: async () => null, write: async () => undefined },
    () => createDefaultConfig('secret'),
    () => undefined
  );
  const compile = jest.fn(async (config) => JSON.stringify({ mode: config.proxyMode }));
  const controller = new PortableCoreController(repository, native, compile);
  return {
    controller,
    native,
    compile,
    repository,
    event: (status: PortableCoreStatus) => listener(status),
  };
}
test('native completion serializes start and stop without confirmation reads', async () => {
  const { controller, native } = fixture();
  await Promise.all([controller.start(), controller.stop()]);
  expect(native.status).toHaveBeenCalledTimes(1);
  expect(native.start).toHaveBeenCalledTimes(1);
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().running).toBe(false);
});
test('apply reads the latest durable configuration and skips inactive VPN', async () => {
  const { controller, native, repository } = fixture();
  await controller.applySaved();
  expect(native.start).not.toHaveBeenCalled();
  await controller.start();
  await repository.update((config) => {
    config.proxyMode = 'direct';
  });
  await controller.applySaved();
  expect(native.start).toHaveBeenLastCalledWith({
    config: JSON.stringify({ mode: 'direct' }),
    nodes: {},
  });
});
test('invalid compilation cannot interrupt an existing native tunnel', async () => {
  const { controller, native, compile } = fixture();
  await controller.start();
  compile.mockRejectedValueOnce(new Error('Invalid transport'));
  await expect(controller.applySaved()).rejects.toThrow('Invalid transport');
  expect(native.start).toHaveBeenCalledTimes(1);
  expect(native.stop).not.toHaveBeenCalled();
  expect(controller.snapshot().running).toBe(true);
});
test('event received during initial status read wins over an older snapshot', async () => {
  const { controller, native, event } = fixture();
  jest.mocked(native.status).mockImplementation(async () => {
    event({ running: true, busy: false });
    return { running: false, busy: false };
  });
  await controller.initialize();
  expect(controller.snapshot().running).toBe(true);
});
test('native refusal cannot be presented as successful start', async () => {
  const { controller, native } = fixture();
  jest
    .mocked(native.start)
    .mockResolvedValueOnce({ running: false, busy: false, error: 'Permission denied' });
  await expect(controller.start()).rejects.toThrow('Permission denied');
  expect(controller.snapshot().running).toBe(false);
});
test('closing releases event listeners and refuses queued commands', async () => {
  const { controller, native } = fixture();
  await controller.initialize();
  controller.close();
  await expect(controller.start()).rejects.toThrow('closed');
  expect(native.start).not.toHaveBeenCalled();
});

test('presentation-only saves do not reload an unchanged running engine', async () => {
  const { controller, native, repository } = fixture();
  await controller.start();
  await repository.update((config) => {
    config.uiTheme = 'light';
  });
  await controller.applySaved();
  expect(native.start).toHaveBeenCalledTimes(1);
  expect(native.checkConfig).toHaveBeenCalledTimes(1);
  await repository.update((config) => {
    config.proxyMode = 'direct';
  });
  await controller.applySaved();
  expect(native.start).toHaveBeenCalledTimes(2);
});

test('native applied receipt restores node changes after the renderer is recreated', async () => {
  const { controller, native, repository, compile } = fixture();
  const node = {
    id: 'node-1',
    name: 'Original',
    protocol: 'vless' as const,
    uuid: '00000000-0000-4000-8000-000000000001',
    address: 'example.com',
    port: 443,
  };
  await repository.update((config) => {
    config.servers = [node];
  });
  const saved = await repository.read();
  native.status = jest.fn(async () => ({ running: true, busy: false, startTime: 1 }));
  native.appliedReceipt = jest.fn(async () => ({
    configDigest: await portableSha256(await compile(saved)),
    nodes: { [node.id]: await portableSha256(nodeMeasurementIdentity(node)) },
  }));
  await controller.initialize();
  expect(await controller.pendingNodeChanges()).toEqual({ added: [], modified: [] });
  await controller.applySaved();
  expect(native.start).not.toHaveBeenCalled();
  await repository.update((config) => {
    config.servers[0].name = 'Renamed';
  });
  expect(await controller.pendingNodeChanges()).toEqual({ added: [], modified: [] });
  await repository.update((config) => {
    config.servers[0].port = 8443;
    config.servers.push({ ...node, id: 'node-2' });
  });
  expect(await controller.pendingNodeChanges()).toEqual({
    added: ['node-2'],
    modified: ['node-1'],
  });
  expect(native.status).toHaveBeenCalledTimes(1);
  expect(native.appliedReceipt).toHaveBeenCalledTimes(1);
});

test('a disconnect during receipt restoration cannot resurrect the previous applied tunnel', async () => {
  const { controller, native, event } = fixture();
  native.status = jest.fn(async () => ({ running: true, busy: false }));
  native.appliedReceipt = jest.fn(async () => {
    event({ running: false, busy: false });
    return { configDigest: 'a'.repeat(64), nodes: {} };
  });
  await controller.initialize();
  expect(controller.snapshot().running).toBe(false);
  expect(await controller.pendingNodeChanges()).toEqual({ added: [], modified: [] });
});

test('native completion adopts an external reload receipt without polling or another receipt read', async () => {
  const { controller, native, repository, event } = fixture();
  const node = {
    id: 'external',
    name: 'External',
    protocol: 'vless' as const,
    uuid: '00000000-0000-4000-8000-000000000001',
    address: 'example.com',
    port: 443,
  };
  await repository.update((config) => {
    config.servers = [node];
  });
  await controller.initialize();
  native.appliedReceipt = jest.fn();
  event({
    running: true,
    busy: false,
    startTime: 1,
    appliedReceipt: {
      configDigest: 'a'.repeat(64),
      nodes: { [node.id]: await portableSha256(nodeMeasurementIdentity(node)) },
    },
  });
  expect(await controller.pendingNodeChanges()).toEqual({ added: [], modified: [] });
  await repository.update((config) => {
    config.servers[0].port = 8443;
  });
  expect(await controller.pendingNodeChanges()).toEqual({ added: [], modified: [node.id] });
  event({
    running: true,
    busy: false,
    startTime: 1,
    appliedReceipt: {
      configDigest: 'b'.repeat(64),
      nodes: {
        [node.id]: await portableSha256(
          nodeMeasurementIdentity((await repository.read()).servers[0])
        ),
      },
    },
  });
  expect(await controller.pendingNodeChanges()).toEqual({ added: [], modified: [] });
  expect(native.status).toHaveBeenCalledTimes(1);
  expect(native.appliedReceipt).not.toHaveBeenCalled();
});

test('malformed restored receipts do not fail initialization', async () => {
  const { controller, native } = fixture();
  native.status = jest.fn(async () => ({ running: true, busy: false }));
  native.appliedReceipt = jest.fn(
    async () => ({ configDigest: 'a'.repeat(64), nodes: null }) as never
  );
  await expect(controller.initialize()).resolves.toBeUndefined();
  expect(controller.snapshot().running).toBe(true);
});
