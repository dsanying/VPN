import { RUNTIME_POLICY } from '../../shared/runtime-policy';
/**
 * 自定义规则外化为 per-rule local rule_set（source headless）的单一真值决策模块（纯函数，可单测）。
 *
 * 目的：把「全条件可 headless 表达」的启用 customRule 写成独立 `<userData>/custom-rules/custom-rule-<id>.json`
 * 文件，route 规则固化为 `{rule_set:<base>}`；编辑规则「值」→ 原子替换文件 → sing-box fswatch 热重载、零重启。
 *
 * 关键不变量：本模块的「可外化判定 / 值翻译 / mergeable·fail-closed·logical 结构」必须与 ProxyManager
 * generateCustomRules（route 侧）和 generateDnsConfig 的 bypassFakeIP 块（DNS 侧）**逐字等价**——
 * ProxyManager 的 EXT 类型分支与 DNS 提取应委托本模块，避免双份逻辑漂移。
 */
import { createHash } from 'crypto';
import type { UserConfig } from '../../shared/types';
import { planCustomRule } from '../../shared/rule-compilation';
export { EXT_TYPES, condMatcherFields, planCustomRule } from '../../shared/rule-compilation';
export type { RulePlan } from '../../shared/rule-compilation';
import { meshSelectedExitFallsBackToDirect } from '../../shared/endpoint-routes';

/** 文件名安全的 base：id 仅 [A-Za-z0-9_-] → custom-rule-<id>；否则 hash（旧 id 可能含任意字符）。 */
export function customRuleFileBase(id: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(id)) return `custom-rule-${id}`;
  return `custom-rule-h${createHash('sha1').update(id).digest('hex').slice(0, 12)}`;
}

/** Managed DNS policy: FakeIP preserves the original domain for proxy routing. */
export function usesFakeIp(_config: UserConfig): boolean {
  return RUNTIME_POLICY.fakeIp;
}

/**
 * #347：拨号前把目的域名解析成真实 IP 再交给出站（route action `resolve`）——单一真值，默认值只在这一处定义。
 *
 * 为什么需要：sing-box 1.13+ 移除 `sniff_override_destination` 且无替代，FakeIP 反查出的域名会原样随包发给
 * 节点（`outbound connection to www.example.org:443`）。节点侧的策略或其自身解析器于是成为单点——#347 报告者
 * 的三个站点全部在建连后 78–107ms 被对端 FIN，同机场同时段的对照站点零关闭；同机场的 NekoBox（开着 FakeDNS
 * 但拨号前解析成真 IP）一切正常。A/B 对照的唯一变量就是目的地交付形态。
 *
 * 三个条件全真才发射：
 *   · 非 direct 模式 —— 出口恒直连，direct 出站自带 happy-eyeballs 并行拨号，插 resolve 只会换掉解析器且丢并行；
 *   · 出口未整体回退直连 —— 见下方 exitFallback 段，与 direct 模式同根因；
 *   · **用户显式打开**（`=== true`）。
 *
 * **默认关的三条理由（按确定性排序）：**
 *   1. #347 的根因已确认在**机场侧屏蔽**，本开关只是绕开它的逃生口，不该为此改变所有用户的目的地交付形态；
 *   2. fail-closed：resolve 失败直接断连（见下），把 dns-remote 从「只影响 endpoint 拨号解析」升级成
 *      「每条经代理连接的硬前置」——默认开等于给所有人加一个新的单点；
 *   3. 机制上确定：节点侧按域名/SNI 做的分流与解锁在 IP 交付下无法工作。**实际影响面视机场而定**：
 *      真机上观察到 Netflix / Claude 在某节点开启本开关时建连即被关闭、关掉恢复，但换节点与重跑均未能稳定
 *      复现（同节点复测时改为另一目标失败），故该现象**不作为因果结论**，只作为「存在此类风险」的旁证。
 *
 * 开启的代价（必须知情）：resolve 失败在 `route/route.go:663-667` 是 fatalErr，**没有「退回发域名」的兜底**，
 * 连接直接终止。这把 dns-remote 从「只影响 endpoint 拨号解析」升级成「每条经代理连接的硬前置」。
 *
 * 与「关掉 FakeIP」的区别（两者对节点都交付 IP，不可区分；差别全在客户端侧）：本开关保留 fakeip 反查，
 * 域名分流不依赖嗅探成功、且合成应答零延迟；关 FakeIP 则靠嗅探恢复域名（嗅不出就只剩 IP 规则）、
 * 每个境外域名首查要等一次隧道往返，但彻底不存在 fakeip 映射错配。
 */
export function resolvesDestinationAhead(config: UserConfig): boolean {
  // **刻意不看 FakeIP 开关**：`mixed-in` 入站是**无条件**发射的（singbox-inbounds-builder「无论哪种模式，
  // 都添加 HTTP + SOCKS inbound」），走它的流量（终端代理变量、指向本地端口的应用、探测/更新入站）目的地
  // **恒为域名**，与 FakeIP 无关。早期版本以 usesFakeIp 为前置门，等于让「关了 FakeIP」的用户既拿不到
  // IP 交付、又失去这条逃生口——正是 #347 的病症本身。
  // 关 FakeIP + TUN 的那批真 IP 目的地不受影响：`actionResolve` 首行即 `if metadata.Destination.IsDomain()`
  // （route/route.go:879-880，v1.14.0-beta.14 实读），非域名严格 no-op、零代价、不报错。
  if ((config.proxyMode || 'smart').toLowerCase() === 'direct') return false;
  // 与 direct 模式同根因：主节点是「关外网组网节点」时 route 侧 userExitTag 已整体回退 direct（D4/D7），
  // final=direct、零条 proxy-selector 规则 —— 出口本就直连，节点根本收不到目的地，resolve 零收益。
  // 而 dns-remote 的 detour 不跟随该回退（buildDnsConfig 的 selectedServerTag 由 ProxyManager 硬编码传
  // 'proxy-selector'，dns-builder 不 import 本谓词），resolve 会把每条连接的目的解析打进被 cryptokey
  // routing 丢弃的组网节点，超时后 fatalErr 断连——即回退兜底本要避免的黑洞，改从解析侧原样重现。
  if (meshSelectedExitFallsBackToDirect(config)) return false;
  return (
    config.resolveDestination === true ||
    (config.proxyMode === 'smart' &&
      config.regionRouting?.automatic === true &&
      config.regionRouting.enabled)
  );
}

/**
 * 当前配置「应存在的外化文件全集」：fileName → JSON 内容。
 * 仅 smart 模式外化：global/direct 下 generateCustomRules 不执行（用户路由不生效）→ rule_set 不注册 → 文件无消费者。
 * 启动落盘与孤儿对账清扫都以此为期望集（非 smart 返空集 → 已存在的外化文件被当孤儿清扫）。
 */
export function buildCustomRuleFiles(config: UserConfig): Map<string, string> {
  const out = new Map<string, string>();
  if ((config.proxyMode || 'smart').toLowerCase() !== 'smart') return out;
  const fakeIp = usesFakeIp(config);
  for (const rule of config.customRules || []) {
    if (!rule.enabled) continue;
    const plan = planCustomRule(rule);
    if (plan.kind === 'inline') continue;
    const base = customRuleFileBase(rule.id);
    if (plan.kind === 'ext') {
      out.set(`${base}.json`, JSON.stringify({ version: 1, rules: plan.fileRules }, null, 2));
    }
    // DNS 文件：ext 与 ext-skip 都可能要（route 跳过但 DNS 仍消费 bypass 域名值）
    if (fakeIp && plan.dnsRules) {
      out.set(`${base}.dns.json`, JSON.stringify({ version: 1, rules: plan.dnsRules }, null, 2));
    }
  }
  return out;
}
