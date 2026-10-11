import { AutoSwitchService } from '../AutoSwitchService';
const node = (id: string, protocol = 'vless') => ({
  id,
  name: id,
  address: 'example.com',
  port: 443,
  protocol,
});
function harness() {
  let config = {
    selectedServerId: 'current',
    proxyMode: 'smart',
    servers: [node('current'), node('bad-auth'), node('working-udp', 'hysteria2')],
    speedTestUrl: undefined,
  };
  const manager = {
    loadConfig: jest.fn(async () => config),
    saveConfig: jest.fn(async (next) => {
      config = next;
    }),
  };
  const proxy = {
    getStatus: jest.fn(() => ({ running: true })),
    getProbePorts: jest.fn(() => ({ direct: 12001, proxy: 12002 })),
    isLoginFallbackEngaged: jest.fn(() => false),
    switchMode: jest.fn(async (_config: unknown) => {}),
  };
  const speed = {
    checkProxyHealth: jest.fn(async () => false),
    testAllServers: jest.fn(async () => ({
      outcome: 'completed',
      results: new Map([
        ['bad-auth', null],
        ['working-udp', 150],
      ]),
    })),
  };
  const service = new AutoSwitchService(
    manager as never,
    proxy as never,
    { addLog: jest.fn() } as never,
    () => null,
    speed as never
  );
  service.enable();
  return {
    service,
    manager,
    proxy,
    speed,
    setConfig: (patch: Partial<typeof config>) => {
      config = { ...config, ...patch };
    },
    heartbeat: () => (service as unknown as { runHeartbeat(): Promise<void> }).runHeartbeat(),
  };
}
afterEach(() => jest.useRealTimers());
it('uses a force-proxy HTTPS check and chooses a verified UDP proxy, not a faster TCP socket', async () => {
  jest.useFakeTimers();
  const h = harness();
  try {
    await h.heartbeat();
    await h.heartbeat();
    await h.heartbeat();
    expect(h.speed.checkProxyHealth).toHaveBeenCalledWith(12002);
    expect(h.speed.testAllServers).toHaveBeenCalledTimes(1);
    expect(h.proxy.switchMode.mock.calls[0][0]).toMatchObject({ selectedServerId: 'working-udp' });
  } finally {
    h.service.destroy();
  }
});
it('does not auto-switch in direct mode or during login fallback', async () => {
  jest.useFakeTimers();
  const h = harness();
  try {
    h.setConfig({ proxyMode: 'direct' });
    await h.heartbeat();
    h.setConfig({ proxyMode: 'smart' });
    h.proxy.isLoginFallbackEngaged.mockReturnValue(true);
    await h.heartbeat();
    expect(h.speed.checkProxyHealth).not.toHaveBeenCalled();
  } finally {
    h.service.destroy();
  }
});
it('a late health failure cannot replace a node chosen while the request was running', async () => {
  jest.useFakeTimers();
  const h = harness();
  let release!: (healthy: boolean) => void;
  h.speed.checkProxyHealth.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  try {
    const task = h.heartbeat();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    h.setConfig({ selectedServerId: 'bad-auth' });
    release(false);
    await task;
    expect(h.speed.testAllServers).not.toHaveBeenCalled();
  } finally {
    h.service.destroy();
  }
});
it('prevents overlapping heartbeat requests', async () => {
  jest.useFakeTimers();
  const h = harness();
  let release!: (healthy: boolean) => void;
  h.speed.checkProxyHealth.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  try {
    const first = h.heartbeat();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    await h.heartbeat();
    expect(h.speed.checkProxyHealth).toHaveBeenCalledTimes(1);
    release(true);
    await first;
  } finally {
    h.service.destroy();
  }
});

it('failed switching restores the previous selection without losing newer settings', async () => {
  jest.useFakeTimers();
  const h = harness();
  h.proxy.switchMode.mockImplementation(async () => {
    h.setConfig({ speedTestUrl: 'https://example.com/204' as never });
    throw new Error('switch failed');
  });
  try {
    await h.heartbeat();
    await h.heartbeat();
    await h.heartbeat();
    expect(await h.manager.loadConfig()).toMatchObject({
      selectedServerId: 'current',
      speedTestUrl: 'https://example.com/204',
    });
  } finally {
    h.service.destroy();
  }
});
