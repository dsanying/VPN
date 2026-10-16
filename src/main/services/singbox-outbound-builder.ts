import {
  buildWireGuardEndpoint as buildPortableWireGuardEndpoint,
  buildTailscaleEndpoint as buildPortableTailscaleEndpoint,
} from '../../shared/singbox-endpoints';
import { buildProxyOutbound as buildPortableProxyOutbound } from '../../shared/singbox-proxy-outbound';
export { shouldEmitTlsEngine } from '../../shared/singbox-proxy-outbound';
/**
 * 代理 Outbound 构造（sing-box 1.12.x / 1.13.x）—— 从 ProxyManager 抽出（SingBoxConfigBuilder 抽取 Phase 2 step 2）。
 * 纯函数簇、零实例状态：只读入参 server / idToTagMap / nodeResolverTag，被 config-gen（generateOutbounds）
 * 与测速（buildSpeedTestOutbound）共用。逐协议字段映射 + TLS/Reality/传输层 + PR-6 抗封后处理。
 */

import { compatibilityEngine, type CoreBridge } from '../../shared/core-capabilities';
import type { ServerConfig, UserConfig, InvalidNodeInfo } from '../../shared/types';
import type {
  SingBoxOutbound,
  SingBoxEndpoint,
  SingBoxDomainResolver,
} from './singbox-config-types';
import { resourceManager } from './ResourceManager';
import {
  isEndpointProtocol,
  meshNodeCarriesFullTunnel,
  meshUsesSystemInterface,
  isMeshNodeUnroutable,
} from '../../shared/endpoint-routes';
import { tailscaleStateDir } from './tailscale-state';
import {
  effectiveCustomRules,
  effectiveAppRules,
  getNodeDialDomainResolver,
  getDomesticResolverTag,
} from './singbox-config-helpers';
import { isDirectSelection, resolveGlobalExitTag } from '../../shared/direct-selection';

/** Reason reported when a mesh node is deliberately limited to its private routes. */
function meshNonFullTunnelReason(): string {
  // 与 meshNodeCarriesFullTunnel 对齐:全隧道能力 = 允许外网,与接入模式正交(system 不再禁,出口路由托管)。
  // 故唯一不承载原因 = 关外网。
  return '已关闭外网访问';
}

/** 节点是否可用：naive 需要 libcronet 核心库，缺库时不可用（会被跳过、分流/选中回退到 selector）。 */
export function isNodeUsable(server: ServerConfig): boolean {
  if (server.protocol.toLowerCase() === 'naive' && !resourceManager.hasCronetLib()) {
    return false;
  }
  return true;
}

/**
 * selector default 被剔除后的兜底：rule-sel 回 proxy-selector（嵌套），proxy-selector 落剩余首节点（MED-1）。
 * proxy-selector 成员被剔光（remainingOutbounds 空）时无有效成员可选 → 返 undefined（不伪造默认掩盖「无节点」）；
 * 该退化态由调用方 buildOutbounds「proxy-selector 空 → throw 没有可用的代理节点出站」守卫拦截，不会下发非法
 * config。返回类型如实标 `string | undefined`，避免签名谎称恒返 string。
 */
export function prunedSelectorDefault(
  tag: string | undefined,
  remainingOutbounds: string[]
): string | undefined {
  return tag?.startsWith('rule-sel-') ? 'proxy-selector' : remainingOutbounds[0];
}

/**
 * WireGuard endpoint 构造（sing-box 1.11+ 顶层 endpoints[]）。config-gen 与测速共用。
 *
 * #58：peer.address 为【域名】时（如 WARP engage.cloudflareclient.com）必须给 endpoint 顶层 dial 级
 * domain_resolver，否则 sing-box 1.14 起域名无确定解析上游 → 拨号解析失败/超时（实测：WARP 测速超时，
 * Dalutone IP-server 正常）。与 buildProxyOutbound 的 outbound.domain_resolver 同口径。调用方传解析器
 * tag（config-gen：getNodeDialDomainResolver(config)；测速：'dns-direct'）。
 * IP 字面量 server 不需 DNS 解析 → 不下发该字段（保持配置精简，且 IP 路径本就不受影响）。
 *
 * 形态由调用方决定（本函数保持纯透传）：字符串 = 仅指定 tag；结构化 = 附带 strategy 覆盖顶层
 * dns.strategy，供关 IPv6 时解锁 AAAA-only 域名节点（见 getNodeDialDomainResolver）。
 */
export function buildWireGuardEndpoint(
  server: ServerConfig,
  tag: string,
  domainResolverTag?: SingBoxDomainResolver
): SingBoxEndpoint {
  return buildPortableWireGuardEndpoint(server, tag, domainResolverTag, process.platform);
}

/**
 * 生成代理 Outbound 配置（sing-box 1.12.x / 1.13.x 兼容格式）
 */
export function buildProxyOutbound(
  server: ServerConfig,
  idToTagMap: Map<string, string>,
  nodeResolverTag: SingBoxDomainResolver,
  bridges?: Map<string, CoreBridge>
): SingBoxOutbound {
  return buildPortableProxyOutbound(server, idToTagMap, nodeResolverTag, bridges, {
    platform: process.platform,
    arch: process.arch,
  });
}

export interface PendingRuleSelector {
  ruleKey: string;
  selectorTag: string;
  memberTag: string;
  targetServerId?: string;
}

/** 注入依赖：generateOutbounds 原读/写的实例态（gateInvalidNodes Map 就地改 / log 回调）。 */
export interface OutboundsDeps {
  bridges?: Map<string, CoreBridge>;
  gateInvalidNodes: Map<string, InvalidNodeInfo>;
  log: (level: 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: string) => void;
  // Phase 2：本次启动 sing-box 是否会以提权运行（内核接口可创建）= TUN 模式 + helper。缺省 undefined/false
  // （preflight/speedtest/snapshot/系统代理路径）→ reverseMesh 节点不发射（system:true 需提权，否则启动 FATAL）。
  systemInterfaceAvailable?: boolean;
  // §15 主核测速探测池：K 个 probe-selector-k selector 的端口数（allocateProbePorts 3+K 产出）。空/缺省=不注入池。
  probePoolPorts?: number[];
}

/**
 * 构造 Tailscale endpoint（sing-box 1.12+ 顶层 endpoints[]）。账号制 mesh，无 server address/port。
 * 默认 tsnet 用户态（system_interface 省略=false，零提权）；auth_key 可选（无则核日志出登录 URL）。
 */
export function buildTailscaleEndpoint(server: ServerConfig, tag: string): SingBoxEndpoint {
  const directory = tailscaleStateDir(server.id);
  try {
    require('fs').mkdirSync(directory, { recursive: true });
  } catch {
    /* The core reports filesystem failures. */
  }
  return buildPortableTailscaleEndpoint(server, tag, directory, process.platform);
}

/**
 * rule-sel selector 生成：所有 proxy 规则（custom + app）各建独立 selector（anti-drift 热切换）。
 * pendingRuleSelectors 为 buildOutbounds 传入的载体（push 收集），由 generateSingBoxConfig 回填 currentRuleTargetMap。
 */
function generateRuleSelectors(
  config: UserConfig,
  idToTagMap: Map<string, string>,
  nodeTags: string[],
  outbounds: SingBoxOutbound[],
  pendingRuleSelectors: PendingRuleSelector[]
): void {
  const existingTags = new Set(outbounds.map((o) => o.tag).filter((t): t is string => !!t));
  const interrupt = config.interruptConnectionsOnSwitch === true;
  // (selectorTag, memberTag) 收集，供 generateSingBoxConfig 末尾回填 currentRuleTargetMap。
  pendingRuleSelectors.length = 0;

  // rule-sel 恒存在（所有 proxy 规则，无论 targetServerId 有无）：members 含 proxy-selector（嵌套全局），
  // default=target 节点（有）或 proxy-selector（无=跟全局）。使「节点↔默认」= rule-sel default 变化（PUT 热切换），
  // 非 outbound 结构变（重启）。anti-drift 仍保留：固定节点规则 default=节点，不随全局漂。
  const emit = (ruleKey: string, selectorTag: string, targetServerId: string | undefined) => {
    // tag 防撞：节点名可能恰好叫 rule-sel-xxx → 加 (n) 后缀（与 getUniqueTag 同形）
    let tag = selectorTag;
    let n = 1;
    while (existingTags.has(tag)) {
      tag = `${selectorTag} (${n})`;
      n++;
    }
    existingTags.add(tag);
    const targetTag = targetServerId ? idToTagMap.get(targetServerId) : undefined;
    // default：target 有效→节点 tag；target 无/无效→proxy-selector（跟全局，嵌套）
    const defaultTag = targetTag && nodeTags.includes(targetTag) ? targetTag : 'proxy-selector';
    outbounds.push({
      type: 'selector',
      tag,
      outbounds: [...nodeTags, 'proxy-selector'],
      default: defaultTag,
      interrupt_exist_connections: interrupt,
    });
    pendingRuleSelectors.push({
      ruleKey,
      selectorTag: tag,
      memberTag: defaultTag,
      targetServerId,
    });
  };

  for (const rule of effectiveCustomRules(config)) {
    if (!rule.enabled) continue;
    if (rule.action !== 'proxy') continue;
    emit(`custom:${rule.id}`, `rule-sel-${rule.id}`, rule.targetServerId);
  }
  for (const appRule of effectiveAppRules(config)) {
    if (!appRule.enabled) continue;
    if (appRule.action !== 'proxy') continue;
    // appRule 按 appId 去重（effectiveAppRules），用 appId 作 key；selectorTag 加 app- 前缀避免与 customRule 混淆。
    emit(`app:${appRule.appId}`, `rule-sel-app-${appRule.appId}`, appRule.targetServerId);
  }
}

/**
 * 生成 outbounds（节点出站 + selector + rule-sel + direct/block/shadow-tls + detour 死引用预校验）。
 * 注入 gateInvalidNodes/log；返回 outbounds + 两载体 pendingEndpoints/pendingRuleSelectors
 * （由 generateSingBoxConfig 回写 this.*，供顶层 endpoints[] 注入与 hotSwitch/clash_api 回读）。
 */
export function buildOutbounds(
  selectedServer: ServerConfig | null,
  config: UserConfig,
  idToTagMap: Map<string, string>,
  deps: OutboundsDeps
): {
  outbounds: SingBoxOutbound[];
  pendingEndpoints: SingBoxEndpoint[];
  pendingRuleSelectors: PendingRuleSelector[];
} {
  const pendingEndpoints: SingBoxEndpoint[] = [];
  const pendingRuleSelectors: PendingRuleSelector[] = [];
  const outbounds: SingBoxOutbound[] = [];
  // endpoint（WireGuard 等）单独收进 pendingEndpoints（顶层 endpoints[]），但其 tag 仍与节点出站 tag 一同
  // 进入 nodeTags → proxy-selector / rule-sel / route，与普通节点一视同仁（clash_api 热切换已实测兼容）。
  pendingEndpoints.length = 0;
  const nodeTags: string[] = [];
  let systemWgCount = 0; // 多 System WG 唯一内核接口名计数（防多个 system:true WG 都叫 shadowvpn-wg 撞名致核 FATAL）。

  if (config) {
    // 生成【全部】节点的 Outbound：selector 需要列出所有可切换节点；detour 前置节点亦在 config.servers
    // 中，一并生成、通过 detour 字段链接。单个节点配置异常不应拖垮整体配置，逐节点 try/catch 跳过。
    // （app/custom 分流规则指向的固定节点 tag 不变，仍直接命中其节点出站，不经 selector。）
    for (const server of config.servers) {
      const tag = idToTagMap.get(server.id) || `proxy-${server.id}`;
      if (nodeTags.includes(tag)) continue; // 去重（含 endpoint）
      // 不可用节点跳过：naive 缺 libcronet 时，sing-box 启动会预初始化全部出站、缺库的 naive 会让
      // 整个代理启动 FATAL（连非 naive 节点也用不了）。跳过后，路由层对该节点 tag 的死引用会在
      // generateSingBoxConfig 末尾被统一修正为 selector（见 H2 修复）。
      if (!isNodeUsable(server)) {
        deps.log('warn', `跳过不可用节点「${server.name}」：NaiveProxy 缺少 libcronet 核心库`);
        continue;
      }
      // 启动前配置校验 gate 已标记为非法的节点：跳过、不进 outbounds/selector（防 onRetry 重生成复活）。
      // 路由层对其 tag 的死引用由 generateSingBoxConfig 末尾 fixRouteDeadReferences 统一修正为 selector。
      if (deps.gateInvalidNodes.has(server.id)) {
        continue;
      }
      // Phase 2：reverseMesh(system:true 内核接口)需提权——仅 TUN 模式 + helper 下可行。非提权路径（系统代理 /
      // preflight / 测速）**不再跳过、改为降级 gVisor 发射**：userspace 栈零提权可跑 → 该节点在系统代理模式下仍可用
      //（作 gVisor 出口），与 UI「非 TUN 时接入模式显示/按 gVisor」一致（修：非 TUN 下 endpoint 不生成、节点不可用）。
      // system:true 仅在 systemInterfaceAvailable(TUN+helper)时下发；下方按此 flag 把已构造的 endpoint 改回 gVisor。
      const downgradeMeshToGvisor =
        meshUsesSystemInterface(server) && !deps.systemInterfaceAvailable;
      if (downgradeMeshToGvisor) {
        deps.log(
          'info',
          `组网节点「${server.name}」：当前非 TUN 模式，按 gVisor（用户态栈）发射（System 内核接口需 TUN + 提权 helper）`
        );
      }
      // WireGuard：endpoint（非 outbound）。建进 pendingEndpoints，tag 仍入 nodeTags 参与选择器/路由。
      if (server.protocol.toLowerCase() === 'wireguard') {
        // 关外网且无可路由网段 → 空 allowed_ips 会致整份配置 FATAL（D2 实测）。生成期拦截不发射、tag 不入
        // nodeTags（走 isNodeUsable 同款不可用路径，路由层死引用由 fixRouteDeadReferences 兜底）。
        if (isMeshNodeUnroutable(server)) {
          deps.log(
            'warn',
            `跳过组网节点「${server.name}」：已关闭外网访问且无可路由网段（无外网访问权限）`
          );
          continue;
        }
        try {
          // #58：域名 server 的 WG endpoint 需 dial 级 domain_resolver（**仅用于 peer 地址解析**，与普通协议同档）。
          // R4（§14.4，回退 E2）：peer 解析回 getNodeDialDomainResolver(config)（race 多上游）。E2 曾改 dns-bootstrap 治
          // WARP 目的域名投毒——已证伪：endpoint domain_resolver 结构上只喂 peer 解析、碰不到目的域名 dial 解析（§14.3
          // 官方源码 endpoint.go L94-100 vs L229-247）。目的域名投毒的真修在 dns-builder 的 FakeIP 影子规则（R1，§14.4）。
          const ep = buildWireGuardEndpoint(server, tag, getNodeDialDomainResolver(config));
          if (downgradeMeshToGvisor) {
            ep.system = false; // 非 TUN：降级 userspace gVisor 栈（零提权可跑）
            delete ep.name; // gVisor 无内核接口名
          } else if (ep.name) {
            // 多个 system:true WG 唯一内核接口名：首个保留 shadowvpn-wg（常见单节点不变），其余追加序号——否则两张
            // 内核接口都叫 shadowvpn-wg → sing-box 建第二张时撞名 FATAL（整核起不来）。序号计数保证唯一（与 id 无关，
            // 避免 id 前缀碰撞）；shadowvpn-wg-N 仍落在 helper ifaceAllowed 的 shadowvpn- 白名单内。MeshExitRouteManager 只
            // 托管 shadowvpn-ts，不依赖 shadowvpn-wg 名，故重命名安全。
            if (systemWgCount > 0) ep.name = `shadowvpn-wg-${systemWgCount}`;
            systemWgCount++;
          }
          pendingEndpoints.push(ep);
          nodeTags.push(tag);
          // 不承载全隧道但有具体段（关外网 或 Phase2 system 内核接口）：节点可用、仅承载列表网段（不当默认
          // 出网）。warn 进诊断报告，便于排查「选它却不出网」。
          if (!meshNodeCarriesFullTunnel(server)) {
            const why = meshNonFullTunnelReason();
            deps.log(
              'warn',
              `组网节点「${server.name}」${why}：仅路由其指定网段，不承载默认出网流量`
            );
          }
        } catch (e: any) {
          deps.log(
            'warn',
            `生成 WireGuard endpoint 失败，已跳过: ${server.name} (${e?.message ?? e})`
          );
        }
        continue;
      }
      // Tailscale：endpoint（账号制 mesh）。always-emit（与 WireGuard 一致，无门控）——每个配置的 TS 节点恒发射进
      // 主核：登录态由管理 API STATUS 流逐节点【持续】报告（需登录的显「需登录」角标，用户点角标按需登录解决，
      // 无需「选中才发射」）；全部在 selector/nodeTags 里 → 切换走 PUT 热切换不重启（对齐 WG）。未登录 endpoint 核
      // 不 FATAL（tsnet 等待授权）；主核 AUTH_URL 全量上报渲染端入 store（per-node），自动 toast 仅当前出口、非
      // 出口看角标按需点开（详见 detectTailscaleAuthUrl + 渲染端登录态）。登录态(loggedIn)真值只由 STATUS 流
      // （Running/Starting && !expired）给，不复用 state 目录为判据 → 不重蹈 #132。
      if (server.protocol.toLowerCase() === 'tailscale') {
        try {
          const ep = buildTailscaleEndpoint(server, tag);
          if (downgradeMeshToGvisor) {
            ep.system_interface = false; // 非 TUN：降级 tsnet 用户态栈（零提权）
            delete ep.system_interface_name;
          }
          pendingEndpoints.push(ep);
          nodeTags.push(tag);
          // P0b 后 meshNodeCarriesFullTunnel(TS) ⟺ !!exitNode，故「不承载全隧道但填了 exitNode」组合不可能存在
          // （原 warn 分支恒 false 死代码，已删）。TS 是否承载全隧道 = 是否配 exit_node，无需再单独 warn「忽略 exit_node」。
        } catch (e: any) {
          deps.log(
            'warn',
            `生成 Tailscale endpoint 失败，已跳过: ${server.name} (${e?.message ?? e})`
          );
        }
        continue;
      }
      // 自定义协议标记为 endpoint 类型（第三方类 wireguard/tailscale 实现）→ 进 endpoints[]；
      // 否则走下方普通 outbound 路径。tag 由 generateProxyOutbound/此处统一注入。
      if (server.protocol.toLowerCase() === 'custom' && server.customSettings?.isEndpoint) {
        const { detour: _d, ...epOutbound } = (server.customSettings.outbound || {}) as Record<
          string,
          unknown
        >;
        pendingEndpoints.push({
          ...(epOutbound as unknown as SingBoxEndpoint),
          tag,
        });
        nodeTags.push(tag);
        continue;
      }
      try {
        const ob = buildProxyOutbound(
          server,
          idToTagMap,
          getNodeDialDomainResolver(config),
          deps.bridges
        );
        ob.tag = tag;
        if (
          !compatibilityEngine(server) &&
          server.detour &&
          config.servers.some((s) => s.id === server.detour)
        ) {
          // 环检测：沿 detour 链行进，若回到本节点即成环 → 不设 detour，避免 sing-box 报循环引用启动失败
          const seen = new Set<string>([server.id]);
          let cur: string | undefined = server.detour;
          let looped = false;
          while (cur) {
            if (seen.has(cur)) {
              looped = true;
              break;
            }
            seen.add(cur);
            cur = config.servers.find((s) => s.id === cur)?.detour;
          }
          if (looped) {
            deps.log('warn', `检测到代理链成环，已跳过 detour: ${server.name}`);
          } else {
            const detourSrv = config.servers.find((s) => s.id === server.detour);
            if (detourSrv && isEndpointProtocol(detourSrv.protocol)) {
              // endpoint（WireGuard/Tailscale）不作为 outbound 的前置代理(detour)目标（dialer detour→endpoint 语义
              // 未定，且本节点会被下方 detour 死引用预校验误剔）。丢弃 detour（本节点仍直连可用）+ 警告。UI 亦不列
              // endpoint 为 detour 候选（route 规则指向 endpoint 仍合法，仅 detour 不合法——两者语义不同）。
              deps.log(
                'warn',
                `endpoint 节点（WireGuard/Tailscale）不支持作为前置代理(detour)目标，已忽略「${server.name}」的代理链`
              );
            } else {
              ob.detour = idToTagMap.get(server.detour);
            }
          }
        }
        outbounds.push(ob);
        nodeTags.push(tag);
      } catch (e: any) {
        deps.log('warn', `生成节点出站失败，已跳过: ${server.name} (${e?.message ?? e})`);
      }
    }

    // 全局 TLS 分片（PR-6）：开启后对所有已生成的 TCP-TLS 节点出站切分 ClientHello，抗 SNI-DPI。
    // 跳过 hy2/tuic（QUIC 内 TLS、无 TCP ClientHello，死配置）与 naive（Cronet 自管 TLS，拒绝
    // fragment 字段 → 启动 FATAL）。
    // 机制选型：用 outbound 的 `tls.fragment`（按 TCP 段切分代理自身 ClientHello）而非 route action
    // `route-options.tls_fragment`——后者作用于被嗅探出的流量（切内层），非代理自身握手入口。默认仅注入
    // fragment=true，不注入 fragment_fallback_delay（用核心默认 500ms）/record_fragment（保持纯开关）。
    if (config.tlsFragment) {
      for (const ob of outbounds) {
        if (ob.tls && ob.type !== 'hysteria2' && ob.type !== 'tuic' && ob.type !== 'naive') {
          ob.tls.fragment = true;
        }
      }
    }

    // selector：列出已生成的全部节点 tag，default 指向当前选中节点；interrupt_exist_connections 由用户
    // 开关决定（默认 false=优雅切换，现有连接保留至自然关闭）。clash_api `PUT /proxies/proxy-selector`
    // 据此热切换、无需重启 sing-box（详见 switchMode）。路由的 final 与「→代理」规则统一指向本 selector。
    // nodeTags 已在节点循环中按序累积（含 endpoint tag）；空=所有节点生成失败/不可用。
    // 全局直连哨兵（#73）：无真实选中节点，default=direct；direct 恒为 proxy-selector 成员，
    // 支持 clash_api 热切换「直连↔节点」不重启。proxifier 时即便 0 节点也不抛（纯直连合法）。
    const isDirect = isDirectSelection(config.selectedServerId);
    if (nodeTags.length === 0 && !isDirect) {
      throw new Error('没有可用的代理节点出站（所有节点配置生成失败）');
    }
    const selectedServerTag = resolveGlobalExitTag(config.selectedServerId, idToTagMap) || 'proxy';
    outbounds.push({
      type: 'selector',
      tag: 'proxy-selector',
      outbounds: [...nodeTags, 'direct'],
      default: isDirect
        ? 'direct'
        : nodeTags.includes(selectedServerTag)
          ? selectedServerTag
          : nodeTags[0],
      interrupt_exist_connections: config.interruptConnectionsOnSwitch === true,
    });

    // rule-sel：恒优化后「所有 proxy 规则」均生成独立 selector（无论 targetServerId 有无）。
    //   有 target → default=目标节点（anti-drift：固定规则不经共享 proxy-selector，热切全局节点后不漂走）；
    //   无 target → default=proxy-selector（跟全局，嵌套）。「节点↔默认」切换 = rule-sel default 变（PUT 热切换），
    //   非 outbound 结构变（重启）。members 复用 proxy-selector 的可用 nodeTags（已排除 naive 缺库 / gate-invalid /
    //   detour 死引用剔除的节点）；目标无效/被 gate 剔除/无 target → default 落 proxy-selector 兜底
    //   （rule-sel 仍建、不 FATAL，与 fixRouteDeadReferences 兜底语义一致）。
    // 仅 smart 生成：用户路由仅 smart 生效，global/direct 下 effectiveCustomRules/effectiveAppRules 为空 → 无 proxy 规则、无消费者。
    if ((config.proxyMode || 'smart').toLowerCase() === 'smart') {
      generateRuleSelectors(config, idToTagMap, nodeTags, outbounds, pendingRuleSelectors);
    }
  } else if (selectedServer) {
    // Fallback if config is missing (shouldn't happen)
    outbounds.push(
      buildProxyOutbound(selectedServer, idToTagMap, getNodeDialDomainResolver(config))
    );
  }

  // 直连出站。domain_resolver：FakeIP 模式下国内内容（geosite-cn→direct）真实 IP 解析的唯一落点——direct 对 fakeip
  // 反查域名二次解析时用它（无则回退 route.default_domain_resolver=dns-bootstrap）。根治 §3.2（数据流确证）：显式指
  // getDomesticResolverTag（race on→dns-node-race 多上游国内 race / off→dns-bootstrap=现状），让国内内容享共用 race server。
  outbounds.push({
    type: 'direct',
    tag: 'direct',
    domain_resolver: getDomesticResolverTag(config, 'dns-bootstrap'),
  });

  // 【已删除：legacy `block` 出站】阻断改由 sing-box 1.14 的 `action: 'reject'` 路由动作表达
  // （自定义规则与应用分流两处发射点均已迁移），故本出站无任何引用者：
  //  · 三种 selector 的成员表分别是 [...nodeTags,'direct'] / [...nodeTags,'proxy-selector'] /
  //    [...nodeTags,'direct']，都不含 block（36 份 config 快照里 `default: "block"` 与裸数组元素
  //    `"block"` 各 0 处，实测核对）；
  //  · 用户侧无法产出对它的引用——规则动作经结构化 Rule 生成，用户能提供的 rule-set 文件只含匹配器、
  //    自定义协议 JSON 提供的是 outbound 定义而非路由规则。
  // 反向风险已评估：若将来某处又发出 `outbound: 'block'` 而本出站不在，`fixRouteDeadReferences` 会把它
  // 改写成 `proxy-selector` —— 用户想阻断的流量反被代理，且静默。故本目录的接线门断言「全仓不得再出现
  // outbound: 'block'」，把这条路彻底关掉，而不是靠保留一个死出站兜底。

  // §15 主核测速探测池 selector：K 个 probe-selector-k，成员 = proxy-selector 同款全量 nodeTags + direct。
  // default=direct（sing-box 要求 default ∈ outbounds 成员，direct 恒为成员）；测速时按波 gRPC selectOutbound 把该槽
  // 热切到被测节点（15.3 命门已证 live 生效）。interrupt_exist_connections:true 清在飞连接——同槽跨波重定向前断残留、
  // 防跨节点串味。与主 proxy-selector 独立 groupTag → 切 probe 池零扰用户出口（隔离）。
  // §15.11-F4：门控仅取 probePoolPorts.length（与 probe-in-k/route/dns-probe-exit-k 三 builder 一致），**独立于
  //   config/selectedServer 分支**——保「有池端口 ⟺ 池 selector 恒发射」，杜绝 fallback 分支下 probe-in-k→probe-selector-k
  //   悬空引用 FATAL（今日 config 恒真、不可达；此为未来分支健壮性对齐）。fallback 分支 nodeTags 空 → 成员=[direct]、
  //   default=direct（合法）。置于 direct/block 之后：成员引用的 direct 已在 outbounds 中（tag 解析，序无关，稳妥）。
  for (let k = 0; k < (deps.probePoolPorts?.length ?? 0); k++) {
    outbounds.push({
      type: 'selector',
      tag: `probe-selector-${k}`,
      outbounds: [...nodeTags, 'direct'],
      default: 'direct',
      interrupt_exist_connections: true,
    });
  }

  // Shadow-TLS 后处理：如果主节点或任意辅助节点使用了 Shadow-TLS，
  // 为每个使用 Shadow-TLS 的节点插入内层 SS outbound
  const stlsOutbounds: SingBoxOutbound[] = [];
  for (const ob of outbounds) {
    // 根据 tag（节点名称）反查对应的 ServerConfig；selector/direct/block 等非节点出站匹配不到 → 跳过
    const srv = config?.servers.find((s) => idToTagMap.get(s.id) === ob.tag);
    if (srv?.shadowTlsSettings) {
      // 创建独立的外层 ShadowTLS outbound
      const stlsTag = `stls-out-${srv.id}`;
      const stlsOutbound: SingBoxOutbound = {
        type: 'shadowtls',
        tag: stlsTag,
        // issue #147：外层 shadowtls 是真正的 TCP 拨号目标（内层 SS 经 detour 指向它），server 恒用原域名，
        // 交内核运行时解析（取代 resolve-ahead 烧 IP）。server_name 仍用 shadowTlsSettings.sni（身份），不受影响。
        server: srv.address,
        // port `||` 非 falsy-zero bug：ShadowTLS 端口合法值 1-65535，0/未设 → 降级用主端口；
        // 改 `??` 反而会把非法 0 透传给核致 FATAL，故 `||` 才是正确选择。
        server_port: srv.shadowTlsSettings.port || srv.port,
        version: 3,
        password: srv.shadowTlsSettings.password,
        tls: {
          enabled: true,
          server_name: srv.shadowTlsSettings.sni || undefined,
          utls: {
            enabled: true,
            fingerprint: srv.shadowTlsSettings.fingerprint || 'chrome',
          },
        },
      };
      stlsOutbounds.push(stlsOutbound);

      // 主 outbound（原 shadowsocks）仍是应用的路由目标，故保留其 tag，只把 detour 指向新增的 shadowtls
      // outbound：外层负责 TLS 握手连接真实服务器地址，内层 SS 是被保护的流量（detour 生效后核心会忽略
      // 主 outbound 的 server/port，故其原参数是否保留不影响行为）。
      ob.detour = stlsTag;
    }
  }
  outbounds.push(...stlsOutbounds);

  // detour 引用预校验（补 check 唯一盲区：start-stage 引用解析——check 过、run 时报
  // `dependency[X] not found for outbound[Y]` FATAL）。任何 outbound.detour 指向「生成集合内不存在的
  // tag」→ 剔除该引用方（**不删 detour 字段**，与 pruneTagsClosure 同隐私语义；选中节点则 throw），
  // 从 selector 删成员并记录 gateInvalidNodes；selector 剔空 throw。仅 config 存在时有 selector，需 guard。
  if (config) {
    const tagToServerId = (tag: string): string | undefined => {
      if (tag.startsWith('stls-out-')) return tag.slice('stls-out-'.length);
      for (const [id, t] of idToTagMap) {
        if (t === tag) return id;
      }
      return undefined;
    };
    const selector = outbounds.find((o) => o.tag === 'proxy-selector');
    const selectedTag = selectedServer ? idToTagMap.get(selectedServer.id) : undefined;
    let mutated = false;
    // 反复扫描：剔一个引用方可能让别的 detour 链断裂，收敛到不再有死引用。

    while (true) {
      const validTags = new Set(outbounds.map((o) => o.tag).filter((t): t is string => !!t));
      const dead = outbounds.find(
        (ob) => ob.detour !== undefined && !validTags.has(ob.detour) && ob.tag !== 'proxy-selector'
      );
      if (!dead) break;
      if (dead.tag === selectedTag) {
        throw new Error(
          `选中节点「${dead.tag}」的代理链依赖的前置节点不存在，无法启动，请更换节点后重试`
        );
      }
      // 删该引用方 outbound + selector 成员；记录 gateInvalidNodes。
      const removedTag = dead.tag;
      const sid = tagToServerId(removedTag);
      outbounds.splice(outbounds.indexOf(dead), 1);
      // 同步剔除所有 selector（proxy-selector + 各 rule-sel）的成员引用：rule-sel 的 members 与
      // proxy-selector 同源（generateRuleSelectors 复用 nodeTags 快照），节点被剔后须一并清理，否则
      // rule-sel 引用幽灵 tag → sing-box 启动 FATAL。default 命中被剔 → rule-sel 回 proxy-selector、
      // proxy-selector 落剩余首节点（MED-1，见 prunedSelectorDefault；不 FATAL）。
      const allSelectors = outbounds.filter(
        (o) => o.type === 'selector' && Array.isArray(o.outbounds)
      );
      for (const sel of allSelectors) {
        sel.outbounds = (sel.outbounds as string[]).filter((t) => t !== removedTag);
        if (sel.default === removedTag) {
          sel.default = prunedSelectorDefault(sel.tag, sel.outbounds as string[]);
        }
      }
      if (sid) {
        idToTagMap.delete(sid);
        if (!deps.gateInvalidNodes.has(sid)) {
          deps.gateInvalidNodes.set(sid, {
            id: sid,
            tag: removedTag,
            reason: '代理链依赖的前置节点不存在（detour 引用无效）',
          });
        }
      }
      deps.log('warn', `启动前配置校验：节点「${removedTag}」的 detour 引用无效，已剔除`);
      mutated = true;
    }
    if (
      mutated &&
      selector &&
      Array.isArray(selector.outbounds) &&
      selector.outbounds.length === 0
    ) {
      throw new Error('没有可用的代理节点出站（节点代理链依赖无效）');
    }
    // rule-sel 剔空（members 全被 detour 死引用剔除）：删该 selector outbound，对应 route 规则的
    // outbound（rule-sel-<id>）成死引用 → fixRouteDeadReferences 兜底改写为 proxy-selector，启动不 FATAL。
    if (mutated) {
      for (let i = outbounds.length - 1; i >= 0; i--) {
        const o = outbounds[i];
        if (
          o.type === 'selector' &&
          o.tag !== 'proxy-selector' &&
          o.tag &&
          o.tag.startsWith('rule-sel') &&
          Array.isArray(o.outbounds) &&
          o.outbounds.length === 0
        ) {
          outbounds.splice(i, 1);
        }
      }
    }
  }

  return { outbounds, pendingEndpoints, pendingRuleSelectors };
}
