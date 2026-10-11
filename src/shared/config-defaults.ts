import { DEFAULT_DNS_ENDPOINTS } from './dns';
import type { UserConfig } from './types';

/** One installation seed, independent of host storage and cryptographic providers. */
export function createDefaultConfig(installationSecret: string): UserConfig {
  return {
    subscriptions: [],
    servers: [],
    selectedServerId: null,
    proxyMode: 'global',
    proxyModeType: 'tun', // 只使用 TUN，不写系统代理设置
    tunConfig: {
      // 'auto' = 跟随 (平台 × 具体栈) 映射，解析期落值（resolveTunMtu / resolveTunStack），新装直接用新模型。
      mtu: 'auto',
      stack: 'auto',
      autoRoute: true,
      strictRoute: true,
    },
    tunStackMigrated: true, // 新装即新模型，迁移幂等跳过（对齐 fakeIpToggleMigrated 新装置位）
    tunMtuMigrated: true, // 同上；两标记分离，勿合并（见 shared/tun-defaults#migrateTunDefaults）
    customRules: [],
    autoStart: false,
    silentStart: false,
    autoConnect: false,
    minimizeToTray: true,
    autoLightweightMode: false, // 默认不启用自动轻量模式
    hardwareAcceleration: true, // 图形兼容逃生门：默认开（关闭=opt-in 自救，app ready 前禁硬件加速改软件渲染，见 services/graphics-compat）
    windowEffects: true, // 窗口特效（Win Mica / mac 毛玻璃）默认开；关闭=opt-in 自救，主窗回落实色底
    desktopNotifications: true, // 桌面通知总开关，默认开（仅严重错误事件发通知）
    rememberWindowSize: true, // 默认启用记忆窗口大小（用户调整后下次沿用；已显式关闭的用户配置不受影响）
    interruptConnectionsOnSwitch: true, // 切换节点默认断开旧连接（精准断连 pair 模型，避免误杀规则固定节点；已显式关闭的用户配置不受影响）
    enableIPv6: false, // 默认不启用 IPv6 解析（防假死兜底）
    autoPrivacyMode: false, // 默认不启用隐私模式
    privacyPassword: '', // 默认隐私模式密码为空

    // 默认 DNS 配置
    dnsConfig: {
      domesticDns: DEFAULT_DNS_ENDPOINTS.direct,
      foreignDns: DEFAULT_DNS_ENDPOINTS.proxy,
      takeoverSystemDns: false, // 保留系统/内网 DNS，禁止接管
      // issue #147 节点域名解析（多源 race）：新装默认 race-on、池=AliDNS+DNSPod；off 单选默认 Ali。
      nodeResolverPool: ['ali', 'dnspod'],
      nodeResolverSingle: 'ali',
      nodeResolverMigrated: true, // 新装无需迁移：直接落新模型默认，标记防 migrate 再改写
    },

    customRuleSets: [], // 默认空
    appRules: [], // Only user-selected installed applications have application rules.
    appRulesSeeded: true, // Legacy compatibility marker; service defaults are no longer seeded.
    appRoutingEnabled: false, // 应用分流总开关默认关闭（仅影响新装/回落；undefined 亦视为关闭，见 effectiveAppRules/UI 读取端）
    fakeIpFilter: true, // fake-ip-filter 默认清单默认开启（NTP/STUN/Captive 走真实解析；老配置 undefined 亦视为开）
    singboxDashboard: true, // sing-box 1.14 官方面板默认开（services dashboard 本地 serve，零联网拉取）

    mixedPort: 7890, // mixed-only canonical 本地端口（同口 HTTP+SOCKS）；新装默认对齐业内 7890（存量经迁移沿用原 httpPort）。
    controlPort: 9090, // clash_api 外部控制端口（对齐业内 9090）；可改以解端口冲突死局。
    // 注：不再设 httpPort/socksPort（mixed-only 已治理；旧配置经 loadConfig 迁移删除这两个 deprecated 字段）。
    disableLogFile: false,
    clashApiSecret: installationSecret,
    uiTheme: 'system',
    language: 'auto', // 界面语言默认「自动（跟随系统）」；新装即有值，存量缺键由渲染端从 localStorage 迁移回填
  };
}
