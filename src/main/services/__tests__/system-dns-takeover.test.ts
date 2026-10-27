import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-dns-takeover-'));
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

describe('TUN 恒接管系统 DNS（macOS scoped resolver 绕开路由劫持的治本，无开关）', () => {
  it('新装默认 TUN，门控恒开', async () => {
    const config = await new ConfigManager(path.join(TMP, 'new.json')).loadConfig();
    expect(config.proxyModeType).toBe('tun');
    expect(shouldReconcileDns(config, true)).toBe(true);
  });

  it('存量配置残留旧开关值（任意值）→ 门控恒开，不受残留字段影响', async () => {
    const file = path.join(TMP, 'existing.json');
    // 直接写原始 JSON 模拟旧版本落盘的显式开关值（false/true 各验一次）
    for (const legacy of [false, true]) {
      fs.writeFileSync(file, JSON.stringify({ dnsConfig: { takeoverSystemDns: legacy } }));
      const loaded = await new ConfigManager(file).loadConfig();
      expect(shouldReconcileDns(loaded, true)).toBe(true);
    }
  });
});
