jest.mock('@capacitor/core', () => ({
  registerPlugin: () => {
    throw new Error('Portable service must not initialize the UI bridge');
  },
}));
import { createMobileServiceRuntime as createMobileRuntime } from '../service-runtime';
import type { ShadowVpnNative } from '../native-contract';
import { IPC_CHANNELS as C } from '@shared/ipc-channels';
function fixture() {
  const documents = new Map<string, string>();
  const listeners = new Map<string, (data: any) => void>();
  const remove = jest.fn(async () => undefined);
  const native = {
    readState: jest.fn(async ({ name }: { name: string }) => ({
      content: documents.get(name) ?? null,
      revision: documents.has(name) ? 'fixture-revision' : null,
    })),
    writeState: jest.fn(async ({ name, content }: { name: string; content: string }) => {
      documents.set(name, content);
      return { revision: 'fixture-revision' };
    }),
    capabilities: jest.fn(async () => ({ platform: 'android', vpn: true, connectionOwner: true })),
    status: jest.fn(async () => ({ running: false, busy: false })),
    addListener: jest.fn(async (event, callback) => {
      listeners.set(event, callback);
      return { remove };
    }),
    subscribeCoreEvents: jest.fn(async () => undefined),
    networkContext: jest.fn(async () => ({ identity: 'physical-A' })),
    requestText: jest.fn(async () => ({ status: 200, body: 'ip=192.0.2.1\nloc=US', headers: {} })),
    measureNode: jest.fn(),
    clearLogs: jest.fn(async () => undefined),
    clientInfo: jest.fn(async () => ({ appVersion: 'fixture' })),
    listApplications: jest.fn(async () => ({ applications: [] })),
  };
  return {
    native: native as unknown as ShadowVpnNative,
    facts: native,
    documents,
    listeners,
    remove,
  };
}
test('boot initializes only unknown exit facts; page reads do not sync subscriptions or probe nodes', async () => {
  const f = fixture();
  let settled!: () => void;
  const savedIp = new Promise<void>((resolve) => {
    settled = resolve;
  });
  f.facts.writeState.mockImplementation(async ({ name, content }) => {
    f.documents.set(name, content);
    if (name === 'ip-info') settled();
    return { revision: 'fixture-revision' };
  });
  const runtime = await createMobileRuntime(f.native);
  const initial = await runtime.transport.invoke<any>(C.CONFIG_GET);
  expect(initial.success).toBe(true);
  expect(f.documents.has('config')).toBe(true);
  await runtime.transport.invoke(C.SERVER_MEASUREMENTS);
  await runtime.transport.invoke(C.SUBSCRIPTION_MEASUREMENTS);
  expect(f.facts.measureNode).not.toHaveBeenCalled();
  await savedIp;
  expect(f.facts.requestText).toHaveBeenCalledTimes(1);
  expect(f.facts.requestText).toHaveBeenCalledWith(
    expect.objectContaining({ route: 'direct', url: 'https://cloudflare.com/cdn-cgi/trace' })
  );
  await runtime.transport.invoke(C.IP_INFO_GET, { peek: true });
  expect(f.facts.requestText).toHaveBeenCalledTimes(1);
  expect(await runtime.transport.invoke<any>(C.VERSION_GET_INFO)).toEqual({
    success: true,
    data: { appVersion: 'fixture' },
  });
  await runtime.close();
  expect(f.facts.subscribeCoreEvents).toHaveBeenLastCalledWith({ topics: [] });
  expect(f.remove).toHaveBeenCalledTimes(3);
});
test('real core log events persist sanitized entries before publishing', async () => {
  const f = fixture();
  const runtime = await createMobileRuntime(f.native);
  const seen = new Promise<void>((resolve) =>
    runtime.service.on(C.EVENT_LOG_RECEIVED_BATCH, () => {
      expect(f.documents.get('logs')).not.toContain('fixture-secret');
      resolve();
    })
  );
  f.listeners.get('coreEvent')!({
    topic: 'logs',
    data: [{ level: 2, message: 'password=fixture-secret' }],
  });
  await seen;
  expect(await runtime.transport.invoke<any>(C.LOGS_GET)).toMatchObject({
    success: true,
    data: [{ level: 'error', message: 'password=<redacted>' }],
  });
  await runtime.close();
});
test('failed native event setup closes acquired listeners and rejects bootstrap', async () => {
  const f = fixture();
  f.facts.subscribeCoreEvents.mockRejectedValueOnce(new Error('native'));
  await expect(createMobileRuntime(f.native)).rejects.toThrow('native');
  expect(f.remove).toHaveBeenCalledTimes(3);
});
test('saved launch connection preference invokes the native VPN path once and clears desktop-only state', async () => {
  const f = fixture();
  const { createDefaultConfig } = await import('@shared/config-defaults');
  const saved = createDefaultConfig('fictional-secret');
  Object.assign(saved, {
    proxyMode: 'direct',
    autoConnect: true,
    autoStart: true,
    minimizeToTray: true,
    windowBounds: { width: 800, height: 600 },
  });
  f.documents.set('config', JSON.stringify({ schema: 1, value: saved }));
  const facts = f.native as unknown as Record<string, unknown>;
  facts.coreEnvironment = jest.fn(async () => ({
    stateDirectory: '/data/user/0/com.dsanying.shadowvpn/files/core',
    version: '1.14.3',
  }));
  facts.checkConfig = jest.fn(async () => {});
  let started!: () => void;
  const completed = new Promise<void>((resolve) => {
    started = resolve;
  });
  facts.start = jest.fn(async () => {
    started();
    return { running: true, busy: false, startTime: 1 };
  });
  const runtime = await createMobileRuntime(f.native);
  await completed;
  expect(facts.checkConfig).toHaveBeenCalledTimes(1);
  expect(facts.start).toHaveBeenCalledTimes(1);
  const stored = JSON.parse(f.documents.get('config')!).value;
  expect(stored.autoStart).toBe(false);
  expect(stored.minimizeToTray).toBe(false);
  expect(stored.windowBounds).toBeUndefined();
  expect(stored.rememberWindowSize).toBeUndefined();
  expect(stored.autoConnect).toBe(true);
  await runtime.transport.invoke(C.CONFIG_GET);
  expect(facts.start).toHaveBeenCalledTimes(1);
  await runtime.close();
});

test('system network changes refresh exit facts once; duplicate events and late events do not probe', async () => {
  const f = fixture();
  const runtime = await createMobileRuntime(f.native);
  const waitForIp = () =>
    new Promise<void>((resolve) => {
      const off = runtime.service.on(C.EVENT_IP_INFO_UPDATED, (value: any) => {
        if (!value.loading) {
          off();
          resolve();
        }
      });
    });
  await waitForIp();
  const baseline = f.facts.requestText.mock.calls.length;
  f.listeners.get('networkChanged')!({ identity: 'physical-A' });
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.facts.requestText).toHaveBeenCalledTimes(baseline);
  f.facts.networkContext.mockResolvedValue({ identity: 'physical-B' });
  const updated = waitForIp();
  f.listeners.get('networkChanged')!({ identity: 'physical-B' });
  await updated;
  expect(f.facts.requestText).toHaveBeenCalledTimes(baseline + 1);
  await runtime.close();
  f.listeners.get('networkChanged')!({ identity: 'physical-C' });
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.facts.requestText).toHaveBeenCalledTimes(baseline + 1);
});

test('smart start prepares only the measured physical country and validates its local resource before native start', async () => {
  const f = fixture();
  const { createDefaultConfig } = await import('@shared/config-defaults');
  const saved = createDefaultConfig('fictional-secret');
  saved.proxyMode = 'smart';
  saved.selectedServerId = '__direct__';
  f.documents.set('config', JSON.stringify({ schema: 1, value: saved }));
  const facts = f.native as unknown as Record<string, any>;
  facts.coreEnvironment = jest.fn(async () => ({
    stateDirectory: '/data/user/0/com.dsanying.shadowvpn/files/core',
    version: '1.14.3',
  }));
  facts.prepareCountryRuleSet = jest.fn(async () => ({
    tag: 'geoip-us',
    path: '/data/user/0/com.dsanying.shadowvpn/files/routing-data/geoip-us.srs',
    format: 'binary',
  }));
  facts.checkConfig = jest.fn(async () => {});
  facts.start = jest.fn(async () => ({ running: true, busy: false, startTime: 1 }));
  const runtime = await createMobileRuntime(f.native);
  expect(await runtime.transport.invoke(C.PROXY_START)).toMatchObject({ success: true });
  expect(facts.prepareCountryRuleSet).toHaveBeenCalledWith({ country: 'US' });
  const compiled = JSON.parse(facts.checkConfig.mock.calls[0][0].config);
  expect(compiled.route.rule_set).toContainEqual({
    type: 'local',
    tag: 'geoip-us',
    path: '/data/user/0/com.dsanying.shadowvpn/files/routing-data/geoip-us.srs',
    format: 'binary',
  });
  expect(facts.checkConfig.mock.invocationCallOrder[0]).toBeLessThan(
    facts.start.mock.invocationCallOrder[0]
  );
  await runtime.close();
});

test('unknown physical country blocks smart start instead of assuming a region or reporting success', async () => {
  const f = fixture();
  const { createDefaultConfig } = await import('@shared/config-defaults');
  const saved = createDefaultConfig('fictional-secret');
  saved.proxyMode = 'smart';
  saved.selectedServerId = '__direct__';
  f.documents.set('config', JSON.stringify({ schema: 1, value: saved }));
  f.facts.requestText.mockResolvedValue({ status: 200, body: 'ip=192.0.2.1', headers: {} });
  const facts = f.native as unknown as Record<string, any>;
  facts.coreEnvironment = jest.fn(async () => ({
    stateDirectory: '/data/user/0/com.dsanying.shadowvpn/files/core',
    version: '1.14.3',
  }));
  facts.prepareCountryRuleSet = jest.fn();
  facts.start = jest.fn();
  const runtime = await createMobileRuntime(f.native);
  expect(await runtime.transport.invoke(C.PROXY_START)).toMatchObject({ success: false });
  expect(facts.prepareCountryRuleSet).not.toHaveBeenCalled();
  expect(facts.start).not.toHaveBeenCalled();
  await runtime.close();
});

test('native maintenance persists cadence across runtime recreation; page and version reads never advance it', async () => {
  const f = fixture();
  let now = 1_000_000;
  let runtime = await createMobileRuntime(f.native, { foreground: false, now: () => now });
  const first = await runtime.runMaintenance();
  expect(first).toBe(now + 6 * 60 * 60 * 1000);
  expect(JSON.parse(f.documents.get('maintenance-cycle')!)).toEqual({
    schema: 1,
    attemptedAt: now,
  });
  const stored = f.documents.get('maintenance-cycle');
  await runtime.transport.invoke(C.SERVER_MEASUREMENTS);
  await runtime.transport.invoke(C.SUBSCRIPTION_MEASUREMENTS);
  await runtime.transport.invoke(C.UPDATE_CHECK);
  expect(f.documents.get('maintenance-cycle')).toBe(stored);
  await runtime.close();
  runtime = await createMobileRuntime(f.native, { foreground: false, now: () => now });
  f.facts.requestText.mockClear();
  now += 1_000;
  expect(await runtime.runMaintenance()).toBe(first);
  expect(f.facts.requestText).not.toHaveBeenCalled();
  now = first;
  await runtime.runMaintenance();
  expect(JSON.parse(f.documents.get('maintenance-cycle')!).attemptedAt).toBe(first);
  expect(f.facts.requestText).toHaveBeenCalled();
  await runtime.close();
  await expect(runtime.runMaintenance()).rejects.toThrow('closed');
});

test('background bootstrap does not request VPN consent even when foreground auto-connect is saved', async () => {
  const f = fixture();
  const { createDefaultConfig } = await import('@shared/config-defaults');
  const saved = createDefaultConfig('fictional-secret');
  saved.autoConnect = true;
  saved.proxyMode = 'direct';
  f.documents.set('config', JSON.stringify({ schema: 1, value: saved }));
  const start = jest.fn();
  Object.assign(f.native, { start });
  const runtime = await createMobileRuntime(f.native, { foreground: false });
  expect(start).not.toHaveBeenCalled();
  expect((await runtime.config.read()).autoConnect).toBe(true);
  await runtime.close();
});
