import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-dns-opt-in-'));
jest.mock('electron', () => ({
  app: {
    getPath: () => TMP,
    getVersion: () => '9.9.9',
    isPackaged: false,
    getAppPath: () => TMP,
  },
  BrowserWindow: class {},
  Notification: class {},
  net: {},
  session: {},
}));

import { ConfigManager } from '../ConfigManager';
import { shouldReconcileDns } from '../DnsInterfaceWatcher';

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('TUN-only 不授权修改系统 DNS', () => {
  it('新装默认关闭，强制 TUN 不改变 DNS 接管选择', async () => {
    const config = await new ConfigManager(path.join(TMP, 'new.json')).loadConfig();
    expect(config.dnsConfig?.takeoverSystemDns).toBe(false);
    config.forceTun = true;
    config.proxyModeType = 'tun';
    expect(shouldReconcileDns(config, true)).toBe(false);
  });

  it.each([undefined, false, true])('存量选择 %p 读写后关闭，不授权接管', async (value) => {
    const file = path.join(TMP, `existing-${String(value)}.json`);
    const manager = new ConfigManager(file);
    const config = await manager.loadConfig();
    config.proxyModeType = 'tun';
    config.dnsConfig!.takeoverSystemDns = value;
    await manager.saveConfig(config);
    const loaded = await new ConfigManager(file).loadConfig();
    expect(loaded.dnsConfig?.takeoverSystemDns).toBe(false);
    expect(shouldReconcileDns(loaded, true)).toBe(false);
  });
});
