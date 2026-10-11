import { routingDataNeeds } from '../routing-data-needs';
import { clearRetiredConfigData } from '../retired-config-data';
import type { UserConfig } from '../types';

const config = (over: Record<string, unknown> = {}) =>
  ({
    servers: [],
    customRules: [],
    proxyMode: 'smart',
    regionRouting: { automatic: true, enabled: true, region: 'jp', reverse: false },
    ...over,
  }) as unknown as UserConfig;

it('only requests the detected country and LAN data; application rules add no lists', () => {
  const cfg = config({
    appRoutingEnabled: true,
    appRules: [{ appId: 'youtube', enabled: true, action: 'proxy' }],
    customAppPresets: [{ id: 'youtube', geositeTags: ['youtube'], geoipTags: ['netflix'] }],
  });
  expect([...routingDataNeeds(cfg).tags].sort()).toEqual(['geoip-jp', 'geosite-private']);
});
it('global skips country data; direct with LAN bypass disabled needs no data', () => {
  expect([...routingDataNeeds(config({ proxyMode: 'global' })).tags]).toEqual(['geosite-private']);
  expect(routingDataNeeds(config({ proxyMode: 'direct', bypassLAN: false })).tags.size).toBe(0);
});
it('location detection failure never downloads a guessed country', () => {
  expect([
    ...routingDataNeeds(
      config({ regionRouting: { automatic: true, enabled: false, region: '' }, bypassLAN: false })
    ).tags,
  ]).toEqual([]);
});
it('discards retired fields and complete dependent rules, keeping unrelated nodes and routing', () => {
  const nodes = [{ id: 'example', protocol: 'vless', address: 'example.com' }];
  const plain = {
    id: 'plain',
    type: 'domainSuffix',
    enabled: true,
    values: ['example.com'],
    action: 'proxy',
  };
  const cfg = config({
    servers: nodes,
    ruleResources: [{ id: 'removed' }],
    builtinGeoMeta: {},
    ruleResourceAutoUpdate: false,
    ruleResourceUpdateIntervalHours: 12,
    customRuleSets: [{ id: 'removed' }],
    customRules: [
      plain,
      {
        id: 'removed',
        type: 'domain',
        enabled: true,
        conditions: [
          { type: 'domain', values: ['example.com'] },
          { type: 'ruleSet', values: ['res:removed'] },
        ],
      },
    ],
  });
  expect(clearRetiredConfigData(cfg)).toBe(true);
  expect(cfg.customRules).toEqual([plain]);
  expect(cfg.servers).toBe(nodes);
  for (const field of [
    'ruleResources',
    'builtinGeoMeta',
    'ruleResourceAutoUpdate',
    'ruleResourceUpdateIntervalHours',
  ])
    expect(cfg).not.toHaveProperty(field);
  expect(cfg.customRuleSets).toEqual([]);
  expect(clearRetiredConfigData(cfg)).toBe(false);
});
it('removes service presets and rules instead of leaving hidden compatibility records', () => {
  const identity = {
    id: 'installed',
    name: 'Example',
    path: '/Applications/Example.app',
    processPaths: [],
    processPathRegex: ['^/Applications/Example\\.app/'],
    coverage: 'bundle',
  };
  const cfg = config({
    customAppPresets: [
      {
        id: 'installed',
        name: 'Example',
        geositeTags: ['youtube'],
        geoipTags: ['us'],
        installedApplication: identity,
      },
      { id: 'service', geositeTags: ['telegram'] },
    ],
    appRules: [
      { appId: 'service', enabled: true },
      { appId: 'installed', enabled: true },
    ],
  });
  clearRetiredConfigData(cfg);
  expect(cfg.appRules?.map((rule) => rule.appId)).toEqual(['installed']);
  expect(cfg.customAppPresets).toHaveLength(1);
  expect(cfg.customAppPresets?.[0]).toMatchObject({
    installedApplication: identity,
    geositeTags: [],
  });
  expect(cfg.customAppPresets?.[0].geoipTags).toBeUndefined();
  expect(clearRetiredConfigData(cfg)).toBe(false);
});
