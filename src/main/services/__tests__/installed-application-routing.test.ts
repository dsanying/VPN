import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-app-routing-'));
jest.mock('electron', () => ({
  app: { getPath: () => TMP, getAppPath: () => TMP, isPackaged: false },
  net: {},
}));
import { ProxyManager } from '../ProxyManager';
import type { UserConfig } from '../../../shared/types';
import { applicationIdentity } from '../InstalledApplications';

const app = applicationIdentity('Example', '/Applications/Example.app', 'darwin');
const config = (
  action: 'proxy' | 'direct' | 'block',
  overrides: Partial<UserConfig> = {}
): UserConfig =>
  ({
    servers: [
      {
        id: 'n1',
        name: 'Example node',
        protocol: 'vless',
        address: '192.0.2.1',
        port: 443,
        uuid: '00000000-0000-4000-8000-000000000001',
      },
    ],
    subscriptions: [],
    selectedServerId: 'n1',
    proxyModeType: 'systemProxy',
    proxyMode: 'smart',
    appRoutingEnabled: true,
    customRules: [],
    customAppPresets: [
      {
        id: app.id,
        name: app.name,
        emoji: '',
        geositeTags: [],
        processPathRegex: app.processPathRegex,
      },
    ],
    appRules: [{ appId: app.id, enabled: true, action }],
    dnsConfig: { enableFakeIp: true },
    mixedPort: 7890,
    ...overrides,
  }) as UserConfig;
function generate(c: UserConfig): any {
  const manager: any = new ProxyManager(
    undefined,
    undefined,
    path.join(TMP, 'cfg.json'),
    '/fake/sing-box'
  );
  manager.coreVersion = '1.14.0';
  return manager.generateSingBoxConfig(c);
}
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
it.each(['proxy', 'direct', 'block'] as const)(
  'emits %s for the complete installed bundle, not only its main process',
  (action) => {
    const result = generate(config(action));
    const route = result.route.rules.find((r: any) => r.process_path_regex && r.port === undefined);
    expect(route).toMatchObject({
      process_path_regex: app.processPathRegex,
      action: action === 'block' ? 'reject' : 'route',
    });
    expect(route.process_name).toBeUndefined();
    expect(result.route.find_process).toBe(true);
    if (action === 'direct') {
      expect(route.outbound).toBe('direct');
      const dns = result.dns.rules.find((r: any) => r.process_path_regex);
      expect(dns).toMatchObject({ process_path_regex: app.processPathRegex });
      expect(result.dns.servers.find((s: any) => s.tag === dns.server)?.detour).toBeUndefined();
    } else if (action === 'proxy') {
      expect(route.outbound).toBe(`rule-sel-app-${app.id}`);
      const dns = result.dns.rules.find((r: any) => r.process_path_regex);
      expect(result.dns.servers.find((s: any) => s.tag === dns.server)?.detour).toBe(
        route.outbound
      );
      expect(result.outbounds.find((o: any) => o.tag === route.outbound)?.default).toBe(
        'proxy-selector'
      );
    } else {
      expect(route.outbound).toBeUndefined();
      expect(result.dns.rules.find((r: any) => r.process_path_regex)?.action).toBe('reject');
    }
  }
);
it('uses a specified node instead of the global selector', () => {
  const result = generate(
    config('proxy', {
      appRules: [{ appId: app.id, enabled: true, action: 'proxy', targetServerId: 'n1' }],
    })
  );
  expect(result.outbounds.find((o: any) => o.tag === `rule-sel-app-${app.id}`)?.default).toBe(
    'Example node'
  );
});
it('applies QUIC protection to the same bundle scope', () => {
  const result = generate(config('proxy', {}));
  expect(result.route.rules).toContainEqual(
    expect.objectContaining({
      process_path_regex: app.processPathRegex,
      network: ['udp'],
      port: [443],
      action: 'reject',
    })
  );
});
it.each([
  { appRoutingEnabled: false },
  { proxyMode: 'global' },
  { proxyMode: 'direct' },
  { appRules: [{ appId: app.id, enabled: false, action: 'direct' }] },
])('does not show a phantom app rule when inactive: %j', (overrides) => {
  const result = generate(config('direct', overrides as Partial<UserConfig>));
  expect(result.route.rules.some((r: any) => r.process_path_regex)).toBe(false);
  expect(result.dns.rules.some((r: any) => r.process_path_regex)).toBe(false);
});

it('prioritizes the selected application over a conflicting ordinary domain policy', () => {
  const result = generate(
    config('proxy', {
      customRules: [
        {
          id: 'domain',
          type: 'domainSuffix',
          values: ['example.com'],
          action: 'direct',
          enabled: true,
        },
      ],
    })
  );
  const process = result.route.rules.findIndex((r: any) => r.process_path_regex);
  const domain = result.route.rules.findIndex((r: any) =>
    r.domain_suffix?.some((v: string) => v.includes('example.com'))
  );
  expect(process).toBeGreaterThanOrEqual(0);
  expect(domain).toBeGreaterThan(process);
});
