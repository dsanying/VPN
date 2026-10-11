import type { UserConfig, Rule, RuleCondition, LogLevel, Protocol, ProxyModeType } from './types';
import {
  RULE_TYPE_IDS,
  validateRuleValue,
  isValidIpCidr,
  migrateCustomRules,
  customRulesNeedMigration,
} from './rules';
import { DNS_TIMEOUT_MIN_MS, DNS_TIMEOUT_MAX_MS } from './dns';
import {
  ALL_PROTOCOLS as ALLOWED_PROTOCOLS,
  protocolRequirementError,
} from './server-completeness';
import { isAccountBasedProtocol } from './endpoint-routes';
import { isDirectSelection } from './direct-selection';
import { TUN_STACK_VALUES, TUN_MTU_MIN, TUN_MTU_MAX } from './tun-defaults';
import { dedupe } from './collections';
import { normalizeTunExcludeCidr } from './tun-route-exclude';

/** Canonical host-independent configuration migration and validation. Mutates a draft only. */
export function validateUserConfig(
  config: UserConfig,
  log: (level: LogLevel, message: string) => void = () => undefined
): void {
  // 验证必填字段
  if (!config) {
    throw new Error('Config is null or undefined');
  }

  // mixed-only 迁移 + 治理：本地端口收敛为单一 mixedPort（同口 HTTP+SOCKS）。
  // 种子：mixedPort 未设(>0) → 旧 httpPort（忽略历史 65533 哨兵；用户现 http 端口不变，仅 SOCKS app 需改指同口），
  //       再无则新装默认 7890。幂等：mixedPort 一旦 >0 不再改写。
  // 治理：彻底删除 deprecated httpPort/socksPort（不再写回持久化配置；运行时一律走 shared/proxy-ports#localProxyPort）。
  if (!config.mixedPort || config.mixedPort <= 0) {
    const legacyHttp =
      config.httpPort && config.httpPort > 0 && config.httpPort !== 65533
        ? config.httpPort
        : undefined;
    config.mixedPort = legacyHttp || 7890;
  }
  delete config.httpPort;
  delete config.socksPort;

  // 远程实例 feature 已移除（UserConfig 类型已删 remoteInstances/activeInstanceId）→ 彻底清除旧版升级用户
  // config.json 里的死字段残留。删除而非脱敏：feature 不存在，留着只会让明文 Bearer secret（remoteInstances[].secret）
  // 既继续写盘、又随 CONFIG_GET 内联回退（`{...cfg}`）下发渲染端，破坏「远程 secret 明文永不出主进程」不变量。
  // 经 saveConfig→validateConfig（loadConfig 与持久化两路径都过此）一次性清，下次落盘即不再写回。类型已无故 cast。
  delete (config as unknown as Record<string, unknown>).remoteInstances;
  delete (config as unknown as Record<string, unknown>).activeInstanceId;

  // 控制端口（clash_api external_controller）：未设(>0) → 默认 9090（DEFAULT_CONTROL_PORT）。可改以解端口冲突死局。
  // 防自撞：与本地端口同口则回退（9090，仍同则取 9091），杜绝 clash_api 与 mixed inbound 撞口致 sing-box FATAL。
  // 作用域：此 guard 护持久化/loadConfig 路径（saveConfig 亦经 validateConfig）。运行时 start() 收到的是渲染端
  // 内存 config、不经此重校验，那条路径的同口由 UI 两个 commit 守卫拦下。未来若加 config 导入，须在导入处复用本校验。
  if (!config.controlPort || config.controlPort <= 0) {
    config.controlPort = 9090;
  }
  if (config.controlPort === config.mixedPort) {
    config.controlPort = config.mixedPort === 9090 ? 9091 : 9090;
  }

  // 自动迁移：旧版自定义规则（DomainRule: domains+ipCidr）→ 新版 Rule（type+values）。
  // 必须在下方 customRules 校验之前（旧 shape 会被新校验判废 → loadConfig catch 覆盖保存 → 规则全丢）。
  // 幂等：已是新 shape 原样保留。
  if (Array.isArray(config.customRules) && customRulesNeedMigration(config.customRules)) {
    config.customRules = migrateCustomRules(config.customRules);
  }

  // 自动迁移：旧「排除进程」(bypassProcesses) → 自定义规则 processName+直连（功能等价，见设计评估）。
  // 追加到 customRules 末尾 → 在 rules 数组中的位置与旧 bypassProcesses 一致（所有自定义规则后、appRules 前），
  // 路由逐位等价。固定 id 天然幂等；清空 bypassProcesses 即迁移标记。必须在 customRules 软校验之前。
  if (Array.isArray(config.bypassProcesses) && config.bypassProcesses.length > 0) {
    // 非字符串元素（旁路 config:save/损坏备份导入可注入）走 typeof 守卫，避免 (123).trim() 抛错 →
    // validateConfig throw → loadConfig catch → 默认配置覆盖落盘 → servers/订阅/规则全丢（与 416 行同标准）。
    const values = Array.from(
      new Set(
        config.bypassProcesses.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean)
      )
    );
    // 去重 id：仅手改/拼接配置可能让 customRules 已含同 id（正常路径成对落盘不会），防重复 id 致列表 React key 冲突 + 更新/删除只命中首条。
    const alreadyMigrated =
      Array.isArray(config.customRules) &&
      config.customRules.some((r) => r && r.id === 'migrated_bypass_processes');
    if (values.length > 0 && !alreadyMigrated) {
      if (!Array.isArray(config.customRules)) config.customRules = [];
      config.customRules.push({
        id: 'migrated_bypass_processes',
        type: 'processName',
        values,
        action: 'direct',
        enabled: true,
        remarks: '排除进程（自动迁移）',
      });
    }
    config.bypassProcesses = [];
  }

  // 验证 subscriptions 数组 (兼容旧配置)
  if (config.subscriptions) {
    if (!Array.isArray(config.subscriptions)) {
      // 非数组是不可逐项 sanitize 的结构错误 → 交 loadConfig catch（已备份不覆盖），不静默改类型。
      throw new Error('subscriptions must be an array');
    }
    // 逐订阅校验：缺 id/name/url 的坏订阅一律【剔除该条】而非 throw。原 throw 会走 loadConfig catch → 默认
    // 配置覆盖落盘 → 用户全部 servers/订阅/规则丢失；坏订阅本就无法拉取更新，剔除它无功能损失且保住其余
    // 合法订阅/节点/规则（与 servers/customRules/CIDR 同 sanitize 标准）。
    let droppedSubs = 0;
    config.subscriptions = config.subscriptions.filter((sub) => {
      if (
        !sub ||
        !sub.id ||
        typeof sub.id !== 'string' ||
        !sub.name ||
        typeof sub.name !== 'string' ||
        !sub.url ||
        typeof sub.url !== 'string'
      ) {
        droppedSubs++;
        return false;
      }
      return true;
    });
    if (droppedSubs > 0) {
      log('warn', `[ConfigManager] 丢弃 ${droppedSubs} 条非法订阅（缺 id/name/url）`);
    }
  } else {
    config.subscriptions = [];
  }

  // 验证 servers 数组
  if (!Array.isArray(config.servers)) {
    // 非数组是不可逐项 sanitize 的结构错误 → 交 loadConfig catch（已备份不覆盖）。
    throw new Error('servers must be an array');
  }

  // 逐节点校验：结构性非法节点（无 id/name、未知协议、非账号制却缺 address/port、协议必填字段缺失如 anytls
  // 无密码）一律【剔除该节点】而非 throw。原 throw 会走 loadConfig catch → 默认配置覆盖落盘 → 用户全部
  // servers/订阅/规则丢失且无备份；坏节点本就连不通，剔除它无功能损失，且保住其余合法节点（与 CIDR/
  // customRules/订阅同 sanitize 标准）。合法节点仍走下方 CIDR/allowInternet 就地清洗。
  let droppedServers = 0;
  let droppedCidrs = 0; // endpoint 节点的非法 CIDR（allowedIPs/routes）一律丢弃而非 throw（见循环内说明）
  config.servers = config.servers.filter((server) => {
    if (!server || !server.id || typeof server.id !== 'string') {
      droppedServers++;
      return false;
    }
    if (!server.name || typeof server.name !== 'string') {
      droppedServers++;
      return false;
    }
    const protocolLower = server.protocol?.toLowerCase();
    if (!protocolLower || !ALLOWED_PROTOCOLS.includes(protocolLower as Protocol)) {
      droppedServers++;
      return false;
    }
    // 账号制协议（Tailscale，连控制面）/ custom（raw-JSON 自带 server/port）→ 豁免 address/port；其余必须有。
    if (!isAccountBasedProtocol(protocolLower) && protocolLower !== 'custom') {
      if (!server.address || typeof server.address !== 'string') {
        droppedServers++;
        return false;
      }
      if (
        !server.port ||
        typeof server.port !== 'number' ||
        !Number.isInteger(server.port) ||
        server.port < 1 ||
        server.port > 65535
      ) {
        droppedServers++;
        return false;
      }
    }

    // 协议特有必填校验（单一真值 shared/server-completeness.protocolRequirementError，与渲染侧首页连接
    // 闸门 isServerComplete 共用）。缺必填字段（如 anytls 无密码、其余协议漏字段）→ 剔除该节点（改 sanitize：
    // 原 throw 会致整配置回落默认丢全量；无必填字段的节点本就连不通，剔除无功能损失，与 isServerComplete 判废一致）。
    const protocolError = protocolRequirementError(server);
    if (protocolError) {
      droppedServers++;
      return false;
    }

    // endpoint 节点的 CIDR/地址一律 sanitize 而非 throw：WG localAddress→endpoint.address、allowedIPs→
    // peer.allowed_ips、TS routes→force-route ip_cidr，脏值（缺掩码、含空格、八位组/掩码越界如 10.0.0.0/40）
    // 会让内核启动 FATAL。用 isValidIpCidr（含范围校验）丢弃非法项 + 告警，保留合法项——避免单条脏 CIDR 阻断
    // 全部启动，也避免 throw 走 loadConfig catch 回落默认配置致用户节点全丢（与 customRules 容错同型）。
    const sanitizeCidrs = (list: string[] | undefined): string[] | undefined => {
      if (!Array.isArray(list)) return list;
      const cleaned = list
        .map((c) => (typeof c === 'string' ? c.trim() : ''))
        .filter((c) => isValidIpCidr(c));
      droppedCidrs += list.length - cleaned.length;
      return cleaned;
    };
    // allowInternet（组网「允许访问外网」开关）：纯开关字段，非 boolean 一律剔除而非 throw（缺省=true，向后兼容
    // D5）。throw 在 loadConfig 路径会触发默认配置覆盖落盘致用户节点全丢，不值当（同 appRoutingEnabled 标准）。
    const sanitizeAllowInternet = (s: { allowInternet?: boolean } | undefined): void => {
      if (s && s.allowInternet !== undefined && typeof s.allowInternet !== 'boolean') {
        delete s.allowInternet;
      }
    };
    if (server.wireguardSettings) {
      // localAddress 是接口地址（进 endpoint.address），同样必须是合法 IP/CIDR，否则内核 FATAL。
      // localAddress 为必填 string[]（protocolRequirementError 已保证此处非空数组），仅在确为数组时回写。
      const cleanedLocal = sanitizeCidrs(server.wireguardSettings.localAddress);
      if (Array.isArray(cleanedLocal)) server.wireguardSettings.localAddress = cleanedLocal;
      server.wireguardSettings.allowedIPs = sanitizeCidrs(server.wireguardSettings.allowedIPs);
      sanitizeAllowInternet(server.wireguardSettings);
    }
    if (server.tailscaleSettings) {
      server.tailscaleSettings.routes = sanitizeCidrs(server.tailscaleSettings.routes);
      server.tailscaleSettings.advertiseRoutes = sanitizeCidrs(
        server.tailscaleSettings.advertiseRoutes
      );
      sanitizeAllowInternet(server.tailscaleSettings);
    }
    return true;
  });
  if (droppedServers > 0) {
    log(
      'warn',
      `[ConfigManager] 丢弃 ${droppedServers} 个结构非法节点（无 id/name、未知协议、缺 address/port 或协议必填缺失）`
    );
  }
  if (droppedCidrs > 0) {
    log('warn', `[ConfigManager] 丢弃 ${droppedCidrs} 处非法 CIDR（endpoint allowedIPs/routes）`);
  }

  // Tailscale 单节点硬限兜底归一：同设备所有 TS 账号共用同一段 tailnet 地址，多个会互相顶掉，全局只许一个。
  // UI 主拦截点（use-server-actions）已从源头挡住，正常配置不触发；此处仅对「已是非法多 TS 状态」（旁路
  // config:save / 损坏备份导入 / 手改配置）归一：保留第一个、丢弃其余。沿用 sanitize 不 throw 惯例——绝不连累
  // 整份配置回落默认（loadConfig catch 会用默认覆盖落盘致节点/订阅/规则全丢，与上方 CIDR/规则容错同标准）。
  let firstTailscaleSeen = false;
  let droppedTailscale = 0;
  config.servers = config.servers.filter((s) => {
    if (s.protocol?.toLowerCase() !== 'tailscale') return true;
    if (!firstTailscaleSeen) {
      firstTailscaleSeen = true;
      return true;
    }
    droppedTailscale++;
    return false;
  });
  if (droppedTailscale > 0) {
    log(
      'warn',
      `[ConfigManager] Tailscale 单节点硬限：丢弃 ${droppedTailscale} 个多余 Tailscale 节点（保留第一个）`
    );
  }

  // selectedServerId 校验 + sanitize（'__direct__' 哨兵=全局直连，非真实节点，豁免存在性校验，见 shared/direct-selection）。
  // 悬空/类型非法一律【归 null】而非 throw：上方 sanitize 可能已剔除 selectedServerId 指向的节点（结构非法坏节点 /
  // Tailscale 单节点硬限去重丢弃多余 TS 节点），此时 throw 会走 loadConfig catch → 整配置回落默认致 servers/订阅/
  // 规则全丢。归 null（回落「未选节点」，用户重选即可）零功能损失，与本文件 sanitize-不-throw 惯例一致。
  if (config.selectedServerId !== null && !isDirectSelection(config.selectedServerId)) {
    if (typeof config.selectedServerId !== 'string') {
      log('warn', '[ConfigManager] selectedServerId 类型非法，归零为未选节点');
      config.selectedServerId = null;
    } else if (!config.servers.some((s) => s.id === config.selectedServerId)) {
      log(
        'warn',
        '[ConfigManager] selectedServerId 指向已不存在的节点（坏节点已剔除 / Tailscale 去重），归零为未选节点'
      );
      config.selectedServerId = null;
    }
  }

  // 验证 proxyMode（不区分大小写）
  const proxyModeLower = config.proxyMode?.toLowerCase();
  if (!proxyModeLower || !['global', 'smart', 'direct'].includes(proxyModeLower)) {
    throw new Error('proxyMode must be global, smart, or direct');
  }

  // 验证 proxyModeType（不区分大小写），并回写到**权威 camelCase 规范值**。validateConfig 是
  // loadConfig/saveConfig 的必经校验，回写后磁盘值恒为规范形 → 全栈精确比较（=== 'systemProxy' /
  // === 'tun' / === 'manual'）可信，消除大小写漂移致日志静默丢失/幽灵文件风险。
  // 关键：必须归一到 camelCase 'systemProxy'（ProxyModeType 联合类型与 ProxyManager 谓词均为
  // camelCase），不能盲 toLowerCase——后者把 'systemProxy' 变 'systemproxy'，使 ProxyManager.ts
  // 的 === 'systemProxy' 恒 false、系统代理分支永不命中（系统代理从不设置 → 流量直连泄漏）。
  const CANONICAL_MODE_TYPE: Record<string, ProxyModeType> = {
    systemproxy: 'systemProxy',
    tun: 'tun',
    manual: 'manual',
  };
  const modeTypeLower = config.proxyModeType?.toLowerCase();
  if (!modeTypeLower || !(modeTypeLower in CANONICAL_MODE_TYPE)) {
    throw new Error('proxyModeType must be systemProxy, tun, or manual');
  }
  config.proxyModeType = CANONICAL_MODE_TYPE[modeTypeLower];

  // 验证 tunConfig
  if (!config.tunConfig) {
    throw new Error('tunConfig is required');
  }
  // mtu 与 stack 同形：'auto' = 跟随 (平台 × 具体栈) 映射（解析期落值，见 shared/tun-defaults#resolveTunMtu）；
  // 数值 = 用户显式指定，仍限区间。放行 'auto' 是本模型的前提——存储存意图而非死数字。
  if (
    config.tunConfig.mtu !== 'auto' &&
    (typeof config.tunConfig.mtu !== 'number' ||
      config.tunConfig.mtu < TUN_MTU_MIN ||
      config.tunConfig.mtu > TUN_MTU_MAX)
  ) {
    throw new Error(
      `tunConfig.mtu must be 'auto' or a number between ${TUN_MTU_MIN} and ${TUN_MTU_MAX}`
    );
  }
  if (!TUN_STACK_VALUES.includes(config.tunConfig.stack)) {
    throw new Error('tunConfig.stack must be auto, system, gvisor, or mixed');
  }
  if (typeof config.tunConfig.autoRoute !== 'boolean') {
    throw new Error('tunConfig.autoRoute must be a boolean');
  }
  if (typeof config.tunConfig.strictRoute !== 'boolean') {
    throw new Error('tunConfig.strictRoute must be a boolean');
  }

  // inboundExcludeCidrs sanitize（「连入来源排除」网段，一律不 throw——防单条脏数据触发整配置回落默认）：
  // normalizeTunExcludeCidr 规范化：裸 IP 补 /32|/128、拒 catch-all/过宽（0.0.0.0/0 等会排空 TUN→代理失效）、
  // 严格校验（sing-box netip 口径：段≤255/前缀合法/禁前导零）。非法/过宽静默剔除并告警——否则直通
  // route_exclude_address 致 sing-box check FATAL（裸 IP `no '/'` / 过宽排空 TUN）。dropped 只计真·非法（不含去重）。
  // 空/全非法 / 非数组 → **删字段**（回落 undefined「无排除」）：保留 [] 会让 configGenerationNorm 翻转触发无谓重启。
  if (config.tunConfig.inboundExcludeCidrs !== undefined) {
    if (!Array.isArray(config.tunConfig.inboundExcludeCidrs)) {
      delete config.tunConfig.inboundExcludeCidrs;
    } else {
      const raw = config.tunConfig.inboundExcludeCidrs;
      const cleaned: string[] = [];
      let dropped = 0;
      for (const c of raw) {
        const n = normalizeTunExcludeCidr(c as string);
        if (n === null) dropped++;
        else cleaned.push(n);
      }
      const deduped = dedupe(cleaned);
      if (dropped > 0) {
        log(
          'warn',
          `[ConfigManager] tunConfig.inboundExcludeCidrs 剔除 ${dropped} 条非法/过宽网段（须合法 CIDR，不含 0.0.0.0/0 等过宽段）`
        );
      }
      if (deduped.length > 0) config.tunConfig.inboundExcludeCidrs = deduped;
      else delete config.tunConfig.inboundExcludeCidrs; // 空 → 删（避免 [] 触发 norm 翻转/无谓重启）
    }
  }

  // P2c DNS 查询超时 sanitize（一律不 throw，与上方 CIDR/规则同标准防整配置回落）：
  // dnsTimeoutMs 必为有限正整数且 ∈ DNS_TIMEOUT_MIN_MS..MAX_MS，否则删除该字段 → 回落核默认。
  // 区间取 shared/dns 的常量（与设置页表单校验、越界提示文案同源，杜绝三处各写一份数字）。
  // dns-builder 仅在 >0 时 emit "<n>ms"，此处提前清洗使持久化配置不留脏值（saveConfig 亦经本校验）。
  if (config.dnsConfig && config.dnsConfig.dnsTimeoutMs !== undefined) {
    const ms = config.dnsConfig.dnsTimeoutMs;
    if (
      typeof ms !== 'number' ||
      !Number.isFinite(ms) ||
      ms < DNS_TIMEOUT_MIN_MS ||
      ms > DNS_TIMEOUT_MAX_MS
    ) {
      delete config.dnsConfig.dnsTimeoutMs;
      log(
        'warn',
        `[ConfigManager] 丢弃非法 dns.timeout（须 ${DNS_TIMEOUT_MIN_MS}..${DNS_TIMEOUT_MAX_MS}ms）: ${ms}`
      );
    } else if (!Number.isInteger(ms)) {
      config.dnsConfig.dnsTimeoutMs = Math.round(ms);
    }
  }

  // 校验 customRules（新 Rule shape）。**一律告警不 throw**：防单条脏数据触发整配置回落
  // 默认（loadConfig catch 会用默认配置覆盖保存 → 用户规则全丢）。结构非法的规则丢弃，值非法仅告警保留。
  // 单条脏配置可批量出现 → 丢弃/sanitize 事件累计计数，循环结束后各汇总一条，防逐条刷屏。
  if (!Array.isArray(config.customRules)) {
    config.customRules = [];
  }
  let droppedRules = 0; // 整条丢弃（无 id / 未知类型 / 结构非法）
  let sanitizedIssues = 0; // 保留但 sanitize（值可能非法保留、conditions/combineMode 清洗）
  config.customRules = (config.customRules as Rule[]).filter((rule) => {
    if (!rule || typeof rule.id !== 'string' || !rule.id) {
      droppedRules++;
      return false;
    }
    if (!RULE_TYPE_IDS.includes(rule.type)) {
      droppedRules++;
      return false;
    }
    if (
      !Array.isArray(rule.values) ||
      !['proxy', 'direct', 'block'].includes(rule.action) ||
      typeof rule.enabled !== 'boolean'
    ) {
      droppedRules++;
      return false;
    }
    // 过滤非字符串 values 元素（旁路 config:save/备份导入可注入），防生成期 v.trim()/v.startsWith() 崩溃
    rule.values = rule.values.filter((v) => typeof v === 'string');
    for (const v of rule.values) {
      if (v.trim() && !validateRuleValue(rule.type, v)) {
        sanitizedIssues++;
      }
    }
    // 多条件 conditions/combineMode sanitize：旁路注入可塞入非数组 conditions、非法
    // 类型 / 非字符串值 / 非法 combineMode，会让生成期 ruleConditions() 遍历崩溃。结构非法
    // 的整条 conditions 丢弃（退化为单条件 type/values），值非法仅告警保留（同 values 策略）。
    if (rule.conditions !== undefined) {
      if (!Array.isArray(rule.conditions)) {
        sanitizedIssues++;
        delete rule.conditions;
      } else {
        const cleaned: RuleCondition[] = [];
        for (const cond of rule.conditions) {
          if (
            !cond ||
            typeof cond !== 'object' ||
            !RULE_TYPE_IDS.includes((cond as RuleCondition).type)
          ) {
            sanitizedIssues++;
            continue;
          }
          const c = cond as RuleCondition;
          const vals = Array.isArray(c.values) ? c.values.filter((v) => typeof v === 'string') : [];
          if (vals.length === 0) {
            sanitizedIssues++;
            continue;
          }
          for (const v of vals) {
            if (v.trim() && !validateRuleValue(c.type, v)) {
              sanitizedIssues++;
            }
          }
          cleaned.push({ type: c.type, values: vals });
        }
        // 全部 condition 被丢弃 → 删除 conditions，退化为单条件（type/values 仍有效）；否则回写清洗后的
        if (cleaned.length === 0) {
          delete rule.conditions;
        } else {
          rule.conditions = cleaned;
          // 镜像同步：type/values 必须等于首条件（消费点/列表 Badge/回滚兼容均读镜像）。若 sanitize 丢了
          // 原 conditions[0]，镜像会指向一个不再参与生成的条件 → 强制重镜像 cleaned[0]，杜绝展示/生成错位。
          rule.type = cleaned[0].type;
          rule.values = [...cleaned[0].values];
        }
      }
    }
    if (rule.combineMode !== undefined && rule.combineMode !== 'and' && rule.combineMode !== 'or') {
      sanitizedIssues++;
      delete rule.combineMode;
    }
    return true;
  });
  // 汇总告警（替代逐条），防单份脏配置批量刷屏
  if (droppedRules > 0) {
    log('warn', `[ConfigManager] 丢弃 ${droppedRules} 条非法规则`);
  }
  if (sanitizedIssues > 0) {
    log('warn', `[ConfigManager] 清洗 ${sanitizedIssues} 处规则非法字段（已保留/重置默认）`);
  }

  // 验证布尔值字段
  if (typeof config.autoStart !== 'boolean') {
    throw new Error('autoStart must be a boolean');
  }
  // silentStart 是新增字段，兼容旧配置
  if (config.silentStart !== undefined && typeof config.silentStart !== 'boolean') {
    throw new Error('silentStart must be a boolean');
  }
  if (config.silentStart === undefined) {
    config.silentStart = false; // 默认值
  }
  // language 是界面语言「选择」（'auto'|具体码）的单一真值源。非 string 或空串一律删（sanitize 不 throw，同纯开关字段标准）——
  // 删后视为缺省，resolveEffectiveLanguage 会退回系统解析。空串尤其要删：留着会让渲染端迁移 effect 的 `!language` 守卫
  // 永不收敛（无限回填）。不回填默认（存量缺该键由渲染端从 localStorage 迁移回填）。
  if (
    config.language !== undefined &&
    (typeof config.language !== 'string' || config.language === '')
  ) {
    log('warn', 'language must be a non-empty string; removing invalid value');
    delete config.language;
  }
  // appRoutingEnabled：undefined=关闭（默认关；不回填以减少 config 写放大；gate 用 !== true）。
  // 纯开关字段非法值 sanitize 而非 throw——throw 在 loadConfig 路径会触发默认配置覆盖落盘致全丢，不值当。
  if (config.appRoutingEnabled !== undefined && typeof config.appRoutingEnabled !== 'boolean') {
    log('warn', 'appRoutingEnabled must be a boolean; resetting to default (disabled)');
    delete config.appRoutingEnabled;
  }
  // singboxDashboard：纯开关字段。**两个「默认」不是同一个**，别按其一去读另一个：
  //   - **新装种子 = true**（见下方 getDefaultConfig 的 singboxDashboard），故全量新装用户开着面板；
  //   - **本 sanitize 的回落 = undefined**，而读取端（ProxyManager 注入 dashboard、设置页）按 truthiness 判 ⇒ 关。
  // 非 boolean 一律删除而非 throw（同 appRoutingEnabled 标准，不回填默认）——throw 在 loadConfig 路径会触发
  // 默认配置覆盖落盘致用户节点/订阅/规则全丢，不值当。
  if (config.singboxDashboard !== undefined && typeof config.singboxDashboard !== 'boolean') {
    log('warn', 'singboxDashboard must be a boolean; dropping it (falls back to disabled)');
    delete config.singboxDashboard;
  }
  // singboxDashboardUrl：可选 download_url 覆盖。非字符串或空白一律删除（回落内置默认 URL）；sanitize 而非 throw。
  if (config.singboxDashboardUrl !== undefined) {
    if (
      typeof config.singboxDashboardUrl !== 'string' ||
      config.singboxDashboardUrl.trim() === ''
    ) {
      delete config.singboxDashboardUrl;
    } else {
      config.singboxDashboardUrl = config.singboxDashboardUrl.trim();
    }
  }

  // mainSessionViaProxy 新增字段：非法类型 sanitize（undefined=true 兼容老配置，gate 用 !== false）
  if (config.mainSessionViaProxy !== undefined && typeof config.mainSessionViaProxy !== 'boolean') {
    log('warn', 'mainSessionViaProxy must be a boolean; resetting to default (enabled)');
    delete config.mainSessionViaProxy;
  }
  if (typeof config.autoConnect !== 'boolean') {
    throw new Error('autoConnect must be a boolean');
  }
  if (typeof config.minimizeToTray !== 'boolean') {
    throw new Error('minimizeToTray must be a boolean');
  }
  // 图形兼容逃生门（正向纯开关，默认开=true；undefined=未设/旧配置，读取端一律 `!== false` 视为开）：
  // 非 boolean 一律删除而非 throw（同 appRoutingEnabled/singboxDashboard 标准——throw 在 loadConfig 路径会触发
  // 默认配置覆盖落盘致用户节点/订阅/规则全丢，不值当）。删除即回落 undefined = 默认开，语义自洽、无需回填。
  if (
    config.hardwareAcceleration !== undefined &&
    typeof config.hardwareAcceleration !== 'boolean'
  ) {
    log('warn', 'hardwareAcceleration must be a boolean; resetting to default (enabled)');
    delete config.hardwareAcceleration;
  }
  if (config.windowEffects !== undefined && typeof config.windowEffects !== 'boolean') {
    log('warn', 'windowEffects must be a boolean; resetting to default (enabled)');
    delete config.windowEffects;
  }

  // autoLightweightMode 是可选字段，兼容旧配置
  if (config.autoLightweightMode !== undefined && typeof config.autoLightweightMode !== 'boolean') {
    throw new Error('autoLightweightMode must be a boolean');
  }
  // 如果未定义，设置默认值
  if (config.autoLightweightMode === undefined) {
    config.autoLightweightMode = false;
  }

  // rememberWindowSize 是可选字段，兼容旧配置
  if (config.rememberWindowSize !== undefined && typeof config.rememberWindowSize !== 'boolean') {
    throw new Error('rememberWindowSize must be a boolean');
  }
  // 默认启用（与 DEFAULT_CONFIG 一致）：未显式设置过的配置（含旧配置缺该键）按「记忆窗口大小」默认开启；
  // 显式设为 false 的用户配置不受影响（非 undefined，上面已放行）。
  if (config.rememberWindowSize === undefined) {
    config.rememberWindowSize = true;
  }

  // 默认启用（与 DEFAULT_CONFIG 一致）：未显式设置过的配置（含旧配置缺该键）切换节点默认断开旧连接；
  // 显式设为 false 的用户配置不受影响（非 undefined）。
  if (config.interruptConnectionsOnSwitch === undefined) {
    config.interruptConnectionsOnSwitch = true;
  }

  // §2 待应用差集开关：归一为严格 boolean（默认 false=OFF=进待应用）。UI 经 setBool 只写 boolean，但手编 config
  // 写非布尔值（"yes" 等）会被 switchMode 的 !newConfig.restartOnNodeChange 真值强转成 ON → 显式规整杜绝。
  config.restartOnNodeChange = config.restartOnNodeChange === true;

  // bypassProcesses 是可选字段，兼容旧配置
  if (config.bypassProcesses === undefined) {
    config.bypassProcesses = [];
  }
  if (!Array.isArray(config.bypassProcesses)) {
    throw new Error('bypassProcesses must be an array');
  }

  // 验证端口（mixed-only：canonical = mixedPort；http/socks 为 deprecated，仅在存在时宽松校验）
  if (typeof config.mixedPort !== 'number' || config.mixedPort < 1 || config.mixedPort > 65535) {
    throw new Error('mixedPort must be a number between 1 and 65535');
  }
  if (
    config.controlPort !== undefined &&
    (typeof config.controlPort !== 'number' || config.controlPort < 1 || config.controlPort > 65535)
  ) {
    throw new Error('controlPort must be a number between 1 and 65535');
  }
  if (
    config.socksPort !== undefined &&
    (typeof config.socksPort !== 'number' || config.socksPort < 1 || config.socksPort > 65535)
  ) {
    throw new Error('socksPort must be a number between 1 and 65535');
  }
  if (
    config.httpPort !== undefined &&
    (typeof config.httpPort !== 'number' || config.httpPort < 1 || config.httpPort > 65535)
  ) {
    throw new Error('httpPort must be a number between 1 and 65535');
  }
}
