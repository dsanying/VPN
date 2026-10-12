import type {
  NaiveSettings,
  Hysteria2Settings,
  SnellSettings,
  TuicSettings,
  WireGuardSettings,
  TailscaleSettings,
  CustomSettings,
  AnyTlsSettings,
  MultiplexSettings,
  ShadowsocksSettings,
  SshSettings,
  ShadowTlsSettings,
  TlsSettings,
  RealitySettings,
  WebSocketSettings,
  GrpcSettings,
  HttpSettings,
  XHttpSettings,
} from './types/protocol-settings';

import type { Rule, CustomRuleSet, AppRule, CustomAppPreset } from './types/rules';

// ============================================================================
// 协议设置子类型（re-export，保持所有现有 import 路径不变）
// ============================================================================

export type {
  Hysteria2Network,
  TlsSettings,
  RealitySettings,
  WebSocketSettings,
  GrpcSettings,
  HttpSettings,
  XHttpSettings,
  Hysteria2ObfsSettings,
  Hysteria2Settings,
  SnellVersion,
  SnellSettings,
  MultiplexSettings,
  TuicSettings,
  NaiveSettings,
  ShadowsocksSettings,
  AnyTlsSettings,
  SshSettings,
  ShadowTlsSettings,
  WireGuardSettings,
  TailscaleSettings,
  CustomSettings,
} from './types/protocol-settings';

// ============================================================================
// 路由规则子类型（re-export）
// ============================================================================

export type {
  RuleAction,
  LegacyDomainRule,
  RuleType,
  RuleCondition,
  Rule,
  SystemProcessInfo,
  InstalledApplication,
  CustomRuleSet,
  AppRule,
  CustomAppPreset,
} from './types/rules';

// ============================================================================
// 运行时状态子类型（re-export）
// ============================================================================

export type {
  ProxyStatus,
  ProxyErrorEvent,
  InvalidNodeInfo,
  ConnectionEntry,
  ConnectionsSnapshot,
  ConnectionsAggregate,
  ConnectionAggHost,
  ConnectionAggOutbound,
  ConnectionAggFlow,
  HelperStatus,
  SystemProxyStatus,
  LogEntry,
  TrafficStats,
  IpInfo,
  IpInfoSnapshot,
  ProxyExitBlock,
  ApiResponse,
  AutoStartStatus,
  PlatformInfo,
} from './types/runtime';

export { ProxyErrorCode, isProxyErrorCode, TOPOLOGY_OTHERS_KEY } from './types/runtime';

// ============================================================================
// 基础类型
// ============================================================================

export type ProxyMode = 'global' | 'smart' | 'direct';
export type ProxyModeType = 'systemProxy' | 'tun' | 'manual';
export type Protocol =
  | 'vless'
  | 'trojan'
  | 'hysteria2'
  | 'shadowsocks'
  | 'anytls'
  | 'tuic'
  | 'vmess'
  | 'naive'
  | 'snell'
  | 'socks'
  | 'http'
  | 'ssh'
  | 'wireguard'
  | 'tailscale'
  | 'custom';
export type Network = 'tcp' | 'ws' | 'grpc' | 'http' | 'httpupgrade' | 'xhttp';
export type Security = 'none' | 'tls' | 'reality';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
// 'auto' = 默认档：跟随平台映射（macOS·Windows→gvisor / Linux→system），经 shared/tun-defaults#resolveTunStack
// 解析成下发给核的具体栈。system/gvisor/mixed = 显式高级兜底。详见 docs/design/tun-stack-option.md。
export type TunStack = 'auto' | 'system' | 'gvisor' | 'mixed';
// 'auto' = 默认档：跟随 (平台 × 具体栈) 映射，经 shared/tun-defaults#resolveTunMtu 解析成下发给核的具体数值；
// 数值 = 用户显式指定（原样下发）。与 TunStack 同形——存储存意图、解析期落平台值，故无需哨兵猜「是否用户所设」。
export type TunMtu = 'auto' | number;

// ============================================================================
// 订阅配置
// ============================================================================

export interface SubscriptionConfig {
  id: string;
  name: string;
  url: string;
  autoUpdate: boolean;
  lastUpdated?: string;
  createdAt: string;
  // 订阅流量/到期信息（从 Subscription-UserInfo header 解析）
  userInfo?: {
    used?: number;
    remaining?: number;
    balance?: number;
    currency?: string;
    upload?: number; // 已上传字节
    download?: number; // 已下载字节
    total?: number; // 总流量字节
    expire?: number; // 到期时间（Unix timestamp）
  };
  // §16.3.4 条件 GET 验证器（上次 200 响应的 ETag / Last-Modified）：下次拉取带 If-None-Match / If-Modified-Since，
  // 服务端 304 → 短路 parse/reconcile（零节点扰动、省流省渲染）。缺省=首次/无 validator 源，全量 GET（零回归）。
  etag?: string;
  lastModified?: string;
  // 上次解析含 proxy-providers（Clash provider 型订阅）→ 主正文 304 会掩盖 provider 子资源独立变化 → 不发条件头（保守豁免）。
  hasProviders?: boolean;
}

export interface ServerConfig {
  id: string;
  name: string;
  protocol: Protocol;
  address: string;
  port: number;

  // 代理链（前置代理）ID
  detour?: string;

  subscriptionId?: string;

  // M1：节点归属的 Clash proxy-provider 名（仅经 proxy-providers 解析的节点有值；内联 proxies / 非 Clash
  // 订阅 / 迁移前存量为 undefined）。用于订阅 partial 失败时按 provider 精确 merge-only——只保留失败 provider
  // 名下的下架节点，成功 provider 的真下架正常删除。
  providerName?: string;

  uuid?: string;
  encryption?: string;
  flow?: string;

  // vless/vmess UDP 封装，默认 xudp，可设 '' 或 'packetaddr' 等
  packetEncoding?: string;

  // Trojan 和 Hysteria2 通用
  password?: string;

  username?: string;
  naiveSettings?: NaiveSettings;

  alterId?: number;
  vmessSecurity?: string;

  hysteria2Settings?: Hysteria2Settings;

  tuicSettings?: TuicSettings;

  // WireGuard 特定（sing-box endpoint）
  wireguardSettings?: WireGuardSettings;

  // Tailscale 特定（sing-box endpoint，账号制 mesh）
  tailscaleSettings?: TailscaleSettings;

  // 自定义协议（raw-JSON 透传，第三方内核用）
  customSettings?: CustomSettings;

  anyTlsSettings?: AnyTlsSettings;

  // Multiplex 多路复用（vless/trojan/vmess/ss；reality+vision 不兼容，生成侧 guard）
  multiplexSettings?: MultiplexSettings;

  shadowsocksSettings?: ShadowsocksSettings;

  // Snell 特定（psk 复用通用 password 字段，同 trojan/hysteria2 惯例）
  snellSettings?: SnellSettings;

  sshSettings?: SshSettings;

  // Shadow-TLS 插件（可附加在任意协议上，常用于 SS2022）
  shadowTlsSettings?: ShadowTlsSettings;

  network?: Network;
  security?: Security;

  tlsSettings?: TlsSettings;

  realitySettings?: RealitySettings;

  wsSettings?: WebSocketSettings;
  grpcSettings?: GrpcSettings;
  httpSettings?: HttpSettings;
  xhttpSettings?: XHttpSettings;
  // Native node-only configuration; never contains listeners, global rules or helper settings.
  compatibilitySettings?: { engine: 'xray' | 'mihomo'; outbound: Record<string, unknown> };

  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// 本地导入（节点 / 订阅）
// ============================================================================

/** 本地导入识别到的来源格式。 */
export type ImportFormat = 'native' | 'singbox' | 'xray' | 'clash' | 'links' | 'unknown';

/**
 * 本地导入解析结果（主进程 LOCAL_IMPORT_PARSE 返回，渲染端预览用）。
 * nodes 均为「自建」节点（无 subscriptionId）；subscriptions 仅来自 Clash proxy-providers（不联网拉取）。
 */
export interface ImportParseResult {
  nodes: ServerConfig[];
  subscriptions: { name: string; url: string }[];
  stats: {
    imported: number; // 可入库的节点数（含「不支持但透传为 custom」的，使用时置灰）
    unsupported: number; // 其中「当前内核不支持、已透传为 custom」的数量（imported 的子集）
    skipped: number; // 协议不受支持被跳过的节点数
    failed: number; // 解析失败 / 必填字段不全被跳过的节点数
  };
  warnings: string[];
  format: ImportFormat;
}

export interface TunModeConfig {
  mtu: TunMtu;
  stack: TunStack;
  autoRoute: boolean;
  strictRoute: boolean;
  interfaceName?: string;
  inet4Address?: string;
  inet6Address?: string;
  // ── P6 局域网网关（sing-box 1.14 LAN 设备识别簇，仅 Linux 生效，见 shared/neighbor.ts）──
  // TUN 按 MAC 过滤进入 TUN 的设备：'include'=仅 macFilterList 内的设备进 TUN / 'exclude'=排除它们。互斥。
  // 仅 Linux + auto_route + auto_redirect 支持；非法 MAC / 非 Linux 时构建期不发射（防 FATAL）。
  macFilterMode?: 'include' | 'exclude';
  macFilterList?: string[]; // EUI-48 MAC，仅在 macFilterMode 设定时消费
  // local DNS 邻居解析：对这些后缀的单标签短名（如 nas.lan）走局域网邻居解析（主机名→IP）。
  // 每条须以 '.' 开头（构建期归一化）；仅 Linux/macOS 生效。供「局域网设备短名访问」场景。
  neighborDomains?: string[];
  // 「连入来源排除」网段（CIDR，v4/v6）：本机作服务端被 off-subnet 私网连入时（如经 ZeroTier→路由器 DNAT），
  // 声明这些来源段绕过 TUN 捕获（追加进 route_exclude_address），使回包走物理网卡、不被 TUN 用户态栈误劫持。
  // 区别于 bypassLANList（route.rules 直连偏好，不影响是否进 TUN）。生成期减 mesh force-route 段 / fakeip 段；
  // macOS 额外减本机物理 LAN 段（NE 反向路由 guard）。详见 docs/design/flowz-tun-lan-exclusion-scenarios.md。
  inboundExcludeCidrs?: string[];
}

export interface DnsConfig {
  domesticDns: string; // 国内 DNS，默认 https://doh.pub/dns-query
  foreignDns: string; // 海外 DNS，默认 https://dns.google/dns-query
  // ── 节点域名解析上游选择（issue #147 多源 race，取代 #57 单选档位 + 烧 IP）。设计 docs/design/issue147-node-dns-race-resolver.md ──
  // @deprecated 旧单选档位，仅供迁移读取（auto→pool[ali,dnspod] / dnspod→[dnspod] / system→[system]）；
  // 迁移后不再写入，新逻辑读 nodeResolverPool/nodeResolverSingle。旧配置无此字段 → 视为 'auto'。
  nodeDomainResolver?: 'auto' | 'dnspod' | 'system';
  // 节点域名解析容错（issue #147，原「resolve-ahead 前置烧 IP」重定义）：缺省/true=开（默认）。
  // 开 → domain_resolver 指本地 race server（dns-node-race）：多上游 DoH 并发 race（最快非空 wins），多 A 透传给内核 DialSerial 逐个重试。
  // 关 → domain_resolver 按 nodeResolverSingle 指【单上游】（逃生阀，退回单点）。与上游选择正交（设计 §9.1）。旧配置无 → 视为开。
  resolveNodeDomainsAhead?: boolean;
  // race【on】勾选的上游 id 列表（内置 'ali'|'dnspod'|'system' + 自定义 id）。Tier1(ali/dnspod/自定义DoH)抢跑、上限 3；
  // Tier2(system/自定义UDP)兜底不占额度。空 → 回退默认 ['ali','dnspod']。缺省即默认。
  nodeResolverPool?: string[];
  // race【off】单选的上游 id。缺省 'ali'。与 pool 各存各的，切换互不覆盖。
  nodeResolverSingle?: string;
  // 用户自定义上游（强制纯 IP：parseDnsServerSpec.isDomain 为 true 拒绝）。id 稳定供 pool/single 引用。
  nodeResolverCustom?: CustomDnsUpstream[];
  // 旧 nodeDomainResolver → 新多源模型一次性迁移标记。undefined=未迁移。
  nodeResolverMigrated?: boolean;
  // TUN 模式手动接管系统 DNS（SystemDnsManager）：仅 true 开启，缺省/false 关闭。on-link 的 LAN/ISP DNS 不进 TUN →
  // hijack-dns 看不到 → 需代理的域名走系统解析得到真实/错族 IP（双栈站 ERR_CONNECTION_CLOSED / 真 v6 泄漏）。
  // 开 → TUN 启动把系统 DNS 改为可路由的 8.8.8.8 使其经 TUN 被 hijack；停止/退出/崩溃还原。
  // 关 → 不接管（dns-local 恢复用原 LAN DNS、内网域名正常，但 TUN 下有上述泄漏风险），供有自定义/内网 DNS 的用户用。
  // 仅 TUN 模式生效；新装及旧配置无此字段 → 关闭，保留明确保存的开关值。详见 docs/design/dns-ipv6-takeover.md。
  takeoverSystemDns?: boolean;
  // P2b 乐观 DNS 缓存（sing-box 1.14 `dns.optimistic`）：缺省/false=关。开 → 缓存过期后先返回旧值、后台异步刷新，
  // 降低尾延迟（牺牲首条过期响应的新鲜度）。映射到顶层 dns.optimistic:true（仅 true 时下发，关时省略保字节）。
  optimisticCache?: boolean;
  // P2c DNS 查询超时（sing-box 1.14 `dns.timeout`，毫秒）：缺省/未设=用核默认（不下发）。>0 时下发 dns.timeout:"<n>ms"，
  // 治理慢上游不拖整体解析。sanitize 丢弃 ≤0 / 非有限 / 超合理范围（1..60000ms）的值（见 ConfigManager.validateConfig）。
  dnsTimeoutMs?: number;
}

// issue #147：自定义节点解析上游（强制纯 IP，DoH/DoT/UDP）。spec 经 shared/dns.parseDnsServerSpec 校验
// （isDomain=true 拒绝，保证零 bootstrap + route 直连放行确定）。详见 docs/design/issue147-node-dns-race-resolver.md §9.1。
export interface CustomDnsUpstream {
  id: string; // 稳定 id，供 DnsConfig.nodeResolverPool / nodeResolverSingle 引用
  spec: string; // 'https://223.5.5.5/dns-query'(DoH) | 'tls://<IP>:853'(DoT) | '<IP>'(裸 IP=UDP:53)
}

// ============================================================================
// 地区分流（4.1.0）：智能分流的 geo 基线场景
// ============================================================================

/** 地区 ID：自动策略使用现行 ISO 3166-1 alpha-2 小写码。 */
export type RegionId = string;
/** 应用注入自动地区策略；旧配置字段仅保留备份与纯生成器兼容。 */
export interface RegionRoutingConfig {
  /** Runtime-only automatic policy; persisted legacy settings remain readable for old backups. */
  automatic?: boolean;
  enabled: boolean; // 自动策略仅在地区与规则资源均就绪时开启
  region: RegionId; // 当前直连网络出口地区；未知为空
  reverse: boolean; // 旧配置兼容字段；自动策略恒 false
}

/**
 * §2 待应用差集：节点集相对运行核启动快照（runningServersFingerprint）的差异。
 * added=新增未入核（徽标「待入池」）；modified=已编辑未生效（徽标「待生效」+dirty）。
 * 均为 serverId 列表；全空 = 运行核与 config 一致（或核未运行）。
 * （F-2：removed 已移除——删被引用节点恒即刻重启仅瞬态、删未引用节点核内 orphan 无可行动语义，不再报为差集。）
 */
export interface PendingNodeChanges {
  added: string[];
  modified: string[];
}

export interface UserConfig {
  subscriptions?: SubscriptionConfig[];

  // 服务器配置
  servers: ServerConfig[];
  selectedServerId: string | null;

  // 代理模式
  proxyMode: ProxyMode;
  proxyModeType: ProxyModeType;
  /** Explicit user override: use TUN for every connection until cancelled. */
  forceTun?: boolean;

  // TUN 模式配置
  tunConfig: TunModeConfig;
  // TUN stack 一次性迁移标记（幂等）：存量旧强制默认 stack（mac=gvisor / Win·Linux=system，非真实选择）→ 'auto'。
  // undefined=未迁移（旧配置）；新装由 createDefaultConfig 置 true。详见 ConfigManager.migrateTunDefaults。
  tunStackMigrated?: boolean;
  // TUN mtu 一次性迁移标记（幂等）：存量旧强制默认 mtu（9000 / 1350 / 1400，非真实选择）→ 'auto'。
  // **必须与 tunStackMigrated 分开**：后者对存量用户早已置 true，复用会让这批人的 mtu 永不迁移。
  tunMtuMigrated?: boolean;

  customRules: Rule[];

  // 地区分流（4.1.0）：智能分流 geo 基线场景。undefined=默认中国大陆正向(=今日行为，零迁移)。
  regionRouting?: RegionRoutingConfig;

  // 应用设置
  autoStart: boolean;
  silentStart: boolean;
  autoConnect: boolean;
  minimizeToTray: boolean;
  // 界面语言「选择」（单一真值源）：'auto'（跟随系统）或某受支持语言码（zh-CN/zh-TW/en-US/ru/fa）。
  // 主进程直接据此定托盘/通知语言（不再靠渲染端 IPC 反向告知）；渲染端 i18n 经 additionalArguments 注入同步读取。
  // 可选：存量配置缺该键 → 渲染端首次从旧 localStorage['app-language'] 回填（见 App.tsx 迁移）。
  language?: string;
  autoLightweightMode: boolean;
  // 图形兼容逃生门（正向语义：**默认开**=true，关闭是 opt-in 用户自救；均需重启生效）。
  // 消费一律用 `!== false`（undefined=未设/旧配置=默认开）。
  // hardwareAcceleration（全平台）：false → app ready 前调 app.disableHardwareAcceleration() 改用软件渲染，
  //   规避 GPU 进程反复崩溃/白屏/花屏。app ready 前 ConfigManager 未初始化 → 早期同步读 config.json 原文本，
  //   判定见 main/services/graphics-compat。Linux 已无条件禁用硬件加速 → 本开关在 Linux 是 no-op（设置页 Linux
  //   整卡隐藏，避免死开关谎称「硬件加速开启」）；实际生效面 = Win/mac。
  hardwareAcceleration?: boolean;
  // windowEffects（Windows Mica + macOS 透明/vibrancy 毛玻璃——同属 D 类合成层向量，故跨平台对齐）：
  //   false → 创建主窗不设 backgroundMaterial:'mica'（Win）、不开 transparent+vibrancy（mac），一律回落实色底，
  //   规避合成失效（electron #38743/#46753/#28255/#48031）的 hide/show 白屏。窗口 chrome（titleBarStyle 等）不受影响。
  windowEffects?: boolean;
  desktopNotifications?: boolean; // 桌面通知总开关（默认开）：当前仅严重错误事件发系统通知，关闭则一概不发
  rememberWindowSize?: boolean; // 记忆调整后的窗口大小
  enableIPv6?: boolean; // 启用系统全局 IPv6 解析及路由 (不建议开启)
  autoPrivacyMode?: boolean; // 自动进入隐私模式
  privacyPassword?: string; // 隐私模式解锁密码
  autoSwitchNode?: boolean; // 节点故障时自动切换到可用节点
  interruptConnectionsOnSwitch?: boolean; // 切换节点时中断现有连接、强制在新节点重建（默认 true=切换即断旧连接；显式 false=优雅切换，现有连接保留至自然关闭）
  // §2 待应用差集：节点配置变更后是否立即重启内核应用（默认 false=OFF=进「待应用」差集、动作条一键应用/被选中时才补全；
  // true=ON=每次节点增/改/删即刻去抖重启，兼作自动订阅刷新的 auto-apply 调度器）。仅节点集/参数变更受此门控，
  // 影响活流量的变更（改选中/被规则指向节点）恒立即重启不受此开关影响。**不入 configGenerationNorm**（纯调度偏好、
  // 不影响 sing-box 配置生成；若入 norm 则切开关本身会触发无谓重启）。
  restartOnNodeChange?: boolean;
  // 组网登录期出口让位（默认开=undefined||true）：当选中出口为 Tailscale 且其隧道尚未 Running 时，默认路由临时让位
  // 直连（hotSwitchSelector→direct，零重启），使浏览器授权页/引导期控制平面流量不被导向「尚未连上的 TS 出口」而死锁；
  // 隧道 Running 后自动切回 TS 出口。关闭=false：宁可授权失败也不在引导期直连（无泄漏窗口）。见 shared/mesh-login-fallback。
  meshLoginFallbackDirect?: boolean;

  // 窗口尺寸（仅在 rememberWindowSize 启用时使用）
  windowBounds?: { width: number; height: number };

  dnsConfig?: DnsConfig;

  customRuleSets?: CustomRuleSet[];

  // GitHub update mirror, independent of routing data management.
  ghProxyPrefix?: string;

  // 应用分流规则（实验性）
  appRules?: AppRule[];
  // 旧应用规则总开关；仅 true + 智能分流生效，false/undefined 不进入 route/TUN 排除/geo 收集。统一规则页编辑单项时兼容保留原禁用状态。
  appRoutingEnabled?: boolean;
  // 应用分流默认预设一次性注入标记：首次为内置预设注入默认「代理·跟全局」规则后置 true。
  // 防每次启动回灌（用户删掉某预设规则后不会被重新补回）。新装由 createDefaultConfig 直接置 true。
  appRulesSeeded?: boolean;

  customAppPresets?: CustomAppPreset[];

  // 端口配置
  /** @deprecated mixed-only 架构已弃用独立端口；仅旧配置兼容 + 迁移读取（见 shared/proxy-ports）。 */
  socksPort?: number;
  /** @deprecated 同上；迁移时若 mixedPort 未设则以此为 mixedPort 种子。 */
  httpPort?: number;
  // 本地混合代理端口（mixed inbound 同口 HTTP+SOCKS）。mixed-only 架构 canonical 端口，恒 >0、无开关。
  // 新装缺省 7890（DEFAULT_MIXED_PORT，对齐业内）；旧配置迁移自 httpPort。统一经 shared/proxy-ports#localProxyPort 取用。
  mixedPort?: number;
  // clash_api 外部控制端口。新装缺省 9090（DEFAULT_CONTROL_PORT，对齐业内）。可改：当 9090 被另一 clash 系应用/
  // 任意进程占用时，FlowZ 据此改 external_controller 端口，避免 clash_api 无法 bind 的死局。统一经 shared/proxy-ports#controlApiPort 取用。
  controlPort?: number;
  allowLan?: boolean; // 局域网共享代理（允许其他设备连接）
  bypassLAN?: boolean; // 绕过局域网总开关（关 → 不绕过，内网/清单内目标也走代理）
  // 绕过局域网完整清单（用户可编辑，含 CIDR + 域名）：undefined=用 DEFAULT_BYPASS_LAN（字节不变）；已编辑存全量。
  // 受 bypassLAN 开关管理。双消费：① TUN 模式 route 私网直连 + Windows TUN 排除只取其 CIDR（bypassLanCidrs，
  // mac/Linux 走 route 规则规避 NetworkExtension HANG）；② 系统代理模式整份（CIDR+域名）写入 OS 忽略列表。
  // 原 systemProxyBypass 已并入此字段（单一清单，杜绝两处重复）。
  bypassLANList?: string[];
  // 拦截浏览器自带 DoH（对 DoH 域名的 TCP 443/853 与 UDP 443 执行 reject），逼其回退系统 UDP 53 重进
  // hijack-dns/FakeIP 体系。**默认开**（undefined ≠ false，保持历史行为——此前是恒开且无开关）。
  // 关掉 = 允许浏览器 DoH，代价是域名级分流退化成 IP 级。语义与清单见 shared/browser-doh。
  blockBrowserDoh?: boolean;
  // 被拦的 DoH 域名关键词（子串匹配）。未设置 → 用 DEFAULT_BROWSER_DOH_KEYWORDS；设置后完全以本清单为准。
  // 可编辑是必需的而非便利：按域名拦本质是黑名单，浏览器可换任意提供商，内置固定表必然漏。
  browserDohList?: string[];
  tlsFragment?: boolean; // 全局 TLS 分片：对所有 TLS 节点切分 ClientHello 抗 SNI-DPI；默认关
  // WebRTC 防泄露（仅 TUN 模式生效）：off=关；proxy=对 STUN 经协议嗅探强制走代理（srflx=代理 IP，WebRTC 正常）；
  // block=reject STUN（断 P2P、零公网 IP 泄露）。默认 undefined=off（零行为变化）。系统代理模式拦不住（浏览器 WebRTC
  // 的 UDP 不经 sing-box 核），UI 在系统代理模式置灰。
  webrtcLeakProtection?: 'off' | 'proxy' | 'block';

  // fake-ip-filter 默认清单（NTP/STUN/Captive 等在 FakeIP 下会坏的域名 → 真实解析）。默认开（undefined/true=开），仅 false=关。
  fakeIpFilter?: boolean;
  // FakeIP 例外域名清单（用户可编辑）：undefined=用内置默认（DEFAULT_FAKEIP_FILTER_DOMAINS，与历史字节一致）；
  // 已编辑则存全量。仅 fakeIpFilter 开时生效。内置 captive 域名仍走内网解析器，其余按出口选解析器（见 singbox-dns-builder）。
  fakeIpFilterList?: string[];
  // #347：拨号前把目的域名解析成真实 IP 再交给出站（sing-box route action `resolve`），而非把域名随包发给节点。
  // **默认关**（仅 === true 才开）：#347 根因确认在机场侧屏蔽，本开关只是逃生口；且 resolve 失败即断连
  // （fail-closed，无兜底），默认开等于给所有连接加一个新单点。节点侧按域名做的分流/解锁在 IP 交付下机制上
  // 无法工作，实际影响面视机场而定。非 direct 模式、出口未整体回退直连、用户显式打开，三条全真才生效；
  // **不看 FakeIP 开关**（mixed-in 入站无条件发射，其目的地恒为域名）。
  // 单一真值见 custom-rule-files#resolvesDestinationAhead。
  resolveDestination?: boolean;
  // 核心更新：仅在配置生成器已验证的 sing-box minor 版本带内自动更新（默认 true）。关闭后允许自动
  // 更新跨越 minor（如 1.13→1.14），但跨 minor 的 schema 变更可能导致配置不兼容、需手动处理。
  restrictCoreUpdateToCompatibleMinor?: boolean;
  /** @deprecated 已迁移至 customRules（processName+direct）；仅保留兼容旧配置，ConfigManager 启动时清空迁移。 */
  bypassProcesses?: string[];

  // Runtime logging uses the managed info policy (warn in privacy mode).
  disableLogFile?: boolean;

  // clash_api(127.0.0.1:9090) 鉴权 secret：首次启动随机生成并持久化，统一管所有 clash_api 访问(含 external_ui)。
  // 内部调用(热切换/流量统计/拓扑)带 Authorization；防恶意网页跨域读连接历史。可在设置里查看/重置。
  clashApiSecret?: string;

  // sing-box 1.14 官方面板（opt-in 逃生舱）：开关 on 时在 api service（management api）注入 dashboard.enabled，
  // 核首次联网从官方仓拉 sing-box-dashboard 资源并于 api 监听口 /dashboard/ serve。默认关（undefined=false）；
  // 不随包静态文件，关时核绝不出网拉资源。非 boolean 一律 sanitize 删除（同 appRoutingEnabled 标准，不回填默认）。
  singboxDashboard?: boolean;

  // sing-box 官方面板资源 download_url 覆盖（可选）：空/未设 = 用内置默认（SagerNet/sing-box-dashboard gh-pages.zip）。
  // 下发前经 ghProxyPrefix 镜像加速包裹；改此值 → saveConfig 检测变更后删本地缓存目录，使核下次启动重拉新资源。
  // 暴露给用户作安全阀：默认 URL 失效时可手动改。空白字符串/非字符串一律 sanitize 删除（回落默认）。
  singboxDashboardUrl?: string;

  uiTheme?: 'light' | 'dark' | 'system';
}
