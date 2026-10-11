import { protectProxyQuic, RUNTIME_POLICY } from '../../shared/runtime-policy';
import type { UserConfig } from '../../shared/types';
import { isIP } from 'net';
import type { CoreBridge } from '../../shared/core-capabilities';
import { isDirectSelection } from '../../shared/direct-selection';
import { localProxyPort } from '../../shared/proxy-ports';
import { effectiveBypassLan } from '../../shared/system-proxy-bypass';
import { resolveTunMtu, resolveTunStack } from '../../shared/tun-defaults';
import { effectiveRegionRouting } from '../../shared/region-routing';
import { effectiveBrowserDohKeywords } from '../../shared/browser-doh';
import {
  DEFAULT_FAKEIP_FILTER_DOMAINS,
  FAKEIP_INET4_RANGE,
  FAKEIP_INET6_RANGE,
} from '../../shared/fakeip-filter';
import { buildMihomoProxy } from './mihomo-proxy-builder';
import { buildMihomoUserRules, buildMihomoFakeIpBypass } from './mihomo-rules';

export interface MihomoConfigDeps {
  controllerPort: number;
  secret: string;
  dnsPort?: number;
  directPort?: number;
  proxyPort?: number;
  updatePort?: number;
  probePorts?: number[];
  nodeResolver?: string;
  bridges?: Map<string, CoreBridge>;
  dialPorts?: Map<string, number>;
  /** Converted, local classical rule providers; no implicit core geodata downloads. */
  ruleProviders?: Record<
    string,
    { type: 'file'; behavior: 'classical'; format: 'yaml'; path: string }
  >;
  countryProvider?: string;
}
export interface MihomoConfigResult {
  config: Record<string, unknown>;
  names: Map<string, string>;
  ruleTargets: Map<string, { selectorTag: string; memberTag: string }>;
}

/** Runtime generation only; stored node data and subscription credentials are never rewritten. */
export function buildMihomoMainConfig(
  user: UserConfig,
  deps: MihomoConfigDeps
): MihomoConfigResult {
  if (!deps.secret) throw new Error('Main core controller requires authentication');
  if (
    user.servers.some(
      (server, index) => user.servers.findIndex((other) => other.id === server.id) !== index
    )
  )
    throw new Error('Duplicate node identity');
  const names = new Map(
    user.servers.map((server) => [
      server.id,
      `node-${Buffer.from(server.id).toString('base64url')}`,
    ])
  );
  const selected = isDirectSelection(user.selectedServerId)
    ? 'DIRECT'
    : names.get(user.selectedServerId ?? '');
  if (!selected) throw new Error('Selected server not found');
  const proxies = user.servers.map((server) => {
    const dialer = server.detour ? names.get(server.detour) : undefined;
    if (server.detour && !dialer) throw new Error('Node chain target not found');
    return buildMihomoProxy(server, names.get(server.id)!, dialer, deps.bridges?.get(server.id));
  });
  for (const server of user.servers) {
    const visited = new Set<string>();
    let current = server;
    while (current.detour) {
      if (visited.has(current.id)) throw new Error('Node chain contains a cycle');
      visited.add(current.id);
      const next = user.servers.find((node) => node.id === current.detour);
      if (!next) throw new Error('Node chain target not found');
      current = next;
    }
  }
  const members = [...new Set([selected, ...names.values(), 'DIRECT'])];
  const groups: Record<string, unknown>[] = [
    { name: 'proxy-selector', type: 'select', proxies: members },
  ];
  const listeners: Record<string, unknown>[] = [];
  const listen = (name: string, port: number | undefined, proxy: string, type = 'http') => {
    if (port)
      listeners.push({
        name,
        type,
        listen: '127.0.0.1',
        port,
        proxy,
        udp: type === 'mixed' || type === 'socks',
      });
  };
  listen('probe-direct-in', deps.directPort, 'DIRECT', 'mixed');
  for (const [id, port] of deps.dialPorts ?? []) {
    const server = user.servers.find((node) => node.id === id);
    const target = server?.detour ? names.get(server.detour) : undefined;
    if (!target) throw new Error('Compatibility dial chain target not found');
    listen(`compat-dial-${Buffer.from(id).toString('base64url')}`, port, target, 'mixed');
  }
  listen('probe-proxy-in', deps.proxyPort, 'proxy-selector');
  listen(
    'update-in',
    deps.updatePort,
    user.mainSessionViaProxy === false || user.proxyMode === 'direct' ? 'DIRECT' : 'proxy-selector',
    'socks'
  );
  for (const [index, port] of (deps.probePorts ?? []).entries()) {
    groups.push({ name: `probe-selector-${index}`, type: 'select', proxies: members });
    listen(`probe-in-${index}`, port, `probe-selector-${index}`);
  }
  const rules: string[] = [];
  if (user.proxyMode !== 'direct') {
    for (const keyword of effectiveBrowserDohKeywords(user)) {
      if (/[,\r\n]/.test(keyword)) throw new Error('Invalid browser DNS keyword');
      rules.push(`AND,((DOMAIN-KEYWORD,${keyword}),(OR,((DST-PORT,443),(DST-PORT,853)))),REJECT`);
    }
  }
  const ruleTargets = new Map<string, { selectorTag: string; memberTag: string }>();
  rules.push(
    ...buildMihomoUserRules(user, names, (rule, memberTag) => {
      const selectorTag = `rule-sel-${Buffer.from(rule.id).toString('base64url')}`;
      groups.push({
        name: selectorTag,
        type: 'select',
        proxies: [...new Set([memberTag, 'proxy-selector', ...names.values(), 'DIRECT'])],
      });
      ruleTargets.set(`custom:${rule.id}`, { selectorTag, memberTag });
      return selectorTag;
    })
  );
  if (user.proxyMode === 'smart') {
    for (const value of effectiveBypassLan(user)) {
      if (/[\r\n,]/.test(value)) throw new Error('Invalid LAN bypass entry');
      rules.push(
        value.includes('/')
          ? `${value.includes(':') ? 'IP-CIDR6' : 'IP-CIDR'},${value},DIRECT,no-resolve`
          : `DOMAIN-SUFFIX,${value.replace(/^\*\./, '')},DIRECT`
      );
    }
    const region = effectiveRegionRouting(user);
    if (region.enabled) {
      if (!deps.countryProvider || !deps.ruleProviders?.[deps.countryProvider])
        throw new Error('Active country routing data is not prepared');
      rules.push(
        `RULE-SET,${deps.countryProvider},${region.reverse ? 'proxy-selector' : 'DIRECT'}`
      );
    }
  }
  if (protectProxyQuic(user)) rules.push('AND,((NETWORK,UDP),(DST-PORT,443)),REJECT');
  rules.push(`MATCH,${user.proxyMode === 'direct' ? 'DIRECT' : 'proxy-selector'}`);
  const domestic = user.dnsConfig?.domesticDns || 'https://doh.pub/dns-query';
  const foreign = user.dnsConfig?.foreignDns || 'https://dns.google/dns-query';
  const nodeBootstrap = deps.nodeResolver || domestic;
  // Entry probes need real node addresses even when application DNS uses fake IPs.
  // The same bootstrap resolver serves core dialling and ordinary lookups of node hosts.
  const nodeDomains = [
    ...new Set(
      proxies
        .map((proxy) => proxy.server)
        .filter((host): host is string => typeof host === 'string' && !isIP(host))
    ),
  ];
  if (nodeDomains.some((host) => /[,\r\n]/.test(host))) throw new Error('Invalid node hostname');
  if (nodeDomains.length && nodeBootstrap.includes('#'))
    throw new Error('Node bootstrap resolver must not contain a proxy selection');
  const dns: Record<string, unknown> = {
    enable: true,
    ipv6: user.enableIPv6 === true,
    'respect-rules': true,
    'cache-algorithm': 'arc',
    'enhanced-mode': RUNTIME_POLICY.fakeIp ? 'fake-ip' : 'redir-host',
    'default-nameserver': ['223.5.5.5', '119.29.29.29'],
    'proxy-server-nameserver': [nodeBootstrap],
    ...(nodeDomains.length
      ? {
          'nameserver-policy': Object.fromEntries(
            nodeDomains.map((host) => [host, [`${nodeBootstrap}#DIRECT`]])
          ),
        }
      : {}),
    'direct-nameserver': [domestic],
    nameserver: [user.proxyMode === 'direct' ? domestic : `${foreign}#proxy-selector`],
    'fake-ip-range': FAKEIP_INET4_RANGE,
    ...(user.enableIPv6 ? { 'fake-ip-range6': FAKEIP_INET6_RANGE } : {}),
    'fake-ip-filter-mode': 'rule',
    'fake-ip-filter': [
      ...nodeDomains.map((host) => `DOMAIN,${host},real-ip`),
      ...buildMihomoFakeIpBypass(user),
      ...(user.fakeIpFilter === false
        ? []
        : [
            ...(user.fakeIpFilterList ?? DEFAULT_FAKEIP_FILTER_DOMAINS).map((domain) => {
              if (/[,\r\n]/.test(domain)) throw new Error('Invalid fake IP exception');
              return `DOMAIN-SUFFIX,${domain.replace(/^\*\./, '')},real-ip`;
            }),
            'DOMAIN-KEYWORD,ntp,real-ip',
            'DOMAIN-KEYWORD,stun,real-ip',
          ]),
      'MATCH,fake-ip',
    ],
    ...(deps.dnsPort ? { listen: `127.0.0.1:${deps.dnsPort}` } : {}),
  };
  const config: Record<string, unknown> = {
    mode: 'rule',
    'mixed-port': localProxyPort(user),
    'allow-lan': user.allowLan === true,
    'bind-address': user.allowLan ? '*' : '127.0.0.1',
    ipv6: user.enableIPv6 === true,
    'external-controller': `127.0.0.1:${deps.controllerPort}`,
    secret: deps.secret,
    'find-process-mode': 'always',
    'log-level': RUNTIME_POLICY.logLevel,
    'geo-auto-update': false,
    profile: { 'store-selected': false, 'store-fake-ip': true },
    sniffer: {
      enable: true,
      'parse-pure-ip': true,
      'force-dns-mapping': true,
      sniff: {
        HTTP: { ports: [80, '8080-8880'] },
        TLS: { ports: [443, 8443] },
        QUIC: { ports: [443, 8443] },
      },
    },
    proxies,
    'proxy-groups': groups,
    listeners,
    rules,
    dns,
    ...(deps.ruleProviders ? { 'rule-providers': deps.ruleProviders } : {}),
  };
  if (user.proxyModeType === 'tun') {
    const stack = resolveTunStack(user.tunConfig?.stack, process.platform);
    config.tun = {
      enable: true,
      stack,
      mtu: resolveTunMtu(user.tunConfig?.mtu, process.platform, stack),
      'auto-route': user.tunConfig?.autoRoute !== false,
      'strict-route': user.tunConfig?.strictRoute !== false,
      'auto-detect-interface': true,
      'dns-hijack': ['any:53', 'tcp://any:53'],
      ...(user.tunConfig?.interfaceName ? { device: user.tunConfig.interfaceName } : {}),
      ...(user.tunConfig?.inet6Address ? { 'inet6-address': [user.tunConfig.inet6Address] } : {}),
    };
    // These settings need platform-specific translation, not silent omission.
    if (
      user.tunConfig?.inet4Address ||
      user.tunConfig?.inboundExcludeCidrs?.length ||
      user.tunConfig?.macFilterList?.length ||
      user.tunConfig?.neighborDomains?.length
    )
      throw new Error('Advanced TUN settings require platform adaptation');
  }
  return { config, names, ruleTargets };
}
