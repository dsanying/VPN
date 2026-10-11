import { protectProxyQuic } from '../../shared/runtime-policy';
import type { Rule, RuleCondition, UserConfig } from '../../shared/types';
import { unifiedUserRules } from '../../shared/unified-rules';

const matchers: Record<RuleCondition['type'], string> = {
  domain: 'DOMAIN',
  domainSuffix: 'DOMAIN-SUFFIX',
  domainKeyword: 'DOMAIN-KEYWORD',
  domainRegex: 'DOMAIN-REGEX',
  ipCidr: 'IP-CIDR',
  sourceIpCidr: 'SRC-IP-CIDR',
  port: 'DST-PORT',
  sourcePort: 'SRC-PORT',
  processName: 'PROCESS-NAME',
  processPath: 'PROCESS-PATH',
  processPathRegex: 'PROCESS-PATH-REGEX',
  geosite: 'GEOSITE',
  geoip: 'GEOIP',
  ruleSet: 'RULE-SET',
  sourceMac: '',
  sourceHostname: '',
};

function atom(condition: RuleCondition, value: string): string {
  let matcher = matchers[condition.type];
  if (!matcher) throw new Error(`Unsupported Mihomo rule condition: ${condition.type}`);
  if (!value.trim() || /[,\r\n]/.test(value))
    throw new Error('Rule value cannot be empty or contain commas/newlines');
  if (condition.type === 'ipCidr' && value.includes(':')) matcher = 'IP-CIDR6';
  if (condition.type === 'port' || condition.type === 'sourcePort') {
    const range = /^(\d+)(?:[-:](\d+))?$/.exec(value);
    if (
      !range ||
      Number(range[1]) < 1 ||
      Number(range[2] || range[1]) > 65535 ||
      Number(range[1]) > Number(range[2] || range[1])
    )
      throw new Error('Invalid rule port range');
    value = range[2] ? `${range[1]}-${range[2]}` : range[1];
  }
  return `${matcher},${value}`;
}

function expression(rule: Rule): string {
  const conditions = rule.conditions?.length
    ? rule.conditions
    : [{ type: rule.type, values: rule.values }];
  const groups = conditions.map((condition) => {
    if (!condition.values.length) throw new Error('Rule condition has no values');
    const atoms = condition.values.map((value) => atom(condition, value));
    return atoms.length === 1 ? atoms[0] : `OR,(${atoms.map((item) => `(${item})`).join(',')})`;
  });
  return groups.length === 1
    ? groups[0]
    : `${rule.combineMode === 'and' ? 'AND' : 'OR'},(${groups.map((item) => `(${item})`).join(',')})`;
}

/** One ordered table, first match wins. Forced modes never emit user/application rules. */
export function buildMihomoUserRules(
  config: UserConfig,
  names: Map<string, string>,
  proxyDestination?: (rule: Rule, member: string) => string
): string[] {
  if (config.proxyMode !== 'smart') return [];
  return unifiedUserRules(config)
    .filter((rule) => rule.enabled)
    .flatMap((rule) => {
      if (rule.tlsSpoof || rule.tlsSpoofMethod)
        throw new Error('Per-rule TLS spoof requires a compatibility route implementation');
      let destination =
        rule.action === 'block' ? 'REJECT' : rule.action === 'direct' ? 'DIRECT' : 'proxy-selector';
      if (rule.action === 'proxy' && rule.targetServerId) {
        const target = names.get(rule.targetServerId);
        if (!target) throw new Error('Rule target node is unavailable');
        destination = target;
      }
      if (rule.action === 'proxy' && proxyDestination)
        destination = proxyDestination(rule, destination);
      if (/[,\r\n]/.test(destination))
        throw new Error('Rule target name contains an unsupported delimiter');
      const matcher = expression(rule);
      const route = `${matcher},${destination}`;
      return rule.action === 'proxy' && protectProxyQuic(config)
        ? [`AND,((${matcher}),(NETWORK,UDP),(DST-PORT,443)),REJECT`, route]
        : [route];
    });
}

/** DNS bypass uses the same domain match semantics as the traffic rule. */
export function buildMihomoFakeIpBypass(config: UserConfig): string[] {
  if (config.proxyMode !== 'smart') return [];
  return unifiedUserRules(config)
    .filter((rule) => rule.enabled && rule.bypassFakeIP)
    .map((rule) => {
      const conditions = rule.conditions?.length
        ? rule.conditions
        : [{ type: rule.type, values: rule.values }];
      if (
        conditions.some(
          (condition) =>
            !['domain', 'domainSuffix', 'domainKeyword', 'domainRegex'].includes(condition.type)
        )
      )
        throw new Error('Fake IP bypass requires domain-only conditions');
      return `${expression(rule)},real-ip`;
    });
}
