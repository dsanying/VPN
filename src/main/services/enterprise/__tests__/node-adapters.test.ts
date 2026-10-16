import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EnterpriseVpnService } from '../EnterpriseVpnService';
import { EnterpriseProfileStore } from '../EnterpriseProfileStore';
import { LocalSecretCodec } from '../LocalSecretCodec';
import { EnterpriseDiscovery } from '../EnterpriseDiscovery';
import { EnterpriseEngine } from '../EnterpriseEngine';
import { createDefaultConfig } from '../../../../shared/config-defaults';
import type { UserConfig } from '../../../../shared/types';
const ordinary = {
  id: 'ordinary',
  name: 'Default',
  protocol: 'socks' as const,
  address: 'example.com',
  port: 1080,
};
function setup(exitBeforeReady = false) {
  const dir = mkdtempSync(join(tmpdir(), 'enterprise-adapters-'));
  const store = new EnterpriseProfileStore(join(dir, 'db'), new LocalSecretCodec(join(dir, 'key')));
  const gateway = 'https://example.com/';
  const identity = store.save(
    { gateway, username: 'fictional', password: 'fictional' },
    { gateway, protocol: 'anyconnect', authentication: 'password' }
  );
  let config: UserConfig = {
    ...createDefaultConfig('test'),
    proxyMode: 'smart',
    servers: [ordinary],
    selectedServerId: ordinary.id,
  };
  const engines: {
    start: jest.Mock;
    stop: jest.Mock;
    respond: jest.Mock;
    checkHealth: jest.Mock;
    exit?: () => void;
  }[] = [];
  let adapter: Parameters<
    ConstructorParameters<typeof EnterpriseVpnService>[3]['setNodeAdapters']
  >[0];
  const proxy = {
    stop: jest.fn(async () => {
      await adapter.stop();
    }),
    setNodeAdapters: (value: typeof adapter) => {
      adapter = value;
    },
  };
  const service = new EnterpriseVpnService(
    store,
    new EnterpriseDiscovery(),
    () => {
      const engine = {
        start: jest.fn(async (_p, _challenge, exit) => {
          engine.exit = exit;
          if (exitBeforeReady) exit();
          return {
            port: 20000 + engines.length,
            username: 'ephemeral',
            password: 'ephemeral',
            availability: 'available' as const,
          };
        }),
        stop: jest.fn(async () => {}),
        respond: jest.fn(),
        checkHealth: jest.fn(async () => 'available'),
        exit: undefined as (() => void) | undefined,
      };
      engines.push(engine);
      return engine as unknown as EnterpriseEngine;
    },
    proxy,
    {
      loadConfig: async () => structuredClone(config),
      saveConfig: async (value) => {
        config = value;
      },
    },
    () => {}
  );
  return {
    identity,
    service,
    engines,
    proxy,
    getConfig: () => config,
    close: async () => {
      await service.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('migrates once to ordinary nodes; an unselected explicit rule owns its own authenticated outbound', async () => {
  const f = setup();
  try {
    await f.service.initialize();
    await f.service.initialize();
    const c = f.getConfig();
    expect(c.servers).toHaveLength(2);
    expect(JSON.stringify(c)).not.toContain('fictional');
    expect(await f.service.prepare(c)).toBe(true);
    expect(f.engines).toHaveLength(1);
    c.customRules = [
      {
        id: 'route',
        enabled: true,
        type: 'domain',
        values: ['private.example.com'],
        action: 'proxy',
        targetServerId: f.identity.id,
      },
    ];
    const before = structuredClone(c);
    expect(await f.service.prepare(c)).toBe(false);
    const runtime = f.service.project(c);
    expect(c).toEqual(before);
    expect(runtime.selectedServerId).toBe('ordinary');
    expect(runtime.customRules).toEqual(before.customRules);
    expect(runtime.servers.find((s) => s.id === f.identity.id)).toMatchObject({
      protocol: 'socks',
      address: '127.0.0.1',
      port: 20001,
    });
    f.engines[0].start.mock.calls[0][3]('建立隧道');
    expect(f.service.snapshot().sessions?.[0]?.state).toBe('connected');
    expect(await f.service.prepare(c)).toBe(false);
    expect(f.engines[0].start).toHaveBeenCalledTimes(1);
    await f.service.disconnect();
    expect(f.engines[0].stop).toHaveBeenCalledTimes(1);
    expect(f.service.project(c).servers.some((s) => s.id === f.identity.id)).toBe(false);
  } finally {
    await f.close();
  }
});
test('global/direct ignore inactive rules; tunnel loss closes the global proxy', async () => {
  const f = setup();
  try {
    await f.service.initialize();
    const c = f.getConfig();
    c.proxyMode = 'global';
    c.customRules = [
      {
        id: 'rule',
        enabled: true,
        type: 'domain',
        values: ['private.example.com'],
        action: 'proxy',
        targetServerId: f.identity.id,
      },
    ];
    await f.service.prepare(c);
    expect(f.engines).toHaveLength(0);
    c.selectedServerId = f.identity.id;
    await f.service.prepare(c);
    f.engines[0].exit!();
    await Promise.resolve();
    expect(f.proxy.stop).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot().sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: 'failed' })])
    );
    c.proxyMode = 'direct';
    await f.service.prepare(c);
    expect(f.service.project(c).selectedServerId).toBe('__direct__');
  } finally {
    await f.close();
  }
});

test('a bridge exiting before activation cannot become a connected outbound', async () => {
  const f = setup(true);
  try {
    await f.service.initialize();
    const c = f.getConfig();
    c.selectedServerId = f.identity.id;
    await expect(f.service.prepare(c)).rejects.toThrow('启动过程中已中断');
    expect(f.service.snapshot().sessions?.[0]?.state).toBe('failed');
    expect(f.service.project(c).servers.some((s) => s.id === f.identity.id)).toBe(false);
  } finally {
    await f.close();
  }
});

test('measurement checks a private tunnel and never synthesizes a proxy latency or changes selection', async () => {
  const f = setup();
  try {
    await f.service.initialize();
    const c = structuredClone(f.getConfig());
    const node = c.servers.find((n) => n.protocol === 'enterprise')!;
    expect(await f.service.measure(node)).toEqual({
      availability: 'available',
      proxyReason: 'enterprise-target-unsupported',
    });
    expect(f.engines[0].stop).toHaveBeenCalledTimes(1);
    expect(f.service.project(c).servers.some((n) => n.id === node.id)).toBe(false);
    expect(f.getConfig()).toEqual(c);
  } finally {
    await f.close();
  }
});
test('smart mode appends gateway-owned resources after user rules only in the runtime projection', async () => {
  const f = setup();
  try {
    await f.service.initialize();
    const c = f.getConfig();
    c.customRules = [
      {
        id: 'user',
        enabled: true,
        type: 'domain',
        values: ['private.example.com'],
        action: 'direct',
      },
    ];
    await f.service.prepare(c);
    const active = f.engines[0];
    await f.service.disconnect();
    const original = active.start.mock.calls[0];
    active.start.mockClear();
    // The next engine advertises resources, with no inference from the gateway host.
    const maker = f.service as unknown as { createEngine: () => EnterpriseEngine };
    maker.createEngine = () =>
      ({
        start: async () => ({
          port: 22000,
          username: 'ephemeral',
          password: 'ephemeral',
          resources: { domains: ['private.example.com'], cidrs: ['10.4.0.0/16'] },
        }),
        stop: async () => {},
      }) as unknown as EnterpriseEngine;
    expect(original[0].gateway).toBe('https://example.com/');
    await f.service.prepare(c);
    const runtime = f.service.project(c);
    expect(runtime.customRules[0]).toEqual(c.customRules[0]);
    expect(runtime.customRules.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'domain',
          values: ['private.example.com'],
          targetServerId: f.identity.id,
        }),
        expect.objectContaining({
          type: 'ipCidr',
          values: ['10.4.0.0/16'],
          targetServerId: f.identity.id,
        }),
      ])
    );
    expect(c.customRules).toHaveLength(1);
    c.proxyMode = 'global';
    expect(f.service.project(c).customRules).toEqual(c.customRules);
  } finally {
    await f.close();
  }
});

test('active tunnel checks refresh forwarding evidence without authentication or interruption', async () => {
  const f = setup();
  try {
    await f.service.initialize();
    const c = f.getConfig();
    await f.service.prepare(c);
    const node = c.servers.find((n) => n.protocol === 'enterprise')!;
    expect((await f.service.measure(node)).availability).toBe('available');
    expect(f.engines).toHaveLength(1);
    expect(f.engines[0].start).toHaveBeenCalledTimes(1);
    expect(f.engines[0].checkHealth).toHaveBeenCalledTimes(1);
    expect(f.engines[0].stop).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
