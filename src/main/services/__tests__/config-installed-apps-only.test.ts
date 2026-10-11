import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

jest.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => os.tmpdir(), isPackaged: false },
}));
import { ConfigManager } from '../ConfigManager';
import { applicationIdentity } from '../InstalledApplications';

describe('installed-application-only routing configuration', () => {
  let directory: string;
  let file: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadowvpn-installed-apps-'));
    file = path.join(directory, 'config.json');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('starts without implicit service rules', async () => {
    expect((await new ConfigManager(file).loadConfig()).appRules).toEqual([]);
  });
  it('deactivates and preserves old service/manual rules without changing installed app choices', async () => {
    const manager = new ConfigManager(file);
    const original = await manager.loadConfig();
    const app = applicationIdentity('Example', '/Applications/Example.app', 'darwin');
    original.appRules = [
      { appId: 'google', enabled: true, action: 'proxy' },
      { appId: 'old-manual', enabled: true, action: 'direct' },
      { appId: app.id, enabled: true, action: 'proxy', targetServerId: 'example-node' },
    ];
    original.customAppPresets = [
      {
        id: 'old-manual',
        name: 'Old manual',
        emoji: '',
        geositeTags: [],
        processNames: ['example'],
      },
      {
        id: app.id,
        name: app.name,
        emoji: '',
        geositeTags: [],
        installedApplication: app,
        processPathRegex: app.processPathRegex,
      },
    ];
    await manager.saveConfig(original);
    const loaded = await new ConfigManager(file).loadConfig();
    expect(loaded.customAppPresets).toEqual(original.customAppPresets);
    expect(loaded.appRules).toEqual(
      original.appRules.map((rule) => (rule.appId === app.id ? rule : { ...rule, enabled: false }))
    );
    expect(loaded.servers).toEqual(original.servers);
    expect(loaded.customRules).toEqual(original.customRules);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).appRules).toEqual(loaded.appRules);
    expect((await new ConfigManager(file).loadConfig()).appRules).toEqual(loaded.appRules);
  });
});
