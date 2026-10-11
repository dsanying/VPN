// electron mock 必须在 import 之前
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowvpn-retired-config-'));
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
import type { UserConfig } from '../../../shared/types';

/** 最小可校验配置，覆盖旧字段加载及再次导入的清理。 */
function makeConfig(over: Record<string, unknown> = {}): UserConfig {
  return {
    subscriptions: [],
    servers: [],
    selectedServerId: null,
    proxyMode: 'smart',
    proxyModeType: 'systemProxy',
    tunConfig: { mtu: 1350, stack: 'system', autoRoute: true, strictRoute: true },
    customRules: [],
    autoStart: false,
    silentStart: false,
    autoConnect: false,
    minimizeToTray: true,
    autoCheckUpdate: true,
    autoLightweightMode: false,
    autoUpdateSubscriptionOnStart: false,
    subscriptionUpdateIntervalHours: 12,
    mainSessionViaProxy: true,
    rememberWindowSize: false,
    enableIPv6: false,
    autoPrivacyMode: false,
    privacyPassword: '',
    customRuleSets: [],
    appRules: [],
    appRoutingEnabled: true,
    socksPort: 2081,
    httpPort: 2080,
    logLevel: 'info',
    disableLogFile: false,
    clashApiSecret: 'fixedsecret0000000000000000000000',
    uiTheme: 'system',
    ...over,
  } as unknown as UserConfig;
}

describe('废弃订阅配置集中清理', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subscription-cleanup-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  it.each(['direct', 'proxy', 'follow', 'invalid'])(
    'load/save 清除旧策略 %s 和请求标识，保留有效订阅；再次加载幂等',
    async (policy) => {
      const file = path.join(dir, `${policy}.json`);
      const source = {
        id: 's1',
        name: 'Source',
        url: 'https://example.com/sub',
        autoUpdate: true,
        createdAt: '2026-10-01',
        userAgent: 'legacy-agent',
        updateViaProxy: true,
        protocolPreference: 'vless',
      };
      fs.writeFileSync(
        file,
        JSON.stringify(
          makeConfig({
            subscriptions: [source],
            subscriptionProxyPolicy: policy,
            subscriptionUpdateViaProxy: true,
            subscriptionUserAgent: 'legacy-global',
          })
        )
      );
      const manager = new ConfigManager(file);
      const loaded = await manager.loadConfig();
      const verify = (config: unknown) => {
        const raw = config as Record<string, unknown>;
        for (const key of [
          'subscriptionProxyPolicy',
          'subscriptionUpdateViaProxy',
          'subscriptionUserAgent',
        ])
          expect(raw).not.toHaveProperty(key);
        const sub = (raw.subscriptions as Record<string, unknown>[])[0];
        expect(sub).not.toHaveProperty('userAgent');
        expect(sub).not.toHaveProperty('updateViaProxy');
        expect(sub).not.toHaveProperty('protocolPreference');
        expect(sub.url).toBe(source.url);
        expect(sub.name).toBe(source.name);
      };
      verify(loaded);
      verify(JSON.parse(fs.readFileSync(file, 'utf8')));
      verify(await manager.loadConfig());
      await manager.saveConfig({ ...loaded, subscriptionUserAgent: 'reimported' } as UserConfig);
      verify(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
  );
});

describe('managed runtime settings', () => {
  const retired = [
    'autoCheckUpdate',
    'autoUpdateSubscriptionOnStart',
    'subscriptionUpdateIntervalHours',
    'blockQuic',
    'speedTestUrl',
    'logLevel',
    'diagnosticCapture',
    'helperPromptDismissed',
    'helperDisabledPromptDismissed',
    'helperUpgradePromptDismissed',
  ];
  const dnsRetired = ['enableFakeIp', 'fakeIpToggleMigrated', 'fakeIpTunAutoEnable'];
  it.each([false, true])(
    'load/save/import discard obsolete switches %s while preserving explicit network overrides',
    async (flag) => {
      const file = path.join(TMP, `managed-${flag}.json`);
      const legacy = makeConfig({
        mixedPort: 17890,
        enableIPv6: true,
        blockQuic: flag,
        helperPromptDismissed: true,
        helperDisabledPromptDismissed: true,
        helperUpgradePromptDismissed: true,
        speedTestUrl: 'https://example.com/retired-target',
        logLevel: 'debug',
        diagnosticCapture: { prevLogLevel: 'fatal' },
        dnsConfig: {
          domesticDns: 'https://example.com/internal-dns',
          foreignDns: 'https://example.net/dns-query',
          enableFakeIp: flag,
          fakeIpToggleMigrated: flag,
          fakeIpTunAutoEnable: flag,
        },
      });
      fs.writeFileSync(file, JSON.stringify(legacy));
      const manager = new ConfigManager(file);
      const verify = (value: UserConfig) => {
        for (const key of retired) expect(value).not.toHaveProperty(key);
        for (const key of dnsRetired) expect(value.dnsConfig).not.toHaveProperty(key);
        expect(value.mixedPort).toBe(17890);
        expect(value.enableIPv6).toBe(true);
        expect(value.dnsConfig?.domesticDns).toBe('https://example.com/internal-dns');
        expect(value.dnsConfig?.foreignDns).toBe('https://example.net/dns-query');
      };
      verify(await manager.loadConfig());
      verify(JSON.parse(fs.readFileSync(file, 'utf8')));
      await manager.saveConfig(makeConfig({ ...legacy, logLevel: 'fatal', blockQuic: !flag }));
      verify(JSON.parse(fs.readFileSync(file, 'utf8')));
      verify(await new ConfigManager(file).loadConfig());
    }
  );
});
