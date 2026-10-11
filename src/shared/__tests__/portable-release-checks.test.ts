import { PortableReleaseChecks } from '../portable-release-checks';
const digest = 'sha256:' + 'a'.repeat(64);
const asset = 'https://github.com/dsanying/VPN/releases/download/v0.1.1/app-release.apk';
function setup() {
  const documents = new Map<string, string>();
  const ports = {
    store: {
      read: jest.fn(async (name: string) => documents.get(name) ?? null),
      write: jest.fn(async (name: string, content: string) => {
        documents.set(name, content);
      }),
    },
    read: jest.fn(async (url: string) => ({
      status: 200,
      body: JSON.stringify(
        url.includes('SagerNet')
          ? [{ tag_name: 'v1.14.3', prerelease: false, draft: false, assets: [] }]
          : [
              {
                tag_name: 'v0.1.1',
                prerelease: false,
                draft: false,
                assets: [{ name: 'app-release.apk', browser_download_url: asset, digest }],
              },
            ]
      ),
    })),
    version: jest.fn(async () => ({ appVersion: '0.1.0', singBoxVersion: '1.14.3' })),
    prepare: jest.fn(async () => ({ version: '0.1.1', verified: true })),
    install: jest.fn(async () => ({ installationRequested: true })),
    restored: jest.fn(async (): Promise<{ version: string; verified: boolean } | null> => null),
    changed: jest.fn(),
  };
  return { ports, documents, service: new PortableReleaseChecks(ports) };
}
it('page status reads saved results without downloads or network checks', async () => {
  const { ports, service } = setup();
  expect((await service.savedStatus()).globalUpdates.items).toEqual([]);
  expect(ports.read).not.toHaveBeenCalled();
  expect(ports.prepare).not.toHaveBeenCalled();
});
it('manual software and core checks share one flight, verify APK before ready, and persist first', async () => {
  const { ports, documents, service } = setup();
  const first = service.check();
  expect(service.check()).toBe(first);
  const result = await first;
  expect(ports.read).toHaveBeenCalledTimes(4);
  expect(ports.read.mock.calls.every(([url]) => url.includes('/releases'))).toBe(true);
  expect(ports.prepare).toHaveBeenCalledWith({
    url: asset,
    version: '0.1.1',
    digest,
    candidates: expect.arrayContaining([asset, 'https://ghproxy.net/' + asset]),
  });
  expect(result.globalUpdates.items).toEqual([
    { kind: 'software', status: 'ready', version: '0.1.1', restart: 'software' },
    { kind: 'core', status: 'latest', version: '1.14.3' },
  ]);
  expect(JSON.parse(documents.get('release-checks')!).checking).toBe(false);
  expect(ports.store.write.mock.invocationCallOrder[0]).toBeLessThan(
    ports.changed.mock.invocationCallOrder.at(-1)!
  );
  expect(await service.install('software')).toEqual({ success: true, installationRequested: true });
  await expect(service.install('core')).rejects.toThrow('没有已验证');
});
it('rejected native verification never publishes ready or authorizes install', async () => {
  const { ports, service } = setup();
  ports.prepare.mockResolvedValue({ version: '0.1.1', verified: false });
  expect((await service.check()).globalUpdates.items[0].status).toBe('error');
  await expect(service.install('software')).rejects.toThrow();
  expect(ports.install).not.toHaveBeenCalled();
});
it('an upstream engine bump cannot become a desktop executable replacement on Android', async () => {
  const { ports, service } = setup();
  ports.version.mockResolvedValue({ appVersion: '0.1.1', singBoxVersion: '1.14.2' });
  expect((await service.check()).globalUpdates.items).toContainEqual({
    kind: 'core',
    status: 'incompatible',
    version: '1.14.3',
  });
  expect(ports.prepare).not.toHaveBeenCalled();
});
it('failed persistence resets checking and cannot publish staged success', async () => {
  const { ports, service } = setup();
  ports.store.write.mockRejectedValue(new Error('disk full'));
  await expect(service.check()).rejects.toThrow('disk full');
  expect(service.status().globalUpdates.checking).toBe(false);
  expect(service.status().globalUpdates.items).toEqual([]);
});
it('empty or ambiguous release metadata does not fabricate an Android installer', async () => {
  const { ports, service } = setup();
  ports.read.mockResolvedValue({ status: 200, body: '[]' });
  expect((await service.check()).globalUpdates.items).toEqual([
    { kind: 'software', status: 'latest', version: '0.1.0' },
    { kind: 'core', status: 'error', error: '内核更新检查失败' },
  ]);
  expect(ports.prepare).not.toHaveBeenCalled();
});
it('closed service refuses new work and cannot acknowledge a missing native installer', async () => {
  const { ports, service } = setup();
  await service.check();
  ports.install.mockResolvedValue({} as never);
  await expect(service.install('software')).rejects.toThrow('系统安装程序未打开');
  service.close();
  await expect(service.check()).rejects.toThrow('closed');
});
it('restart restores only a natively reverified APK and never downloads on status', async () => {
  const { ports, documents } = setup();
  documents.set(
    'release-checks',
    JSON.stringify({
      schema: 1,
      lastCheckedAt: 123,
      items: [
        { kind: 'software', status: 'ready', version: '999.0.0', restart: 'software' },
        { kind: 'core', status: 'latest', version: '1.14.3' },
      ],
    })
  );
  ports.restored.mockResolvedValue({ verified: true, version: '0.1.1' });
  const service = new PortableReleaseChecks(ports);
  const result = await service.savedStatus();
  expect(result.globalUpdates.items).toContainEqual({
    kind: 'software',
    status: 'ready',
    version: '0.1.1',
    restart: 'software',
  });
  expect(result.globalUpdates.items.some((item) => item.version === '999.0.0')).toBe(false);
  expect(ports.read).not.toHaveBeenCalled();
  expect(ports.prepare).not.toHaveBeenCalled();
});
it('a missing cached APK cannot remain actionable after restart', async () => {
  const { ports, documents } = setup();
  documents.set(
    'release-checks',
    JSON.stringify({
      schema: 1,
      lastCheckedAt: 123,
      items: [{ kind: 'software', status: 'ready', version: '0.1.1', restart: 'software' }],
    })
  );
  const service = new PortableReleaseChecks(ports);
  await service.savedStatus();
  expect(service.status().globalUpdates.items).toEqual([]);
  await expect(service.install('software')).rejects.toThrow();
});
it('closing aborts metadata reads and prevents a late response from starting an APK download', async () => {
  const { ports, service } = setup();
  const completions: Array<(response: { status: number; body: string }) => void> = [];
  ports.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        completions.push(resolve);
      })
  );
  const pending = service.check();
  // Initialization and version reads precede parallel metadata requests.
  for (let i = 0; i < 10 && ports.read.mock.calls.length < 2; i++) await Promise.resolve();
  expect(ports.read).toHaveBeenCalledTimes(2);
  const signal = (ports.read.mock.calls[0] as unknown[])[2] as AbortSignal;
  service.close();
  expect(signal.aborted).toBe(true);
  // Resolve both operations through a transport which deliberately ignores abort.
  completions.forEach((finish) => finish({ status: 200, body: '[]' }));
  await expect(pending).rejects.toThrow('closed');
  expect(ports.prepare).not.toHaveBeenCalled();
  expect(ports.read).toHaveBeenCalledTimes(2);
  expect(ports.store.write).not.toHaveBeenCalled();
});
