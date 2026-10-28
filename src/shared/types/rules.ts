export type RuleAction = 'proxy' | 'direct' | 'block';

/**
 * 旧版自定义规则结构（仅域名 + ipCidr）。保留供迁移读取旧配置/旧备份用，新代码一律用 {@link Rule}。
 * @deprecated 用 Rule
 */
export interface LegacyDomainRule {
  id: string;
  domains: string[];
  ipCidr?: string[];
  action: RuleAction;
  enabled: boolean;
  bypassFakeIP?: boolean;
  targetServerId?: string;
  remarks?: string;
}

/**
 * 自定义规则类型（对应 sing-box route rule 常用全集，去冗余）。
 * 域名类：domain/domainSuffix/domainKeyword/domainRegex；
 * IP/端口类：ipCidr(目的)/sourceIpCidr(源)/port(目的)/sourcePort(源)；
 * 源设备类（sing-box 1.14 LAN 设备识别）：sourceMac(源 MAC)/sourceHostname(源主机名)；
 * 进程类：processName/processPath；规则集类：geosite/geoip/ruleSet。
 */
export type RuleType =
  | 'domain'
  | 'domainSuffix'
  | 'domainKeyword'
  | 'domainRegex'
  | 'ipCidr'
  | 'sourceIpCidr'
  | 'port'
  | 'sourcePort'
  // sing-box 1.14 源设备识别（按 MAC / DHCP 主机名分流；仅 Linux/macOS，见 shared/neighbor.ts）。
  | 'sourceMac'
  | 'sourceHostname'
  | 'processName'
  | 'processPath'
  | 'processPathRegex'
  | 'geosite'
  | 'geoip'
  | 'ruleSet';

/** 单个匹配条件（type + values）。多条件规则用 conditions 数组承载。 */
export interface RuleCondition {
  type: RuleType;
  values: string[];
}

/**
 * 自定义路由规则（一条规则 = 单一 type + values 数组）。统一 values 为字符串数组：域名/CIDR/
 * 端口("443"或"1000-2000")/进程名/路径/geo 标签/规则集(URL 或 res:<resourceId>)，一项一条。
 */
export interface Rule {
  /** Local application identities for displaying/editing a process-path rule; multi-select stores every app. */
  applications?: InstalledApplication[];
  id: string;
  type: RuleType; // 首条件镜像（向后兼容旧消费点 + 回滚安全；恒与 conditions[0] 一致）
  values: string[]; // 首条件镜像
  /** 多条件共存（≥2 条件时存在；首条件镜像到 type/values）。空/缺省 = 单条件规则。 */
  conditions?: RuleCondition[];
  /** 多条件组合：'or'(默认，命中任一) / 'and'(全部命中)。单条件时无意义。 */
  combineMode?: 'and' | 'or';
  action: RuleAction;
  enabled: boolean;
  /** 绕过 FakeIP（仅 domain/domainSuffix/domainKeyword 有效） */
  bypassFakeIP?: boolean;
  /** 目标代理服务器 ID（仅当 action === 'proxy' 时有效） */
  targetServerId?: string;
  /** 规则备注说明 */
  remarks?: string;
  /**
   * TLS spoof（P3a 抗审查，sing-box 1.14 route action tls_spoof/tls_spoof_method）：对命中本规则的连接，
   * 真握手前发伪造 ClientHello 骗 SNI 过滤中间盒。tlsSpoof=伪造的白名单 SNI（域名，非空才生效），
   * tlsSpoofMethod=方法（wrong-ack/wrong-md5/wrong-timestamp）。两者须成对填写。
   * **硬限界（同 outbound spoof，见 shared/tls-spoof.ts）**：需提权、ARM64 不支持、SNI 须为域名（非 IP 字面量）。
   * 构建期按 arch/方法/IP 字面量门控（singbox-custom-rules applyRuleAction）。
   */
  tlsSpoof?: string;
  tlsSpoofMethod?: 'wrong-ack' | 'wrong-md5' | 'wrong-timestamp';
}

/** 系统进程信息（进程快速选择器用）。 */
export interface SystemProcessInfo {
  name: string;
  path?: string;
  count: number;
}

/** Installed application identity. Paths remain in the local user configuration. */
export interface InstalledApplication {
  id: string;
  name: string;
  path: string;
  processPaths: string[];
  processPathRegex: string[];
  coverage: 'bundle' | 'executable' | 'package' | 'unsupported';
  /** Android package identity; never inferred from the presentation label. */
  packageName?: string;
  /** Locally read PNG icon for presentation; never required for routing. */
  iconDataUrl?: string;
}

// 自定义规则集（从 URL 导入）
export interface CustomRuleSet {
  id: string;
  name: string;
  url: string; // 规则集 URL（.srs 或 .json）
  action: 'proxy' | 'direct' | 'block';
  enabled: boolean;
  addedAt: string;
}

// 应用分流规则（实验性）- 映射到内置 geosite 规则集
export interface AppRule {
  /** 应用 ID，对应 APP_PRESETS 中的 id 或 customAppPresets 中的 id */
  appId: string;
  action: RuleAction;
  enabled: boolean;
  /** 目标代理服务器 ID (仅当 action === 'proxy' 时有效) */
  targetServerId?: string;
}

/** 自定义应用分流预设（用户手动添加） */
export interface CustomAppPreset {
  id: string;
  name: string;
  emoji: string;
  /** Qure Color 等彩色图标集的应用图标 */
  iconUrl?: string;
  geositeTags: string[];
  geoipTags?: string[];
  /**
   * 进程名（真·应用分流，与内置预设 processNames 同源消费点 ProxyManager.effectiveAppRules）。
   * 由 getAppPreset 透传给配置生成：命中即按进程名路由，比 geo 域名匹配更精准（macOS/Windows/Linux TUN 模式）。
   */
  processNames?: string[];
  /** Exact executable paths and anchored application-directory patterns, including helpers. */
  processPaths?: string[];
  processPathRegex?: string[];
  installedApplication?: InstalledApplication;
  /**
   * 分类归属（纯 UI：应用卡按分类分组展示，可为内置 5 类之一或用户自建分类名）。
   * 配置生成不消费 category（后端只读 geositeTags/geoipTags/processNames），故仅影响卡片分组呈现。
   */
  category?: string;
}
