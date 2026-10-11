import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

jest.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => os.tmpdir(), isPackaged: false },
}));

import { ConfigManager } from '../ConfigManager';
import type { UserConfig } from '../../../shared/types';

describe('persist direct exceptions as editable rules without data loss', () => {
  let directory: string;
  let file: string;
  let original: UserConfig;
  let originalBytes: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadowvpn-bypass-'));
    file = path.join(directory, 'config.json');
    const bootstrap = new ConfigManager(file);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    original = await bootstrap.loadConfig();
    original.bypassLANList = ['192.168.0.0/16', 'example.com', '*.example.org'];
    original.servers = [
      {
        id: 'example-node',
        name: 'Example',
        protocol: 'vless',
        address: 'node.example.com',
        port: 443,
        uuid: '00000000-0000-0000-0000-000000000001',
      },
    ];
    original.selectedServerId = 'example-node';
    original.subscriptions = [
      {
        id: 'example-sub',
        name: 'Example',
        url: 'https://example.com/subscription',
        autoUpdate: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    original.customRules = [
      {
        id: 'existing-rule',
        type: 'domain',
        values: ['example.net'],
        action: 'proxy',
        enabled: true,
      },
    ];
    originalBytes = JSON.stringify(original, null, 2);
    await fs.writeFile(file, originalBytes);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('backs up original bytes, persists conversion and does not duplicate on reload', async () => {
    const loaded = await new ConfigManager(file).loadConfig();
    expect(await fs.readFile(`${file}.pre-bypass-rules.bak`, 'utf8')).toBe(originalBytes);
    expect(loaded.bypassLANList).toEqual(['192.168.0.0/16']);
    expect(loaded.customRules.map((rule) => rule.values[0])).toEqual([
      'example.com',
      '^.*\\.example\\.org$',
      'example.net',
    ]);
    expect(loaded.servers).toEqual(original.servers);
    expect(loaded.subscriptions).toEqual(original.subscriptions);
    expect(loaded.selectedServerId).toBe(original.selectedServerId);
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(stored.customRules).toEqual(loaded.customRules);
    expect((await new ConfigManager(file).loadConfig()).customRules).toEqual(loaded.customRules);
    expect(await fs.readFile(`${file}.pre-bypass-rules.bak`, 'utf8')).toBe(originalBytes);
  });

  it('defers conversion if a recoverable backup cannot be created', async () => {
    await fs.mkdir(`${file}.pre-bypass-rules.bak`);
    const loaded = await new ConfigManager(file).loadConfig();
    expect(loaded.bypassLANList).toEqual(original.bypassLANList);
    expect(loaded.customRules).toEqual(original.customRules);
    expect(await fs.readFile(file, 'utf8')).toBe(originalBytes);
    expect(console.warn).toHaveBeenCalledWith('直连例外迁移暂缓，原配置保留');
  });

  it('retains old configuration on save failure and successfully retries on next load', async () => {
    const manager = new ConfigManager(file);
    jest.spyOn(manager, 'saveConfig').mockRejectedValue(new Error('example write failure'));
    const loaded = await manager.loadConfig();
    expect(loaded.bypassLANList).toEqual(original.bypassLANList);
    expect(loaded.customRules).toEqual(original.customRules);
    expect(loaded.servers).toEqual(original.servers);
    expect(await fs.readFile(file, 'utf8')).toBe(originalBytes);
    expect(await fs.readFile(`${file}.pre-bypass-rules.bak`, 'utf8')).toBe(originalBytes);
    expect((await new ConfigManager(file).loadConfig()).bypassLANList).toEqual(['192.168.0.0/16']);
  });
});
