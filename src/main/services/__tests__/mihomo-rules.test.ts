import { buildMihomoUserRules } from '../mihomo-rules';
import type { Rule, UserConfig } from '../../../shared/types';

const domain: Rule = {
  id: 'domain',
  type: 'domainSuffix',
  values: ['claude.ai'],
  action: 'proxy',
  enabled: true,
};
const app: Rule = {
  id: 'application',
  type: 'processPathRegex',
  values: ['^/Applications/Firefox\\.app/.*$'],
  action: 'direct',
  enabled: true,
};
const config = (extra: Partial<UserConfig> = {}) =>
  ({ proxyMode: 'smart', customRules: [domain, app], ...extra }) as UserConfig;

it('keeps domain and application as separate ordered rules, including reordering', () => {
  expect(buildMihomoUserRules(config(), new Map())).toEqual([
    'DOMAIN-SUFFIX,claude.ai,proxy-selector',
    'PROCESS-PATH-REGEX,^/Applications/Firefox\\.app/.*$,DIRECT',
  ]);
  expect(buildMihomoUserRules(config({ customRules: [app, domain] }), new Map())[0]).toContain(
    'PROCESS-PATH-REGEX'
  );
});
it.each(['global', 'direct'] as const)('ignores user rules in forced %s mode', (proxyMode) => {
  expect(buildMihomoUserRules(config({ proxyMode }), new Map())).toEqual([]);
});
it('preserves OR inside one condition and AND between conditions', () => {
  const rule: Rule = {
    ...domain,
    conditions: [
      { type: 'domainSuffix', values: ['example.com', 'example.net'] },
      { type: 'port', values: ['443', '8000:9000'] },
    ],
    combineMode: 'and',
    targetServerId: 'specific',
  };
  expect(
    buildMihomoUserRules(config({ customRules: [rule] }), new Map([['specific', 'node-specific']]))
  ).toEqual([
    'AND,((OR,((DOMAIN-SUFFIX,example.com),(DOMAIN-SUFFIX,example.net))),(OR,((DST-PORT,443),(DST-PORT,8000-9000)))),node-specific',
  ]);
});
it('fails closed on unavailable targets, unsupported matchers and delimiter injection', () => {
  expect(() =>
    buildMihomoUserRules(
      config({ customRules: [{ ...domain, targetServerId: 'missing' }] }),
      new Map()
    )
  ).toThrow('unavailable');
  expect(() =>
    buildMihomoUserRules(config({ customRules: [{ ...domain, type: 'sourceMac' }] }), new Map())
  ).toThrow('Unsupported');
  expect(() =>
    buildMihomoUserRules(
      config({ customRules: [{ ...domain, values: ['example.com,DIRECT'] }] }),
      new Map()
    )
  ).toThrow('commas');
});

it('managed QUIC protection stays beside proxy rules and never precedes an earlier direct rule', () => {
  const rules = buildMihomoUserRules(
    config({
      customRules: [app, domain],
      servers: [{ id: 'node', name: 'Node', protocol: 'http', address: 'example.com', port: 443 }],
    }),
    new Map()
  );
  expect(rules[0]).toContain(',DIRECT');
  expect(rules[1]).toBe('AND,((DOMAIN-SUFFIX,claude.ai),(NETWORK,UDP),(DST-PORT,443)),REJECT');
  expect(rules[2]).toBe('DOMAIN-SUFFIX,claude.ai,proxy-selector');
});
