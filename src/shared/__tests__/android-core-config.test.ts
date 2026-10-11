import { buildAndroidCoreConfig } from '../android-core-config';
import { createDefaultConfig } from '../config-defaults';
import type { ServerConfig } from '../types';
import { applicationRuleValues } from '../unified-rules';
const node: ServerConfig = {
  id: 'node-a',
  name: 'Test',
  protocol: 'vless',
  address: 'example.com',
  port: 443,
  uuid: '00000000-0000-4000-8000-000000000001',
  network: 'ws',
  security: 'tls',
  wsSettings: { path: '/ws', headers: { Host: 'example.com' } },
  tlsSettings: { serverName: 'example.com' },
};
const host = { stateDirectory: '/data/user/0/com.dsanying.shadowvpn/files/core' };
function config() {
  const value = createDefaultConfig('test-secret');
  value.servers = [structuredClone(node)];
  value.selectedServerId = node.id;
  return value;
}
test('native assembly retains transport and TLS and binds control access to loopback', () => {
  const generated = buildAndroidCoreConfig(config(), host);
  expect(generated.outbounds?.find((outbound) => outbound.type === 'vless')).toMatchObject({
    transport: { type: 'ws', path: '/ws' },
    tls: { enabled: true, server_name: 'example.com' },
  });
  expect(generated.services).toContainEqual({
    type: 'api',
    listen: '127.0.0.1',
    listen_port: 9090,
    secret: 'test-secret',
  });
  expect(generated.route?.final).toBe('proxy-selector');
});
test('direct mode retains DNS interception and never applies proxy rules', () => {
  const value = config();
  value.proxyMode = 'direct';
  value.customRules = [
    { id: 'r1', type: 'domain', values: ['example.com'], action: 'block', enabled: true },
  ];
  const generated = buildAndroidCoreConfig(value, host);
  expect(generated.route?.final).toBe('direct');
  expect(generated.route?.rules).toContainEqual({ protocol: 'dns', action: 'hijack-dns' });
  expect(generated.route?.rules?.some((rule) => rule.action === 'reject')).toBe(false);
});
test('missing smart routing data and unsupported compatibility fail before tunnel creation', () => {
  const value = config();
  value.proxyMode = 'smart';
  expect(() => buildAndroidCoreConfig(value, host)).toThrow('Smart routing data');
  value.proxyMode = 'global';
  value.servers[0].network = 'xhttp';
  expect(() => buildAndroidCoreConfig(value, host)).toThrow('Compatibility engine');
});
test('rules preserve order, conditions and target identity and do not mutate saved configuration', () => {
  const value = config();
  value.customRules = [
    { id: 'r1', type: 'domain', values: ['example.com'], action: 'direct', enabled: true },
    {
      id: 'r2',
      type: 'domainSuffix',
      values: ['*.example.org'],
      conditions: [
        { type: 'domainSuffix', values: ['*.example.org'] },
        { type: 'port', values: ['443'] },
      ],
      combineMode: 'and',
      action: 'proxy',
      targetServerId: node.id,
      enabled: true,
    },
  ];
  const original = structuredClone(value);
  const generated = buildAndroidCoreConfig(value, host);
  expect(generated.route?.rules?.slice(3)).toEqual([
    { domain: ['example.com'], action: 'route', outbound: 'direct' },
    {
      type: 'logical',
      mode: 'and',
      rules: [{ domain_suffix: ['example.org'] }, { port: [443] }],
      action: 'route',
      outbound: 'node-node-a',
    },
  ]);
  expect(value).toEqual(original);
});
test('desktop application rules cannot silently turn into unrestricted Android rules', () => {
  const value = config();
  value.customRules = [
    {
      id: 'r1',
      type: 'processPath',
      values: ['/Applications/Test.app/Contents/MacOS/Test'],
      action: 'proxy',
      enabled: true,
    },
  ];
  expect(() => buildAndroidCoreConfig(value, host)).toThrow('application mapping');
});

test('installed Android applications compile to exact package matchers with ownership capability', () => {
  const value = config();
  const application = {
    id: 'com.fixture.app',
    name: 'Fixture',
    path: 'android-package:com.fixture.app',
    processPaths: ['android-package:com.fixture.app'],
    processPathRegex: [],
    coverage: 'package' as const,
    packageName: 'com.fixture.app',
  };
  value.customRules = [
    {
      id: 'native-app',
      type: 'processPathRegex',
      values: applicationRuleValues(application),
      application,
      enabled: true,
      action: 'direct',
    },
  ];
  expect(() => buildAndroidCoreConfig(value, host)).toThrow('ownership');
  expect(
    buildAndroidCoreConfig(value, { ...host, applicationRouting: true }).route?.rules?.slice(3)
  ).toEqual([{ package_name: ['com.fixture.app'], action: 'route', outbound: 'direct' }]);
  value.customRules[0].values = ['.*'];
  expect(() => buildAndroidCoreConfig(value, { ...host, applicationRouting: true })).toThrow(
    'application mapping'
  );
});
test('LAN sharing changes only the mixed listener while management stays local', () => {
  const value = config();
  value.allowLan = true;
  const shared = buildAndroidCoreConfig(value, host);
  expect(shared.inbounds?.find((inbound) => inbound.type === 'mixed')).toMatchObject({
    listen: '0.0.0.0',
  });
  expect(shared.services?.[0]).toMatchObject({ listen: '127.0.0.1' });
  value.allowLan = false;
  expect(
    buildAndroidCoreConfig(value, host).inbounds?.find((inbound) => inbound.type === 'mixed')
  ).toMatchObject({ listen: '127.0.0.1' });
});
