import type { ServerConfig, UserConfig } from './types';
import type {
  SingBoxConfig,
  SingBoxEndpoint,
  SingBoxOutbound,
  SingBoxRouteRule,
} from './singbox-config-types';
import { buildProxyOutbound } from './singbox-proxy-outbound';
import { buildWireGuardEndpoint, buildTailscaleEndpoint } from './singbox-endpoints';
import { compatibilityEngine, type CoreBridge } from './core-capabilities';
import { meshUsesSystemInterface } from './endpoint-routes';
import { isDirectSelection } from './direct-selection';
import { DEFAULT_DNS_ENDPOINTS, parseDnsServerSpec } from './dns';
import { applicationRuleValues, unifiedUserRules } from './unified-rules';
import { planCustomRule } from './rule-compilation';
import { serverDetourChain } from './server-detour-chain';
import { localProxyPort, controlApiPort } from './proxy-ports';

export interface AndroidCoreHost {
  /** Native app-owned absolute directory, never a path supplied by imported configuration. */
  stateDirectory: string;
  bridges?: Map<string, CoreBridge>;
  /** Verified region data prepared by the host; smart routing cannot silently omit it. */
  localRegionRuleSet?: { tag: string; path: string; format: 'binary' | 'source' };
  applicationRouting?: boolean;
}
function tagFor(server: ServerConfig): string {
  return `node-${server.id}`;
}

/** Android assembly uses the same protocol and rule compilers as desktop, with explicit host facts. */
export function buildAndroidCoreConfig(config: UserConfig, host: AndroidCoreHost): SingBoxConfig {
  if (!host.stateDirectory.startsWith('/') || host.stateDirectory.includes('..'))
    throw new Error('Invalid native state directory');
  const ids = new Set<string>();
  const tags = new Map<string, string>();
  for (const server of config.servers) {
    if (!server.id || ids.has(server.id)) throw new Error('Invalid or duplicate server identity');
    ids.add(server.id);
    tags.set(server.id, tagFor(server));
  }
  const selected = isDirectSelection(config.selectedServerId)
    ? 'direct'
    : config.selectedServerId
      ? tags.get(config.selectedServerId)
      : undefined;
  if (config.proxyMode !== 'direct' && !selected) throw new Error('A valid exit must be selected');
  // Only exits used by the current selection or enabled rules belong to this tunnel.
  // An imported, inactive node must not require an unavailable compatibility engine.
  const activeIds = new Set<string>();
  const requireExit = (id: string) => {
    const server = config.servers.find((candidate) => candidate.id === id);
    if (!server) throw new Error('Rule target does not exist');
    for (const dependency of serverDetourChain(server, config.servers))
      activeIds.add(dependency.id);
  };
  if (config.proxyMode !== 'direct') {
    if (selected !== 'direct' && config.selectedServerId) requireExit(config.selectedServerId);
    for (const rule of unifiedUserRules(config))
      if (
        rule.enabled &&
        rule.action === 'proxy' &&
        rule.targetServerId &&
        planCustomRule(rule).kind !== 'ext-skip'
      )
        requireExit(rule.targetServerId);
  }
  const activeServers = config.servers.filter((server) => activeIds.has(server.id));
  const endpoints: SingBoxEndpoint[] = [];
  const outbounds: SingBoxOutbound[] = [{ type: 'direct', tag: 'direct' }];
  for (const server of activeServers) {
    if (meshUsesSystemInterface(server))
      throw new Error('Android cannot create privileged mesh system interfaces');
    if (server.protocol === 'wireguard')
      endpoints.push(buildWireGuardEndpoint(server, tags.get(server.id)!, 'dns-native', 'android'));
    else if (server.protocol === 'tailscale') {
      if (!/^[a-zA-Z0-9_-]+$/.test(server.id)) throw new Error('Invalid mesh state identity');
      endpoints.push(
        buildTailscaleEndpoint(
          server,
          tags.get(server.id)!,
          `${host.stateDirectory}/tailscale-${server.id}`,
          'android'
        )
      );
    } else {
      if (compatibilityEngine(server) && !host.bridges?.has(server.id))
        throw new Error(`Compatibility engine is unavailable for ${server.protocol}`);
      outbounds.push(
        buildProxyOutbound(
          server,
          tags,
          { server: 'dns-native', strategy: 'prefer_ipv4' },
          host.bridges,
          { platform: 'android', arch: 'arm64' }
        )
      );
    }
  }
  for (const server of activeServers) {
    if (!server.detour) continue;
    if (host.bridges?.has(server.id))
      throw new Error('Android compatibility engine cannot apply this proxy chain');
    const outbound = outbounds.find((candidate) => candidate.tag === tags.get(server.id));
    if (outbound) outbound.detour = tags.get(server.detour);
    else {
      const endpoint = endpoints.find((candidate) => candidate.tag === tags.get(server.id));
      if (!endpoint || endpoint.type !== 'wireguard')
        throw new Error('Android endpoint cannot apply this proxy chain');
      endpoint.detour = tags.get(server.detour);
    }
  }
  if (config.proxyMode !== 'direct' && selected && selected !== 'direct')
    outbounds.push({
      type: 'selector',
      tag: 'proxy-selector',
      outbounds: [...activeServers.map((server) => tags.get(server.id)!), 'direct'],
      default: selected,
    });
  const final =
    config.proxyMode === 'direct' || selected === 'direct' ? 'direct' : 'proxy-selector';
  const rules: SingBoxRouteRule[] = [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
    { ip_is_private: true, action: 'route', outbound: 'direct' },
  ];
  if (config.proxyMode !== 'direct')
    for (const rule of unifiedUserRules(config).filter((rule) => rule.enabled)) {
      const conditions = rule.conditions ?? [{ type: rule.type, values: rule.values }];
      // 多应用规则（applications 数组）仅在全部应用同属一个 Android 包名时能映射为原生 package 规则；
      // 混入桌面可执行档应用（coverage!=='package'）则 packageName 为空 → 走既有的「需应用映射」报错路径。
      const applications = rule.applications ?? [];
      const packageApps =
        applications.length > 0 && applications.every((app) => app.coverage === 'package')
          ? applications
          : [];
      const packageNames = new Set(packageApps.map((app) => app.packageName));
      const packageName = packageNames.size === 1 ? packageApps[0]!.packageName : undefined;
      const packageValues = packageName
        ? new Set(packageApps.flatMap(applicationRuleValues))
        : new Set<string>();
      const nativePackageRule =
        !!packageName &&
        conditions.some((condition) => condition.type === 'processPathRegex') &&
        /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName) &&
        conditions
          .filter((condition) => condition.type === 'processPathRegex')
          .every(
            (condition) =>
              condition.values.length > 0 &&
              condition.values.every((value) => packageValues.has(value))
          );
      if (nativePackageRule && host.applicationRouting !== true)
        throw new Error('Android application ownership is unavailable on this device');
      if (
        conditions.some(
          (condition) =>
            [
              'processName',
              'processPath',
              'processPathRegex',
              'sourceMac',
              'sourceHostname',
            ].includes(condition.type) &&
            !(condition.type === 'processPathRegex' && nativePackageRule)
        )
      )
        throw new Error('Desktop process or device rules require Android application mapping');
      if (rule.tlsSpoof || rule.tlsSpoofMethod)
        throw new Error('Android arm64 cannot apply TLS spoofing rules');
      const plan = planCustomRule(rule);
      if (plan.kind === 'ext-skip') continue;
      if (plan.kind !== 'ext')
        throw new Error('Unsupported rule must be mapped before starting Android VPN');
      const outbound =
        rule.action === 'direct'
          ? 'direct'
          : rule.targetServerId
            ? tags.get(rule.targetServerId)
            : final;
      if (rule.action === 'proxy' && !outbound) throw new Error('Rule target does not exist');
      const androidMatcher = (matcher: Record<string, unknown>): Record<string, unknown> => {
        const { process_path_regex: paths, rules: nested, ...rest } = matcher;
        if (paths && !nativePackageRule)
          throw new Error('Desktop application matcher is unavailable on Android');
        return {
          ...rest,
          ...(paths ? { package_name: [packageName] } : {}),
          ...(Array.isArray(nested)
            ? { rules: nested.map((child) => androidMatcher(child as Record<string, unknown>)) }
            : {}),
        };
      };
      for (const matcher of plan.fileRules)
        rules.push({
          ...androidMatcher(matcher as Record<string, unknown>),
          ...(rule.action === 'block' ? { action: 'reject' } : { action: 'route', outbound }),
        } as SingBoxRouteRule);
    }
  if (config.proxyMode === 'smart') {
    if (!host.localRegionRuleSet) throw new Error('Smart routing data is not ready');
    rules.push({ rule_set: host.localRegionRuleSet.tag, action: 'route', outbound: 'direct' });
  }
  const dnsEndpoint = (value: string | undefined, tag: string, detour: string) => {
    const parsed = parseDnsServerSpec(value);
    if (!parsed) throw new Error('Invalid configured DNS endpoint');
    return {
      type: parsed.type,
      tag,
      server: parsed.server,
      server_port: parsed.port,
      ...(parsed.path ? { path: parsed.path } : {}),
      ...(parsed.isDomain ? { domain_resolver: 'dns-native' } : {}),
      detour,
    };
  };
  const dnsFinal = final === 'direct' ? 'dns-direct' : 'dns-proxy';
  return {
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [
        { type: 'local', tag: 'dns-native' },
        dnsEndpoint(
          config.dnsConfig?.domesticDns ?? DEFAULT_DNS_ENDPOINTS.direct,
          'dns-direct',
          'direct'
        ),
        dnsEndpoint(
          config.dnsConfig?.foreignDns ?? DEFAULT_DNS_ENDPOINTS.proxy,
          'dns-proxy',
          final
        ),
      ],
      final: dnsFinal,
      strategy: config.enableIPv6 ? 'prefer_ipv4' : 'ipv4_only',
      reverse_mapping: true,
    },
    inbounds: [
      {
        type: 'tun',
        tag: 'tun-in',
        address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
        mtu: 1500,
        stack: 'mixed',
        auto_route: true,
        strict_route: true,
      },
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: config.allowLan ? '0.0.0.0' : '127.0.0.1',
        listen_port: localProxyPort(config),
      },
    ],
    outbounds,
    ...(endpoints.length ? { endpoints } : {}),
    route: {
      auto_detect_interface: true,
      default_domain_resolver: 'dns-native',
      final,
      rules,
      ...(host.localRegionRuleSet && config.proxyMode === 'smart'
        ? { rule_set: [{ type: 'local', ...host.localRegionRuleSet }] }
        : {}),
    },
    services: [
      {
        type: 'api',
        listen: '127.0.0.1',
        listen_port: controlApiPort(config),
        secret: config.clashApiSecret,
      },
    ],
  };
}
