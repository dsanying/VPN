import { prepareAutomaticTakeover } from '../automatic-takeover';
import type { UserConfig, Rule } from '../types';

const base = (): UserConfig => ({
  autoStart: false,
  silentStart: false,
  autoConnect: false,
  minimizeToTray: true,
  autoLightweightMode: false,
  servers: [],
  selectedServerId: null,
  customRules: [],
  appRules: [],
  customAppPresets: [],
  proxyMode: 'smart',
  proxyModeType: 'manual',
  appRoutingEnabled: true,
  tunConfig: { autoRoute: false, mtu: 'auto', stack: 'auto', strictRoute: true },
  dnsConfig: {
    domesticDns: 'https://example.com/dns-query',
    foreignDns: 'https://example.com/dns-query',
  },
});
const withApplication = (): UserConfig => ({
  ...base(),
  appRules: [{ appId: 'example', enabled: true, action: 'proxy' }],
  customAppPresets: [
    {
      id: 'example',
      name: 'Example',
      emoji: '',
      geositeTags: [],
      processPathRegex: ['^/Applications/Example\\.app/'],
      installedApplication: {
        id: 'example',
        name: 'Example',
        path: '/Applications/Example.app',
        processPaths: [],
        processPathRegex: ['^/Applications/Example\\.app/'],
        coverage: 'bundle',
      },
    },
  ],
});
it('all incoming takeover modes become TUN in every routing mode', () => {
  for (const proxyModeType of ['manual', 'tun', 'systemProxy'] as const)
    for (const proxyMode of ['smart', 'global', 'direct'] as const) {
      const result = prepareAutomaticTakeover({ ...base(), proxyModeType, proxyMode });
      expect(result.proxyModeType).toBe('tun');
      expect(result.proxyMode).toBe(proxyMode);
      expect(result.tunConfig.autoRoute).toBe(true);
    }
});
it('application rules preserve their identity and do not change takeover policy', () => {
  const original = withApplication();
  const result = prepareAutomaticTakeover(original);
  for (const key of ['servers', 'appRules', 'customAppPresets'] as const)
    expect(result[key]).toBe(original[key]);
  expect(original.proxyModeType).toBe('manual');
  expect(original.tunConfig.autoRoute).toBe(false);
  expect(prepareAutomaticTakeover(result)).toBe(result);
});
it('removing application rules never falls back to system proxy', () => {
  for (const patch of [{ appRoutingEnabled: false }, { appRules: [] }, { customAppPresets: [] }])
    expect(prepareAutomaticTakeover({ ...withApplication(), ...patch }).proxyModeType).toBe('tun');
});
it('system DNS takeover is disabled while internal resolver settings are preserved', () => {
  for (const takeoverSystemDns of [undefined, false, true]) {
    const original = base();
    original.dnsConfig!.takeoverSystemDns = takeoverSystemDns;
    const result = prepareAutomaticTakeover(original);
    expect(result.dnsConfig).toEqual({ ...original.dnsConfig, takeoverSystemDns: false });
    expect(original.dnsConfig!.takeoverSystemDns).toBe(takeoverSystemDns);
  }
});
it('legacy force flag is cleared without releasing TUN', () => {
  const result = prepareAutomaticTakeover({ ...base(), forceTun: true });
  expect(result.forceTun).toBe(false);
  expect(result.proxyModeType).toBe('tun');
});
it('custom process conditions are preserved whether enabled or dormant', () => {
  const rule: Rule = {
    id: 'example',
    type: 'domain',
    values: ['example.com'],
    enabled: true,
    action: 'direct',
    conditions: [
      { type: 'processPath', values: ['/Applications/Example.app/Contents/MacOS/example'] },
    ],
  };
  for (const enabled of [true, false]) {
    const config = { ...base(), customRules: [{ ...rule, enabled }] };
    const result = prepareAutomaticTakeover(config);
    expect(result.customRules).toBe(config.customRules);
    expect(result.proxyModeType).toBe('tun');
  }
});
