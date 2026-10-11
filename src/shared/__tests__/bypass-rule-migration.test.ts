import { migrateBypassRules } from '../bypass-rule-migration';
import type { UserConfig } from '../types';

const config = (overrides: Partial<UserConfig> = {}) =>
  ({
    servers: [],
    subscriptions: [],
    customRules: [],
    ...overrides,
  }) as UserConfig;

describe('consolidate direct exceptions into routing rules', () => {
  it('preserves private bypasses, exact hosts, wildcard semantics and IP address prefixes', () => {
    const original = config({
      bypassLANList: [
        '10.0.0.0/8',
        '*.local',
        'example.com',
        '*.example.org',
        '203.0.113.1',
        '2001:db8::1',
        '203.0.113.0/24',
      ],
    });
    const next = migrateBypassRules(original);
    expect(next.bypassLANList).toEqual(['10.0.0.0/8', '*.local']);
    expect(next.customRules?.map((rule) => [rule.type, rule.values[0]])).toEqual([
      ['domain', 'example.com'],
      ['domainRegex', '^.*\\.example\\.org$'],
      ['ipCidr', '203.0.113.1/32'],
      ['ipCidr', '2001:db8::1/128'],
      ['ipCidr', '203.0.113.0/24'],
    ]);
    expect(next.customRules?.every((rule) => rule.action === 'direct' && rule.enabled)).toBe(true);
    expect(original.customRules).toEqual([]);
    expect(migrateBypassRules(next)).toBe(next);
  });
  it('keeps old priority and disabled state without overwriting existing rules or credentials', () => {
    const oldRule = {
      id: 'migrated-bypass-0',
      type: 'domain' as const,
      values: ['example.com'],
      action: 'proxy' as const,
      enabled: true,
    };
    const old = config({
      bypassLAN: false,
      bypassLANList: ['example.com', 'example.com'],
      customRules: [oldRule],
    });
    const next = migrateBypassRules(old);
    expect(next.customRules).toEqual([
      {
        id: 'migrated-bypass-1',
        type: 'domain',
        values: ['example.com'],
        action: 'direct',
        enabled: false,
      },
      oldRule,
    ]);
    expect(next.servers).toBe(old.servers);
    expect(next.subscriptions).toBe(old.subscriptions);
  });
  it('retains unsupported entries rather than broadening them or discarding them', () => {
    const next = migrateBypassRules(
      config({
        bypassLANList: [
          'https://example.com/path',
          'https://*.example.com',
          '<local>',
          'example.com',
        ],
      })
    );
    expect(next.bypassLANList).toEqual([
      'https://example.com/path',
      'https://*.example.com',
      '<local>',
    ]);
    expect(next.customRules).toHaveLength(1);
  });
  it('leaves malformed legacy lists intact for recovery', () => {
    const old = config({ bypassLANList: ['example.com', null] as unknown as string[] });
    expect(migrateBypassRules(old)).toBe(old);
  });
  it('does not manufacture custom rules from absent or deliberately empty settings', () => {
    for (const old of [
      config(),
      config({ bypassLANList: [] }),
      config({ bypassLANList: ['localhost', '192.168.0.0/16'] }),
    ])
      expect(migrateBypassRules(old)).toBe(old);
  });
});
