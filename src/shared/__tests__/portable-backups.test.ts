import { PortableBackups } from '../portable-backups';
import { ConfigRepository } from '../config-repository';
import { PortableConfigOperations } from '../portable-config-operations';
import { createDefaultConfig } from '../config-defaults';
import { parseBackupContent, sanitizeCrossPlatformRules } from '../backup-format';
function fixture() {
  const documents = new Map<string, string>();
  const repo = new ConfigRepository(
    {
      read: async (key) => documents.get(key) ?? null,
      write: async (key, value) => {
        documents.set(key, value);
      },
    },
    () => createDefaultConfig('fictional-secret'),
    () => {}
  );
  const saved = jest.fn(async () => {});
  const operations = new PortableConfigOperations(repo, {
    saved,
    removeServer: async () => {},
    removeSubscription: () => {},
  });
  const host = {
    clientInfo: jest.fn(async () => ({ appVersion: '0.1.0', platform: 'android' })),
    exportDocument: jest.fn(async (_value: { name: string; content: string }) => ({
      canceled: false,
    })),
    importDocument: jest.fn(async () => ({
      canceled: false,
      content: JSON.stringify({
        version: '1.0',
        platform: 'darwin',
        config: {
          customRules: [
            {
              id: 'r1',
              type: 'processPathRegex',
              values: ['^/Applications/Fictional.app/'],
              action: 'direct',
              enabled: true,
            },
          ],
        },
      }),
    })),
  };
  return { repo, saved, host, service: new PortableBackups(repo, operations, host) };
}
it('exports interoperable categories through the system picker without local API secrets', async () => {
  const { service, host } = fixture();
  expect(await service.export()).toEqual({ success: true });
  const { content, name } = host.exportDocument.mock.calls[0][0];
  expect(name).toMatch(/^shadowvpn-backup-.*\.json$/);
  const document = JSON.parse(content);
  expect(document.platform).toBe('android');
  expect(document.version).toBe('1.0');
  expect(document.config.clashApiSecret).toBeUndefined();
  expect(content).not.toContain('fictional-secret');
});
it('picker cancellation and invalid categories cannot claim success or write files', async () => {
  const { service, host } = fixture();
  host.exportDocument.mockResolvedValue({ canceled: true });
  expect(await service.export()).toEqual({ success: false, error: 'cancelled' });
  await expect(service.export(['unregistered' as never])).rejects.toThrow('分类');
  expect(host.exportDocument).toHaveBeenCalledTimes(1);
});
it('picking only previews; apply is one-shot, preserves other categories and schedules saved effects', async () => {
  const { service, repo, saved } = fixture();
  const before = await repo.read();
  const picked = await service.pick();
  expect(picked.available).toEqual(['customRules']);
  expect(await repo.read()).toEqual(before);
  expect(saved).not.toHaveBeenCalled();
  await expect(service.apply('/arbitrary/path', ['customRules'])).rejects.toThrow('重新选择');
  const result = await service.apply(picked.filePath, ['customRules']);
  expect(result.info.crossPlatformDisabledRules).toBe(1);
  expect((await repo.read()).customRules[0].enabled).toBe(false);
  expect((await repo.read()).servers).toEqual(before.servers);
  expect(saved).toHaveBeenCalledTimes(1);
  await expect(service.apply(picked.filePath, ['customRules'])).rejects.toThrow('重新选择');
});
it('invalid backup structures are rejected without modifying saved configuration', async () => {
  const { service, host, repo } = fixture();
  const before = await repo.read();
  for (const content of ['null', '[]', '{"version":"1.0","config":[]}', '{"servers":[null]}']) {
    host.importDocument.mockResolvedValue({ canceled: false, content });
    await expect(service.pick()).rejects.toThrow('识别');
    expect(await repo.read()).toEqual(before);
  }
});
it('legacy format remains readable; application regex rules are disabled across platforms only', () => {
  expect(parseBackupContent('{"servers":[]}')).toEqual({ config: { servers: [] } });
  const config = createDefaultConfig('fictional');
  config.customRules = [
    {
      id: 'r1',
      type: 'processPathRegex',
      values: ['^/fictional/'],
      action: 'direct',
      enabled: true,
    },
  ];
  expect(sanitizeCrossPlatformRules(config, 'android', 'android')).toBe(0);
  expect(sanitizeCrossPlatformRules(config, 'android', 'win32')).toBe(1);
  expect(config.customRules[0].enabled).toBe(false);
});
