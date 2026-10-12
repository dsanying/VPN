import { PortableIpInfo } from '../portable-ip-info';
function setup() {
  const data = new Map<string, string>();
  const store = {
    read: jest.fn(async (name: string) => data.get(name) ?? null),
    write: jest.fn(async (name: string, content: string) => {
      data.set(name, content);
    }),
  };
  const host = {
    identity: jest.fn(async () => ({ key: 'physical-A', proxy: true })),
    trace: jest.fn(async (route: string) => ({
      status: 200,
      body: `ip=${route === 'direct' ? '192.0.2.1' : '198.51.100.1'}\nloc=${route === 'direct' ? 'CN' : 'US'}`,
    })),
  };
  const emit = jest.fn();
  return { data, store, host, emit, service: new PortableIpInfo(store, host, emit) };
}
test('reads restore saved facts without probes and refresh saves actual routes before emitting a settled result', async () => {
  const f = setup();
  await f.service.read();
  expect(f.host.trace).not.toHaveBeenCalled();
  f.emit.mockImplementation((value) => {
    if (!value.loading) expect(JSON.parse(f.data.get('ip-info')!).value).toEqual(value);
  });
  await f.service.refresh();
  expect(f.host.trace.mock.calls.map((args) => args[0])).toEqual(['direct', 'proxy']);
  expect(await f.service.read()).toMatchObject({
    direct: { ip: '192.0.2.1' },
    proxy: { ip: '198.51.100.1' },
  });
  const restored = new PortableIpInfo(f.store, f.host, jest.fn());
  expect(await restored.read()).toMatchObject({ proxy: { countryCode: 'US' } });
  expect(f.host.trace).toHaveBeenCalledTimes(2);
  f.service.close();
  restored.close();
});
test('changed network failures cannot retain results from a previous physical network', async () => {
  const f = setup();
  await f.service.refresh();
  f.host.identity.mockResolvedValue({ key: 'physical-B', proxy: false });
  f.host.trace.mockResolvedValue({ status: 200, body: '<html>portal</html>' });
  await f.service.refresh();
  expect(await f.service.read()).toMatchObject({
    direct: null,
    proxy: null,
    error: '出口检测失败',
  });
  f.service.close();
});
test('closing during a pending trace aborts and prevents late results or writes', async () => {
  const f = setup();
  let release!: (value: { status: number; body: string }) => void;
  f.host.trace.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  f.host.identity.mockResolvedValue({ key: 'physical-A', proxy: false });
  const pending = f.service.refresh();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  f.service.close();
  release({ status: 200, body: 'ip=192.0.2.1\nloc=US' });
  await pending;
  expect(f.store.write).not.toHaveBeenCalled();
  expect(f.emit.mock.calls.filter(([value]) => !value.loading)).toHaveLength(0);
});

test('core preparation reuses known facts only for the same native network identity', async () => {
  const f = setup();
  await f.service.ensureCurrent();
  expect(f.host.trace).toHaveBeenCalledTimes(2);
  await f.service.ensureCurrent();
  expect(f.host.trace).toHaveBeenCalledTimes(2);
  f.host.identity.mockResolvedValue({ key: 'physical-B', proxy: false });
  f.host.trace.mockResolvedValue({ status: 200, body: 'ip=203.0.113.1\nloc=JP' });
  expect(await f.service.ensureCurrent()).toMatchObject({
    direct: { countryCode: 'JP' },
    proxy: null,
  });
  expect(f.host.trace).toHaveBeenCalledTimes(3);
  f.service.close();
});

test('concurrent startup and connection preparation share initialization and restart restores saved facts', async () => {
  const f = setup();
  const results = await Promise.all([f.service.ensureCurrent(), f.service.ensureCurrent()]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ direct: { countryCode: 'CN' } });
  expect(f.host.trace).toHaveBeenCalledTimes(2);
  const restarted = new PortableIpInfo(f.store, f.host, jest.fn());
  expect(await restarted.ensureCurrent()).toMatchObject({ direct: { countryCode: 'CN' } });
  expect(f.host.trace).toHaveBeenCalledTimes(2);
  f.service.close();
  restarted.close();
});

test.each([false, true])(
  'success and failure share six-hour expiry; failed reads do not cause retry storms: %p',
  async (failure) => {
    jest.useFakeTimers();
    try {
      const f = setup();
      if (failure) f.host.trace.mockResolvedValue({ status: 200, body: 'invalid' });
      await f.service.ensureCurrent();
      const calls = f.host.trace.mock.calls.length;
      await jest.advanceTimersByTimeAsync(6 * 3600000 - 1);
      await f.service.ensureCurrent();
      expect(f.host.trace).toHaveBeenCalledTimes(calls);
      await jest.advanceTimersByTimeAsync(1);
      await f.service.ensureCurrent();
      expect(f.host.trace.mock.calls.length).toBeGreaterThan(calls);
      f.service.close();
    } finally {
      jest.useRealTimers();
    }
  }
);
