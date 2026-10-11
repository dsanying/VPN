/**
 * 速度测试服务（真实测速）：**所有协议**统一经临时 sing-box 的各自 HTTP 代理出口、CONNECT 隧道上发两次 GET 测
 * urltest TTFB，验证完整链路（连接+鉴权+中继+响应）。计时对齐 mihomo `unified-delay`：在同一条已建立的隧道上**只计
 * 第二次**请求往返——即不含建连/握手的「实际请求时间」，跨协议可比（旧实现每次新建连接、把到代理的握手 RTT
 * 计进延迟，数值虚高且协议越重越偏，等价 mihomo `unified-delay:false`）。
 * 关键:端口通≠代理可用——裸 TCP ping 只测到入口的 RTT、测不出鉴权/协议/中继失败,故不再用于真实测速。
 *
 * 出站由 index.ts 注入 ProxyManager.buildSpeedTestOutbound 构造（全协议）。未注入构造器时也仅通过代理请求判定，绝不将 TCP 建连当作代理可用。
 */

import { IpInfoService } from './IpInfoService';
import { measurementFingerprint } from './NodeMeasurementStore';
import type { NodeProbeDetails } from '../../shared/speed-test';
import { CompatibilityCoreService, allocateCompatibilityPort } from './CompatibilityCoreService';
import { compatibilityEngine } from '../../shared/core-capabilities';
import { buildBridgeOutbound } from './compatibility-config';
import { nodeDialDiagnostic } from './node-dial-diagnostic';
import * as net from 'net';
import { performance } from 'perf_hooks';
import * as http from 'http';
import tls = require('tls');
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, execFile, ChildProcess } from 'child_process';
import type { ServerConfig } from '../../shared/types';
import type { LogManager } from './LogManager';
import { resourceManager } from './ResourceManager';
import { getUserDataPath } from '../utils/paths';
import {
  resolveSpeedTestTarget,
  parseHttpStatusCode,
  isAcceptableSpeedTestStatus,
  SPEED_TEST_CONCURRENCY,
  type SpeedTestTarget,
  type MainCoreProbe,
  type SpeedTestOutcome,
  type SpeedTestSkipped,
  type SpeedTestRunResult,
} from '../../shared/speed-test';

/** 一次测速运行的可变上下文（各路径就地填充 outcome/skipped，doTestAllServers 收口读取 §16.2）：
 *  - outcome 缺省 completed；任一 superseded()/gen-change abort 点置 interrupted（含崩溃：superseded 含 !isRunning）。
 *  - skipped=起测即知「本核不可测」的波前缺席节点（不入 outcome、notInPool 供徽标 tooltip 信号）。 */
interface SpeedTestRunContext {
  outcome: SpeedTestOutcome;
  skipped: SpeedTestSkipped;
}
import { isEndpointProtocol, isSpeedTestable } from '../../shared/endpoint-routes';
import { normalizeDuration } from '../../shared/duration';

// Respect the same trust boundary as the OS/browser, including locally trusted enterprise CAs.
const SPEED_TEST_CA =
  typeof tls.getCACertificates === 'function'
    ? [...tls.getCACertificates('default'), ...tls.getCACertificates('system')]
    : [...tls.rootCertificates];

export interface SpeedTestResult {
  serverId: string;
  latency: number | null; // null 表示超时或失败
  error?: string;
}

export interface SpeedTestFailureDiagnostic {
  serverId: string;
  serverName?: string;
  tag?: string;
  reason: string;
}

export interface SpeedTestResolvedIpDiagnostic {
  serverId: string;
  serverName?: string;
  tag?: string;
  targetHost: string;
  resolverPath: string;
  resolvedIps: string[];
  error?: string;
}

export interface SpeedTestDiagnosticSnapshot {
  generatedAt: string;
  target: {
    host: string;
    port: number;
    path: string;
    https: boolean;
    hostHeader: string;
  };
  total: number;
  usable: number;
  failures: SpeedTestFailureDiagnostic[];
  resolvedIpProbes: SpeedTestResolvedIpDiagnostic[];
  tempConfig?: Record<string, unknown>;
}

export class SpeedTestService {
  private measuredTargets = new Map<number, { target: string; reason?: string }>();
  private nodeMeasurements = new Map<
    string,
    { target?: string; reason?: string; exit?: NodeProbeDetails['exit'] }
  >();
  private regionDetection = false;
  enableRegionDetection(): void {
    this.regionDetection = true;
  }
  isTesting(): boolean {
    return !!this.currentTest;
  }
  private async detectExit(port: number): Promise<NodeProbeDetails['exit']> {
    if (!this.regionDetection) return undefined;
    const info = await new IpInfoService(
      () => null,
      () => false,
      () => {}
    ).queryViaProxy(port);
    return info?.countryCode
      ? {
          ip: info.ip,
          countryCode: info.countryCode,
          measuredAt: Date.now(),
          provider: 'Cloudflare',
        }
      : undefined;
  }
  getNodeMeasurement(
    id: string
  ): { target?: string; reason?: string; exit?: NodeProbeDetails['exit'] } | undefined {
    return this.nodeMeasurements.get(id);
  }

  private logManager: LogManager;
  /** 主核、临时核和入口检测使用相同的并发上限；完成一项立即补位，不等待整批慢节点。 */
  private static readonly PROXY_TEST_CONCURRENCY = SPEED_TEST_CONCURRENCY;
  /** 单节点测速总超时（ms）：覆盖冷建连(CONNECT+到代理/目标握手)+两次 GET；上报值只取第二次 warm RTT，与此无关。
   *  取 8s 给大订阅并发冷启动留足头寸，超时即判该节点不可达(null)。 */
  private static readonly MEASURE_TIMEOUT_MS = 8000;
  /** endpoint 失败后的结构化 DNS 探测超时。只走失败 endpoint，避免影响正常测速值。 */
  private static readonly DNS_PROBE_TIMEOUT_MS = 1500;
  /**
   * 出站构造器（由 index.ts 注入 ProxyManager.buildSpeedTestOutbound）：注入后**所有协议**统一走「临时 sing-box
   * 经代理 urltest」真实测速（端口通≠代理可用，裸 TCP ping 测不出鉴权/中继失败）；返回 null=该节点不可用（如 naive
   * 缺 libcronet）→ 跳过。未注入时仅支持原有 UDP 构造器，其他协议失败关闭。
   */
  private buildOutboundFn?: (server: ServerConfig, tag: string) => Record<string, unknown> | null;

  /**
   * §15 主核测速探测池句柄取值器（由 index.ts 注入，call-time 懒引用 ProxyManager.getSpeedTestMainCoreProbe）：
   * 主核运行 + 池就绪 → 测速走主核（testServersViaMainCore，同核单会话消除 WG/WARP 双会话超时）；否则回退临时核。
   * 未注入（单测/兜底）→ 恒回退临时核路径，行为不变。
   */
  private getMainCoreProbe?: () => MainCoreProbe | null;

  /**
   * §15.11 核生命周期世代取值器（由 index.ts 注入，call-time 拉 ProxyManager.getLifecycleGeneration）：测速起测时
   * 快照 gen0，每节点/每 report 前比对——超代（核 start/stop/restart 中途跃迁）即 abort，保留已测、绝不给未测节点写假
   * -1。缺省 `() => 0`（未注入=单测/兜底）→ 恒不超代，行为与今日一致（回归保护）。
   */
  private getCoreGeneration: () => number;

  /** 进行中的测速 Promise + 其覆盖的节点 id 集：多入口并发（首页/托盘/页级全部/本组/单节点，各传不同 serverIds
   *  子集）时按「覆盖」编排——新请求 ⊆ 在飞集 → 复用同一次（零重跑、避免双临时 sing-box 端口冲突）；未覆盖 → 串行链
   *  在其后（不同分组/单节点/子集先-全量后 各自被完整测到，永不并发双 sing-box、无静默漏测）。 */
  private currentTest: Promise<SpeedTestRunResult> | null = null;
  private currentTestIds: Map<string, string> | null = null;
  private lastDiagnostics: SpeedTestDiagnosticSnapshot | null = null;

  constructor(
    logManager: LogManager,
    buildOutboundFn?: (server: ServerConfig, tag: string) => Record<string, unknown> | null,
    getMainCoreProbe?: () => MainCoreProbe | null,
    getCoreGeneration?: () => number
  ) {
    this.logManager = logManager;
    this.buildOutboundFn = buildOutboundFn;
    this.getMainCoreProbe = getMainCoreProbe;
    // 缺省恒返 0 → getCoreGeneration()!==gen0 恒 false → 永不超代（回归安全）。
    this.getCoreGeneration = getCoreGeneration ?? (() => 0);
  }

  getLastSpeedTestDiagnostics(): SpeedTestDiagnosticSnapshot | null {
    return this.lastDiagnostics;
  }

  /**
   * 测试所有服务器（混合策略）。
   * @param onResult 可选逐节点回调：每测完一个节点即回传（serverId, latency），供 UI 流式增量显示
   *   （惰性、谁有结果谁先显示，等价 mihomo）。不传则仅在末尾用返回的 Map 一次性更新。
   */
  async testAllServers(
    servers: ServerConfig[],
    onResult?: (serverId: string, latency: number | null) => void,
    onProgress?: (tested: number, ok: number, total: number) => void,
    testUrl?: string
  ): Promise<SpeedTestRunResult> {
    // 单一真值闸（下沉于此，UI/托盘两入口共用）：此处仅剔「**永久**不可测」节点（自定义 endpoint / reverseMesh system
    // 内核接口 / mesh-only 无出口）——它们对任何路径都返 null→-1「超时」，与 UI 角标「不适用」口径冲突。
    // §16.1 path-aware 的 TS-exit（仅主核池可用时可测）是**瞬态**判定，**不在此按入队瞬刻的 caps 冻结**：本次请求可能
    // 串在在飞测速之后，doTestAllServers 数十秒后才真正执行——入队时核停冻结掉 TS 会致「排队期间核起来了却仍被剔、既不
    // 测也不进 skipped 静默漏测」。故用恒真 caps（mainCorePool:true）只筛掉永久不可测，把 TS-exit 的真实取舍下沉到
    // doTestAllServers 执行侧按 runtime caps 决定（主核路径测之 / 临时核路径按 mainCorePool:false 剔入 tsNotReady 出信号）。
    const testable = servers.filter((s) => isSpeedTestable(s, { mainCorePool: true }));
    if (testable.length === 0) {
      return {
        results: new Map(),
        outcome: 'completed',
        skipped: { notInPool: [], tsNotReady: [] },
      };
    }
    // 并发编排（多入口各传不同子集）：按「在飞测速是否覆盖本次请求」决定复用 or 串行。
    const inFlight = this.currentTest;
    const inFlightIds = this.currentTestIds;
    const requestIds = new Map(testable.map((s) => [s.id, measurementFingerprint(s, testUrl)]));
    if (
      inFlight &&
      inFlightIds &&
      [...requestIds].every(([id, fingerprint]) => inFlightIds.get(id) === fingerprint)
    ) {
      // 覆盖态（在飞集 ⊇ 本次请求）：复用同一次测速，零重跑。second caller 拿同一份 final results，其 onResult/
      // onProgress 不驱动（流式只由 first caller），但 EVENT_SPEED_TEST_RESULT/PROGRESS 是 IPC broadcast，
      // 本 caller 的 renderer 仍收得到（latencyMap/进度照常更新）。
      return inFlight;
    }
    // 未覆盖（不同分组 / 单节点先-全量后 / 子集先-全量后）：串行链在在飞测速之后跑——永不并发双临时 sing-box
    // （端口/资源冲突），且本次请求的节点集用**自身** set 完整测到（杜绝旧「无条件复用」导致的静默漏测/错测）。
    const run = inFlight
      ? inFlight
          .catch(() => {}) // 吞前一次异常，仅为串行不断链（本次独立、不受前次成败影响）
          .then(() => this.doTestAllServers(testable, onResult, onProgress, testUrl))
      : this.doTestAllServers(testable, onResult, onProgress, testUrl);
    this.currentTest = run;
    this.currentTestIds = requestIds;
    const clearRun = () => {
      // 仅当仍是最新一次（其后无更晚的串行链接）才清空，避免清掉排队中的下一次。
      if (this.currentTest === run) {
        this.currentTest = null;
        this.currentTestIds = null;
      }
    };
    // Both branches consume cleanup; an ignored finally() would create a second unhandled rejection.
    void run.then(clearRun, clearRun);
    return run;
  }

  private async doTestAllServers(
    servers: ServerConfig[],
    onResult?: (serverId: string, latency: number | null) => void,
    onProgress?: (tested: number, ok: number, total: number) => void,
    testUrl?: string
  ): Promise<SpeedTestRunResult> {
    // §15.11：起测时快照核生命周期世代——本次测速 = 绑定于 gen0 的作业，任一核 start/stop/restart/config-regen
    // 中途跃迁 → getCoreGeneration()!==gen0 → 超代 abort（保留已测、未测节点缺席 map、绝不写假 -1）。缺省 ()=>0 恒不超代。
    for (const server of servers) this.nodeMeasurements.delete(server.id);
    const gen0 = this.getCoreGeneration();
    // §16.2 一次运行的可变上下文：各路径就地填 outcome（abort 点置 interrupted）+ skipped（波前缺席）。
    const runCtx: SpeedTestRunContext = {
      outcome: 'completed',
      skipped: { notInPool: [], tsNotReady: [] },
    };

    // §15 主核路径（主核运行 + 池就绪）：经**已运行的主核** probe 池测全部节点——同 endpoint tag=同 WG 会话，
    // 结构性消除临时核双会话超时（G1）。复用现成 measureViaTunnel（warm-TTFB 保真），selectOutbound 热切 probe 槽。
    const mainCoreProbe = this.getMainCoreProbe?.();
    if (mainCoreProbe?.available() && mainCoreProbe.isRunning()) {
      this.logManager.addLog(
        'info',
        `开始测速: ${servers.length} 个节点（经主核探测池，${mainCoreProbe.poolPorts.length} 槽）`,
        'SpeedTest'
      );
      const results = await this.testServersViaMainCore(
        mainCoreProbe,
        servers,
        gen0,
        runCtx,
        onResult,
        onProgress,
        testUrl
      );
      const ok = [...results.values()].filter((v) => v !== null).length;
      this.logManager.addLog(
        'info',
        runCtx.outcome === 'interrupted'
          ? `测速中断：已测 ${ok}/${servers.length}（核生命周期跃迁，未测节点保留原值）`
          : `测速完成：成功 ${ok}/${servers.length}`,
        'SpeedTest'
      );
      return { results, outcome: runCtx.outcome, skipped: runCtx.skipped };
    }

    // 生产路径（注入了出站构造器）：**所有协议**统一走临时 sing-box 经代理 urltest，真实测速。
    // 此路径 = 主核未运行/未就绪时的临时核兜底（R-b：测一半用户开代理 → 主核 start → gen++ → abort，见 §15.11）。
    if (this.buildOutboundFn) {
      // §16.1 漂移防护：TS-exit 只有主核路径可测（临时核建不出第二 tsnet 实例）。上游 caps 快照若在主核运行时纳入了
      // TS-exit，而此刻主核已挂落到临时核路径（序列链竞态）→ 按临时核口径再剔 TS，防临时核对其 buildOutbound=null→假 -1。
      const tempServers = servers.filter((s) => isSpeedTestable(s, { mainCorePool: false }));
      // L-2：漂移剔除的 TS-exit 计入 skipped（可见性——toast 副行计数、不误算 outcome=interrupted；徽标由 renderer 派生
      // ts-needs-core）；否则「测速完成」但被请求的 TS 既无值也无任何提示（静默无下文）。
      for (const s of servers) {
        if (!tempServers.some((t) => t.id === s.id)) runCtx.skipped.tsNotReady.push(s.id);
      }
      this.logManager.addLog(
        'info',
        `开始测速: ${tempServers.length} 个节点（经代理 urltest）`,
        'SpeedTest'
      );
      const results = await this.testServersViaProxy(
        tempServers,
        gen0,
        runCtx,
        onResult,
        onProgress,
        testUrl
      );
      const ok = [...results.values()].filter((v) => v !== null).length;
      // 仅汇总，不逐节点列明（结果由 UI 节点延迟徽标承载）。
      this.logManager.addLog(
        'info',
        runCtx.outcome === 'interrupted'
          ? `测速中断：已测 ${ok}/${tempServers.length}`
          : `测速完成：成功 ${ok}/${tempServers.length}`,
        'SpeedTest'
      );
      return { results, outcome: runCtx.outcome, skipped: runCtx.skipped };
    }

    // A missing injected builder must never turn a TCP port into a usable proxy result.
    const results = await this.testServersViaProxy(
      servers,
      gen0,
      runCtx,
      onResult,
      onProgress,
      testUrl
    );
    return { results, outcome: runCtx.outcome, skipped: runCtx.skipped };
  }

  // ═══════════════════════════════════════════════════════════════
  //  UDP/QUIC 测速：通过临时 sing-box HTTP 代理
  // ═══════════════════════════════════════════════════════════════

  /**
   * 经临时 sing-box 真实测速（全协议）：每个可用节点起独立 HTTP 入站 → 该节点出站，经 CONNECT 隧道发两次 GET 测速端点
   * （默认 generate_204，可经 testUrl 自配，兼容 http/https）量 warm TTFB（详见 measureViaTunnel）。不可用节点（naive
   * 缺 libcronet 等）预先剔除为 null、不进临时核。
   * @param gen0 §15.11 起测时核生命周期世代快照：runWithLimit 内每 measure 前后比对，超代（核中途 START，R-b 瞬态
   *   双会话）即丢弃在飞结果、不 report、不写假 -1；临时核由 finally 照常杀。缺省 0（未注入=恒不超代，回归安全）。
   * @param onResult 可选逐节点回调：每测完一个节点即回传（serverId, latency），供 UI 流式增量显示。
   * @param testUrl 可选测速端点 URL（非法回落默认 generate_204）。
   */
  private async testServersViaProxy(
    servers: ServerConfig[],
    gen0 = 0,
    runCtx?: SpeedTestRunContext,
    onResult?: (serverId: string, latency: number | null) => void,
    onProgress?: (tested: number, ok: number, total: number) => void,
    testUrl?: string
  ): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    // 进度计数：每个节点得出结果（含 null/不可用/失败）即 tested++，成功 ok++；total 含不可用节点。
    let tested = 0;
    let ok = 0;
    const total = servers.length;
    const report = (id: string, latency: number | null) => {
      onResult?.(id, latency);
      tested++;
      if (latency !== null) ok++;
      onProgress?.(tested, ok, total);
    };
    // issue #154 ③：失败原因计数（reason→次数）+ 末尾分布日志，把「为何全超时」从玄学变可定位
    //（http-403=目标拒绝/查测速地址、connect-timeout=连不上、unusable=naive 缺库、core-not-ready=临时核没起）。
    const failReasons = new Map<string, number>();
    const failures: SpeedTestFailureDiagnostic[] = [];
    const resolvedIpProbes: SpeedTestResolvedIpDiagnostic[] = [];
    const resolvedIpProbePromises: Promise<SpeedTestResolvedIpDiagnostic>[] = [];
    const noteFail = (reason: string) =>
      failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1);
    const noteNodeFail = (reason: string, server: ServerConfig, tag?: string): void => {
      noteFail(reason);
      this.nodeMeasurements.set(server.id, {
        ...this.nodeMeasurements.get(server.id),
        target:
          this.nodeMeasurements.get(server.id)?.target ??
          `${target.https ? 'https' : 'http'}://${target.hostHeader}${target.path}`,
        reason,
      });
      failures.push({
        serverId: server.id,
        serverName: server.name,
        tag,
        reason,
      });
    };
    const logFailDist = () => {
      if (failReasons.size === 0) return;
      const dist = [...failReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `${r}×${n}`)
        .join('，');
      this.logManager.addLog('info', `测速失败原因分布：${dist}`, 'SpeedTest');
    };
    let singboxProcess: ChildProcess | null = null;
    let configFilePath: string | null = null;
    let tempConfig: Record<string, unknown> | undefined;
    let stderrOutput = '';
    let stdoutOutput = '';

    const compatibility = new CompatibilityCoreService(
      (engine) => resourceManager.getCompatibilityCorePath(engine),
      (level, message, source) => this.logManager.addLog(level, message, source)
    );
    let compatibilityDirectPort = 0;
    // 构造各节点出站；不可用（naive 缺 libcronet / 异常）→ 直接 null，不进临时核（避免预初始化 FATAL 拖垮整批）。
    const getOutbound =
      this.buildOutboundFn ?? ((s: ServerConfig, t: string) => this.buildOutbound(s, t));
    const usable: { server: ServerConfig; tag: string; outbound: Record<string, unknown> }[] = [];
    const target = resolveSpeedTestTarget(testUrl);
    try {
      if (servers.some((server) => compatibilityEngine(server))) {
        compatibilityDirectPort = await allocateCompatibilityPort();
        await compatibility.prepare(
          servers.map((server) => ({ ...server, detour: undefined })),
          compatibilityDirectPort
        );
      }
      if (this.getCoreGeneration() !== gen0) {
        if (runCtx) runCtx.outcome = 'interrupted';
        return results;
      }
      for (const s of servers) {
        const tag = `out-${s.id}`;
        const bridge = compatibility.bridges.get(s.id);
        let ob: Record<string, unknown> | null;
        try {
          ob = compatibilityEngine(s)
            ? bridge
              ? buildBridgeOutbound(tag, bridge)
              : null
            : getOutbound(s, tag);
        } catch {
          results.set(s.id, null);
          noteNodeFail('outbound-invalid', s, tag);
          report(s.id, null);
          continue;
        }
        if (ob) usable.push({ server: s, tag, outbound: ob });
        else {
          results.set(s.id, null);
          noteNodeFail('unusable', s, tag); // naive 缺 libcronet / 构造异常 → 不可测节点
          report(s.id, null);
        }
      }
      // 解析测速端点（一次，预热+正式共用）；非法 testUrl 经 resolveSpeedTestTarget 回落默认 generate_204。
      if (usable.length === 0) {
        this.lastDiagnostics = {
          generatedAt: new Date().toISOString(),
          target,
          total,
          usable: 0,
          failures: [...failures],
          resolvedIpProbes: [],
        };
        logFailDist();
        return results;
      }

      // 1. 为可用节点分配 HTTP 代理端口
      const ports = await this.findFreePorts(usable.length);
      const serverPortMap = new Map<string, number>(); // serverId → HTTP proxy port
      usable.forEach((u, idx) => serverPortMap.set(u.server.id, ports[idx]));

      // 2. 生成临时 sing-box 配置（每节点独立 HTTP 入站 → 该节点出站；端点目标解析走穿隧道 223.5.5.5，geo 正确）
      const makeConfig = (batch: typeof usable) => {
        const config = this.generateProxyTestConfig(batch, serverPortMap);
        if (compatibilityDirectPort) {
          (config.inbounds as Record<string, unknown>[]).push({
            type: 'mixed',
            tag: 'compat-direct-in',
            listen: '127.0.0.1',
            listen_port: compatibilityDirectPort,
          });
          (config.route as { rules: Record<string, unknown>[] }).rules.unshift({
            inbound: ['compat-direct-in'],
            action: 'route',
            outbound: 'direct',
          });
        }
        return config;
      };
      const userDataPath = getUserDataPath();
      configFilePath = path.join(userDataPath, `speedtest_${Date.now()}.json`);
      const singboxPath = resourceManager.getSingBoxPath();
      // One malformed native node must not prevent all other subscriptions from being tested.
      // The normal path costs one check; split failing batches until the offending nodes are isolated.
      const isolate = async (batch: typeof usable): Promise<typeof usable> => {
        if (this.getCoreGeneration() !== gen0) return [];
        if (await this.checkProbeConfig(singboxPath, configFilePath!, makeConfig(batch)))
          return batch;
        if (batch.length === 1) {
          const node = batch[0];
          results.set(node.server.id, null);
          noteNodeFail('outbound-invalid', node.server, node.tag);
          report(node.server.id, null);
          return [];
        }
        const middle = Math.floor(batch.length / 2);
        return [
          ...(await isolate(batch.slice(0, middle))),
          ...(await isolate(batch.slice(middle))),
        ];
      };
      const valid = await isolate(usable);
      if (this.getCoreGeneration() !== gen0) {
        if (runCtx) runCtx.outcome = 'interrupted';
        return results;
      }
      usable.splice(0, usable.length, ...valid);
      if (!usable.length) return results;
      const config = makeConfig(usable);
      tempConfig = config;
      await fs.writeFile(configFilePath, JSON.stringify(config), { mode: 0o600 });

      // 4. 启动临时 sing-box 进程
      singboxProcess = spawn(singboxPath, ['run', '-c', configFilePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 收集临时核输出用于调试。正常退出也在 finally 以 debug 写 app.log；日志级别非 debug 时自动被 LogManager 过滤。
      singboxProcess.stdout?.on('data', (data: Buffer) => {
        stdoutOutput = (stdoutOutput + data.toString()).slice(-65536);
      });
      singboxProcess.stderr?.on('data', (data: Buffer) => {
        stderrOutput = (stderrOutput + data.toString()).slice(-65536);
      });

      // 监听进程异常退出
      let processExited = false;
      singboxProcess.on('error', () => {
        processExited = true;
      });
      singboxProcess.on('exit', (code) => {
        processExited = true;
        if (code !== null && code !== 0) {
          this.logManager.addLog(
            'warn',
            `临时 sing-box 进程退出 (code=${code}): ${stderrOutput.slice(0, 500)}`,
            'SpeedTest'
          );
        }
      });

      // 5. 等待 sing-box 就绪（连第一个 HTTP 代理端口）。应用分流规则集下载可能耗时，给 10s。
      const ready = await this.waitForPortReady(serverPortMap.get(usable[0].server.id)!, 10000);
      if (this.getCoreGeneration() !== gen0) {
        if (runCtx) runCtx.outcome = 'interrupted';
        return results;
      }
      if (!ready || processExited) {
        this.logManager.addLog(
          'warn',
          `sing-box 测速进程未就绪: ${stderrOutput.slice(0, 500)}`,
          'SpeedTest'
        );
        for (const u of usable) {
          results.set(u.server.id, null);
          noteNodeFail('core-not-ready', u.server, u.tag); // 临时 sing-box 未就绪：整批不可测
          report(u.server.id, null);
        }
        return results;
      }

      // 6. 测速：每节点经各自 HTTP 代理建一条 CONNECT 隧道，在同一条隧道上发两次 GET、只计第二次（warm RTT）——
      //    对齐 mihomo unified-delay：第一次承担建连+握手暖身（丢弃计时），第二次是不含握手的纯请求延迟＝「实际请求
      //    时间」。measureViaTunnel 内部已暖身，无需独立预热轮；仍限制并发以减少网络争用和请求风暴假超时。
      //    每测完一个节点立即回调 onResult（UI 流式显示），不等队列。
      await this.runWithLimit(usable, SpeedTestService.PROXY_TEST_CONCURRENCY, async (u) => {
        // §15.11 R-b：核中途 START（临时核 + 新主核瞬态双会话）→ gen 变 → 丢弃、不 report（未测节点不写假 -1）。
        if (this.getCoreGeneration() !== gen0) {
          if (runCtx) runCtx.outcome = 'interrupted';
          return;
        }
        const port = serverPortMap.get(u.server.id)!;
        const { latency, reason } = await this.measureWithFallback(
          port,
          SpeedTestService.MEASURE_TIMEOUT_MS,
          target,
          () => this.getCoreGeneration() === gen0
        );
        // 超代再检（measure 期间核可能刚 START）：绝不写假 -1——超代的未测 vs measureViaTunnel 真实失败(-1) 由此分流。
        if (this.getCoreGeneration() !== gen0) {
          if (runCtx) runCtx.outcome = 'interrupted';
          return;
        }
        const exit =
          latency !== null && this.regionDetection ? await this.detectExit(port) : undefined;
        if (this.regionDetection && this.getCoreGeneration() !== gen0) {
          if (runCtx) runCtx.outcome = 'interrupted';
          return;
        }
        this.nodeMeasurements.set(u.server.id, { ...this.measuredTargets.get(port), exit });
        results.set(u.server.id, latency);
        if (latency === null) {
          noteNodeFail(reason ?? 'unknown', u.server, u.tag); // ③ 记失败模式
          report(u.server.id, latency);
          if (isEndpointProtocol(u.outbound.type as string)) {
            resolvedIpProbePromises.push(
              this.probeEndpointTargetResolvedIps(
                port,
                u.server,
                u.tag,
                target.host,
                SpeedTestService.DNS_PROBE_TIMEOUT_MS
              )
            );
          }
          return;
        }
        report(u.server.id, latency);
      });
      resolvedIpProbes.push(...(await Promise.all(resolvedIpProbePromises)));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logManager.addLog('error', `测速异常: ${msg}`, 'SpeedTest');
      if (this.getCoreGeneration() !== gen0) {
        if (runCtx) runCtx.outcome = 'interrupted';
      } else
        for (const u of usable) {
          if (!results.has(u.server.id)) {
            results.set(u.server.id, null);
            noteNodeFail('exception', u.server, u.tag);
            report(u.server.id, null);
          }
        }
    } finally {
      await compatibility.close();
      const coreOutput = [stderrOutput, stdoutOutput].filter(Boolean).join('\n').trim();
      for (const { server } of usable) {
        if (results.get(server.id) !== null) continue;
        const code = nodeDialDiagnostic(coreOutput, server);
        const measurement = this.nodeMeasurements.get(server.id);
        if (!code || !measurement) continue;
        measurement.reason = `node-dial:${code}; ${measurement.reason ?? 'unknown'}`;
        const failure = failures.find((item) => item.serverId === server.id);
        if (failure) failure.reason = measurement.reason;
      }
      this.lastDiagnostics = {
        generatedAt: new Date().toISOString(),
        target,
        total,
        usable: usable.length,
        failures: [...failures],
        resolvedIpProbes: [...resolvedIpProbes],
        tempConfig,
      };
      logFailDist(); // ③ 末尾打失败原因分布（normal/not-ready/catch 路径都经 finally）
      if (coreOutput) {
        this.logManager.addLog(
          'debug',
          `临时 sing-box 测速输出：${coreOutput.slice(-4000)}`,
          'SpeedTest'
        );
      }
      if (singboxProcess) await stopProbeProcess(singboxProcess);
      if (configFilePath) {
        try {
          await fs.unlink(configFilePath);
        } catch {
          // ignore
        }
      }
    }

    return results;
  }

  /**
   * 生成用于测速的 sing-box 配置：每个可用节点一个独立 HTTP 代理入站 → 该节点（预构造）出站/endpoint。
   * 由 ProxyManager.buildSpeedTestOutbound 预构造：普通协议→outbound，WireGuard→endpoint（进 endpoints[]）；
   * route 规则按 tag 指向，两者一致（endpoint tag 当 outbound 用，已实测兼容）。
   */
  /**
   * §15 主核测速（方案 A）：经**已运行的主核**探测池测全部节点，结构性消除临时核 WG/WARP 双会话超时（G1）。
   * 编排（§15.5）：K 个 worker 各自绑定探测槽；每项先 gRPC selectOutbound 将本槽热切到该节点（1:1，
   * 节点[k]→probe-selector-k），再经 probe-in-k 端口跑**现成 measureViaTunnel**（warm-TTFB 逐字复用，唯一变量=
   * CONNECT 目标端口 poolPort[k]）。各槽独立推进——同槽先测完（finish 已 destroy 隧道）再 selectOutbound
   * 重定向，interrupt_exist_connections 清残留、无跨节点串味。report/失败分布/onResult/onProgress 与临时核路径同款。
   * 池测结果权威（同 endpoint tag=同 WG 会话，成功真值），如实上报（含 null=真不通）；不再被临时核 null 覆盖。
   * §15.11：绑定起测世代 gen0——每节点前 + 每 report 前比对 getCoreGeneration()，超代（核 stop/restart/regen 中途跃迁，
   * R-a/R-c）即停发请求、丢在飞结果、return 已测部分 map（未测节点缺席 → 合并语义保留旧值，绝不写假 -1）。
   */
  private async testServersViaMainCore(
    probe: MainCoreProbe,
    servers: ServerConfig[],
    gen0: number,
    runCtx: SpeedTestRunContext,
    onResult?: (serverId: string, latency: number | null) => void,
    onProgress?: (tested: number, ok: number, total: number) => void,
    testUrl?: string
  ): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    const poolPorts = probe.poolPorts;
    const K = Math.min(poolPorts.length, SpeedTestService.PROXY_TEST_CONCURRENCY);
    // 进度/失败分布机制与 testServersViaProxy 同款（单一口径，UI/诊断零差异）。
    let tested = 0;
    let ok = 0;
    // 进度分母=实际会被 report 的节点数（波前缺席的 not-in-pool/ts-not-ready 不 report → 剔出分母，避免进度停在 <100%）；
    // 波前 gate 后重置为 poolTestable.length。
    let total = servers.length;
    const report = (id: string, latency: number | null) => {
      onResult?.(id, latency);
      tested++;
      if (latency !== null) ok++;
      onProgress?.(tested, ok, total);
    };
    const failReasons = new Map<string, number>();
    const failures: SpeedTestFailureDiagnostic[] = [];
    const resolvedIpProbes: SpeedTestResolvedIpDiagnostic[] = [];
    const noteNodeFail = (reason: string, server: ServerConfig, tag?: string): void => {
      failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1);
      failures.push({ serverId: server.id, serverName: server.name, tag, reason });
    };
    const logFailDist = () => {
      if (failReasons.size === 0) return;
      const dist = [...failReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `${r}×${n}`)
        .join('，');
      this.logManager.addLog('info', `测速失败原因分布：${dist}`, 'SpeedTest');
    };

    // 上游 testAllServers 已按 isSpeedTestable(caps) 过滤（含 TS-exit）；此处再波前预筛「本核不可测」→ 缺席（不
    // select/measure/report、绝不写假 -1）：①非池成员（§16.3.3：订阅新增/改址未重启入池，tagOf 会回退裸 id →
    // selectOutbound throw → 旧代码假 -1）；②TS 节点未登录就绪（§16.1.3 层3）。缺席节点入 runCtx.skipped，不进 outcome
    // 分母（起测即知不可测≠中断），notInPool 另供徽标 tooltip 信号。
    const poolTestable: ServerConfig[] = [];
    for (const s of servers) {
      if (!probe.hasTag(s.id)) {
        runCtx.skipped.notInPool.push(s.id);
        noteNodeFail('not-in-pool', s);
        continue;
      }
      // §2：已编辑未生效（dirty）节点——运行核仍跑旧参数，测它得旧参数出口 latency 却挂新参数名下失真。波前剔除
      // 免测（徽标经 pendingChanges.modified 显「待生效」，非 notInPool 的「待入池」，故不入 skipped.notInPool）。
      // 传完整节点 s（本列表来自 ConfigManager 最新 config）→ 直接比其指纹 vs 快照，避 currentConfig 滞后漏判（F-B）。
      if (probe.isDirty(s)) {
        noteNodeFail('dirty-pending', s);
        continue;
      }
      if (s.protocol?.toLowerCase() === 'tailscale' && !probe.tsNodeReady(s.id)) {
        runCtx.skipped.tsNotReady.push(s.id);
        noteNodeFail('ts-not-ready', s, probe.tagOf(s.id));
        continue;
      }
      poolTestable.push(s);
    }
    total = poolTestable.length; // 进度分母=实际测量节点数（缺席节点已剔）
    const target = resolveSpeedTestTarget(testUrl);

    // §15.11 F1：超代 = 核生成号跃迁（start/stop/restart/regen）**或**核已不在运行（`!probe.isRunning()`）。后者覆盖
    // 「自发崩溃」——handleProcessExit 崩溃分支不 bump lifecycleGeneration（gen 检查漏判），但崩溃后 probe.isRunning()
    // 立即为 false，故经此把崩溃窗口的在飞 measure 失败判为「未测」而非真实失败 → 绝不写假 -1（诚实性根基）。
    // 反之：gen 不变且核仍运行时的 measureViaTunnel null 是**真实节点超时**，照常记 -1。
    const superseded = () => this.getCoreGeneration() !== gen0 || !probe.isRunning();

    try {
      // 每个 worker 永久绑定一个槽及端口；只有本槽测量和诊断结束后才重定向。
      // 慢节点占用自己的槽，其余槽完成后立即领取下一个，避免整批等待。
      await this.runWithLimit(poolTestable, K, async (node, k) => {
        if (superseded()) {
          runCtx.outcome = 'interrupted';
          return;
        }
        const tag = probe.tagOf(node.id);
        let selected = false;
        try {
          await probe.selectSlot(k, tag);
          selected = true;
        } catch {
          // 核生命周期检查后再决定是否是真实选择失败。
        }
        if (superseded()) {
          runCtx.outcome = 'interrupted';
          return;
        }
        if (!selected) {
          results.set(node.id, null);
          noteNodeFail('select-failed', node, tag);
          report(node.id, null);
          return;
        }
        const port = poolPorts[k];
        const { latency, reason } = await this.measureWithFallback(
          port,
          SpeedTestService.MEASURE_TIMEOUT_MS,
          target,
          () => !superseded()
        );
        if (superseded()) {
          runCtx.outcome = 'interrupted';
          return;
        }
        const exit =
          latency !== null && this.regionDetection ? await this.detectExit(port) : undefined;
        if (this.regionDetection && this.getCoreGeneration() !== gen0) {
          if (runCtx) runCtx.outcome = 'interrupted';
          return;
        }
        this.nodeMeasurements.set(node.id, { ...this.measuredTargets.get(port), exit });
        results.set(node.id, latency);
        if (latency === null) {
          noteNodeFail(reason ?? 'unknown', node, tag);
          report(node.id, null);
          // 诊断仍占用本槽；不能在 DNS 请求完成前把同一端口改指另一个节点。
          if (isEndpointProtocol(node.protocol)) {
            resolvedIpProbes.push(
              await this.probeEndpointTargetResolvedIps(
                port,
                node,
                tag,
                target.host,
                SpeedTestService.DNS_PROBE_TIMEOUT_MS
              )
            );
          }
          return;
        }
        report(node.id, latency);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logManager.addLog('error', `主核测速异常: ${msg}`, 'SpeedTest');
      // §15.11：仅非超代（核未跃迁/未崩溃）时把未测节点记 exception(-1)（真实异常）；超代下绝不写假 -1（缺席、保留旧值）。
      if (!superseded()) {
        for (const s of poolTestable) {
          if (!results.has(s.id)) {
            results.set(s.id, null);
            noteNodeFail('exception', s, probe.tagOf(s.id));
            report(s.id, null);
          }
        }
      } else {
        // §16.2：超代下异常 → 标 interrupted（未测节点缺席、绝不写假 -1）。
        runCtx.outcome = 'interrupted';
      }
    } finally {
      this.lastDiagnostics = {
        generatedAt: new Date().toISOString(),
        target,
        total,
        usable: poolTestable.length,
        failures: [...failures],
        resolvedIpProbes: [...resolvedIpProbes],
      };
      logFailDist();
    }

    return results;
  }

  private generateProxyTestConfig(
    usable: { server: ServerConfig; tag: string; outbound: Record<string, unknown> }[],
    serverPortMap: Map<string, number>
  ): Record<string, unknown> {
    const inbounds: Record<string, unknown>[] = [];
    const outbounds: Record<string, unknown>[] = [];
    const endpoints: Record<string, unknown>[] = [];
    const routeRules: Record<string, unknown>[] = [];
    // 解析节点 server 地址的当前网络 DNS（见下「两类解析不变量」）；端点另加穿隧道 DNS（dns-exit-<id8>）。
    const dnsServers: Record<string, unknown>[] = [
      // 节点地址解析遵循当前网络的 DNS，不依赖校园网/企业网可能封锁的公网 UDP 53。
      // local 仅读取系统解析配置，临时测速不写系统 DNS。
      { tag: 'dns-direct', type: 'local' },
    ];
    const dnsRules: Record<string, unknown>[] = [];

    for (const { server, tag, outbound } of usable) {
      const port = serverPortMap.get(server.id);
      if (!port) continue;
      const id8 = server.id;
      const inboundTag = `http-in-${id8}`;
      inbounds.push({ type: 'http', tag: inboundTag, listen: '127.0.0.1', listen_port: port });
      routeRules.push({ inbound: [inboundTag], action: 'route', outbound: tag });
      // endpoint（WireGuard/WARP/未来 TS）进 endpoints[]，普通协议进 outbounds[]；route 均按 tag 指向。
      // 按单一真值 isEndpointProtocol 判 type（非硬编码 'wireguard'），未来端点类型自动归位。
      if (isEndpointProtocol(outbound.type as string)) {
        endpoints.push(outbound);
        // 端点是 L3（运 IP 包、不认域名）→ sing-box 强制**本地解析**目标域名（wireguard/endpoint.go 空 QueryOptions，
        // 过 dns.rules + default）。默认 dns-direct 从**本机**解析 → 本机 geo 的 IP；但端点出口可能在别处
        // （境外 WARP / 国内自建 WG），本机 geo IP 出口够不着 → 超时/失真。故把目标解析经 inbound 键控 dns.rule 定向到
        // 「穿本节点隧道」的 223.5.5.5：查询从**出口**发出，AliDNS（有大陆节点 + ECS）按**出口地理**返 IP（境外出口→境外 IP、
        // 国内出口→国内 IP），出口恒够得着。真机双证：WARP→142.251.x(境外)/204、国内 WG→58.63.x(国内)/204；1.1.1.1 因
        // anycast 无大陆 PoP、在国内出口反挂（74.125.x 境外 IP 墙内不可达），故用 223.5.5.5 单形态覆盖境内外。
        // endpoint 级 domain_resolver 只管 peer 地址、禁指向隧道 DNS（peer 解析死锁 FATAL，实测）。
        const exitDnsTag = `dns-exit-${id8}`;
        dnsServers.push({
          tag: exitDnsTag,
          type: 'udp',
          server: '223.5.5.5',
          server_port: 53,
          detour: tag, // 查询穿本端点隧道 → AliDNS 按出口地理(ECS)返 IP
        });
        // 族别偏好（语义不变，写法迁移）：WG localAddress 含 v6 → v4 优先但保留 v6（避免 v6 优先落不可达）；
        // 纯 v4 → 只取 A（消 v6 解析噪声）。
        //
        // 迁移背景（sing-box 1.14.0，随包核 1.14.0-beta.2 本机 loopback 实测）：rule-action 上的 legacy
        // `strategy` 已废弃、run 时 WARN、1.16.0 移除；更要命的是它与**同一份 dns 配置内**任何带
        // `query_type`/`ip_version` 的规则（含引用带 query_type 的 rule-set）**互斥**——共存则 `sing-box run`
        // 与 `check` 双双硬拒（`initialize dns router: Legacy strategy ... is deprecated` FATAL）。主配置
        // （singbox-dns-builder）大量用 query_type，测速配置用 rule-action strategy，此前只是**恰好错开**。
        // 新写法改用 query_type 规则项表达，两侧不再有 legacy strategy，该雷结构性拆除。
        //
        //  · 旧 `prefer_ipv4` → **不下发任何东西**：本配置无顶层 `dns.strategy`（见下方 `dns` 组装），内核默认
        //    并发 A/AAAA 且把 v4 排在 v6 前（sortAddresses 对 AsIS 与 prefer_ipv4 同一分支）。实测两形态返回
        //    的地址列表逐项同序。⚠️ 该等价性**依赖测速配置不带顶层 dns.strategy**，由 speed-test-endpoint-dns
        //    单测「全仓禁 legacy rule-action strategy」一例锁死。
        //  · 旧 `ipv4_only` → 给该 inbound 的 AAAA 查询前置一条 predefined 空 NOERROR：AAAA 就地返空、不出网，
        //    结果集只剩 A。实测与 legacy ipv4_only 的出网查询与解析结果逐字节一致。
        //
        // 顺序有牙：抑制规则必须排在本节点 route 规则**之前**——DNS 规则先匹配先命中，route 规则是该 inbound 的
        // catch-all，排它前面则 AAAA 先被 route 吃掉、抑制静默失效（实测反证）。
        const hasV6 = !!server.wireguardSettings?.localAddress?.some((a) => a.includes(':'));
        if (!hasV6) {
          dnsRules.push({
            inbound: [inboundTag],
            query_type: ['AAAA'],
            action: 'predefined',
            rcode: 'NOERROR', // 空答复：等价旧 ipv4_only 的「不要 v6」，且不触发拒绝日志噪声
          });
        }
        dnsRules.push({
          inbound: [inboundTag], // 端点入站的目标解析走穿隧道 DNS（按出口地理）
          action: 'route',
          server: exitDnsTag,
          disable_cache: true, // 多端点并测出口 geo 答案各异，禁缓存防互污染（cache 按 question 全局共享）
        });
      } else {
        outbounds.push(outbound); // 预构造的出站（tag 已为 out-<id8>）
      }
    }

    // 必须有 direct 出站（sing-box 启动要求）
    outbounds.push({ type: 'direct', tag: 'direct' });

    // 两类解析不变量（issue #154 + 2026-07 端点修正，真机 debug 确证）：
    //  · 代理出站（vless/vmess/trojan/hy2/tuic/ss/snell/anytls/naive/ssh…）：目标域名以 ATYP=domain **透传给出口远程
    //    解析**，不经本机 dns-direct（代理 dialer 只拨 server 地址、destination 进协议头）。各节点量到自身真实路径。
    //    ⚠️ 勿引入 sniff / outbound.domain_strategy / 针对目标的本地解析——会破坏此不变量。
    //  · 端点（WG/WARP…L3）：**必本地解析**目标（内核强制）。故上方用 inbound 键控 dns.rule 把端点的目标解析压到穿隧道
    //    223.5.5.5（AliDNS ECS 按出口地理返 IP、geo 正确、单形态覆盖境内外出口）；default_domain_resolver 仍解节点 server 地址。
    // ⚠️ 恒不下发顶层 `dns.strategy`：端点族别偏好靠上方的 query_type 规则项表达，而「无顶层 strategy」
    // 正是「省略 prefer_ipv4 == prefer_ipv4」这一等价性的前提（顶层若为 prefer_ipv6，端点解析会翻成 v6 优先，
    // 实测确证）。要加顶层 strategy 必须同时重新推导端点规则，别只加一半。单测锁死本不变量。
    const dns: Record<string, unknown> = { servers: dnsServers };
    if (dnsRules.length > 0) dns.rules = dnsRules; // 仅有端点节点时下发；纯代理配置零变化
    const config: Record<string, unknown> = {
      // 诊断采集会把 LogManager 提到 debug；临时测速核随之提级，复现时能把测速核自身的 DNS/dial 细节带进 app.log。
      // 非采集态保持 warn，避免普通测速输出膨胀。
      log: { level: this.logManager.getLogLevel?.() === 'debug' ? 'debug' : 'warn' },
      dns,
      inbounds,
      outbounds,
      route: {
        rules: routeRules,
        auto_detect_interface: true,
        default_domain_resolver: 'dns-direct',
      },
    };
    if (endpoints.length > 0) config.endpoints = endpoints; // 端点测速：顶层 endpoints[]
    return config;
  }

  private buildOutbound(server: ServerConfig, tag: string): Record<string, unknown> | null {
    const protocol = server.protocol.toLowerCase();
    // This legacy builder only owns these two protocols. Other nodes require the full builder.
    if (!['hysteria2', 'tuic'].includes(protocol)) return null;

    const outbound: Record<string, unknown> = {
      type: protocol,
      tag,
      server: server.address,
      server_port: server.port,
    };

    // ── Hysteria2 ──
    if (protocol === 'hysteria2') {
      outbound.password = server.password;

      if (server.hysteria2Settings?.upMbps) {
        outbound.up_mbps = server.hysteria2Settings.upMbps;
      }
      if (server.hysteria2Settings?.downMbps) {
        outbound.down_mbps = server.hysteria2Settings.downMbps;
      }
      if (server.hysteria2Settings?.obfs?.type && server.hysteria2Settings?.obfs?.password) {
        outbound.obfs = {
          type: server.hysteria2Settings.obfs.type,
          password: server.hysteria2Settings.obfs.password,
        };
      }
      if (server.hysteria2Settings?.network) {
        outbound.network = server.hysteria2Settings.network;
      }
    }

    // ── TUIC ──
    if (protocol === 'tuic') {
      outbound.uuid = server.uuid;
      outbound.password = server.password;

      if (server.tuicSettings) {
        if (server.tuicSettings.congestionControl) {
          outbound.congestion_control = server.tuicSettings.congestionControl;
        }
        if (server.tuicSettings.udpRelayMode) {
          outbound.udp_relay_mode = server.tuicSettings.udpRelayMode;
        }
        if (server.tuicSettings.zeroRttHandshake !== undefined) {
          outbound.zero_rtt_handshake = server.tuicSettings.zeroRttHandshake;
        }
        // heartbeat 经 normalizeDuration 收敛：表单录入裸毫秒整数会致测速内核 ParseDuration FATAL；带单位幂等。
        const heartbeat = normalizeDuration(server.tuicSettings.heartbeat);
        if (heartbeat) {
          outbound.heartbeat = heartbeat;
        }
      }
    }

    // ── TLS（hysteria2 和 tuic 都强制开启）──
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: server.tlsSettings?.serverName || server.address,
      insecure: server.tlsSettings?.allowInsecure || false,
    };
    if (server.tlsSettings?.alpn) {
      tls.alpn = server.tlsSettings.alpn;
    }
    outbound.tls = tls;

    return outbound;
  }

  // ═══════════════════════════════════════════════════════════════
  //  工具方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 经本地 HTTP 代理（临时 sing-box 各节点入站）测单节点延迟，量「实际请求时间」（不含建连/握手）。
   *
   * 做法对齐 mihomo `unified-delay`：CONNECT 到测速目标建一条隧道（= 已建立的「代理+目标」连接，等价 mihomo dial
   * 出来的 instance），https 目标先在隧道上做一次 TLS 握手；随后在**同一条**连接上发两次 GET——第一次暖身（承担
   * 建连+握手+冷启动，丢弃计时），第二次只量请求往返（响应头收齐 = warm TTFB）。
   * HTTP/HTTPS 走同一隧道路径：第二次请求是否 warm 不依赖 sing-box 入站是否复用出站（隧道本身就是那条已建立的连接），
   * 避免赌核内部行为。返回 null = 不可达/超时/对端过早关闭；单一总超时 timeout 兜底。
   */
  /** Default target failure is checked against an independent HTTPS origin before marking the node unavailable. */
  private async measureWithFallback(
    proxyPort: number,
    timeout: number,
    target: SpeedTestTarget,
    isCurrent: () => boolean = () => true
  ): Promise<{ latency: number | null; reason?: string }> {
    const describe = (t: SpeedTestTarget) =>
      `${t.https ? 'https' : 'http'}://${t.hostHeader}${t.path}`;
    // 每个检测目标拥有独立超时；主目标超时不能耗尽备用目标的预算。
    this.measuredTargets.delete(proxyPort);
    const first = await this.measureViaTunnel(proxyPort, timeout, target);
    this.measuredTargets.set(proxyPort, { target: describe(target), reason: first.reason });
    if (
      first.latency !== null ||
      !isCurrent() ||
      !target.https ||
      target.port !== 443 ||
      target.host !== 'www.gstatic.com' ||
      target.path !== '/generate_204'
    )
      return first;
    const fallback = await this.measureViaTunnel(
      proxyPort,
      timeout,
      resolveSpeedTestTarget('https://cp.cloudflare.com/generate_204')
    );
    this.measuredTargets.set(proxyPort, {
      target: 'https://cp.cloudflare.com/generate_204',
      reason: fallback.reason,
    });
    if (fallback.latency !== null) return fallback;
    const reason = `${first.reason ?? 'failed'}; fallback:${fallback.reason ?? 'failed'}`;
    this.measuredTargets.set(proxyPort, {
      target: 'https://cp.cloudflare.com/generate_204',
      reason,
    });
    return { latency: null, reason };
  }

  private measureViaTunnel(
    proxyPort: number,
    timeout: number,
    target: SpeedTestTarget,
    requiredStatus?: number
  ): Promise<{ latency: number | null; reason?: string }> {
    return new Promise((resolve) => {
      // 持有所有已建立句柄，finish 时统一 destroy（防 fd/socket 泄漏：大订阅并发 32 时累积）。
      let connectReq: http.ClientRequest | null = null;
      let tunnel: net.Socket | null = null;
      let tlsSock: tls.TLSSocket | null = null;
      let done = false;
      // issue #154 ③：latency=null 时带 reason（connect-/http-/tunnel-/timeout 等），供 testServersViaProxy 汇总
      // 失败原因分布——把「玄学超时」变成可定位（如 http-403=目标拒绝、connect-timeout=连不上）。
      const finish = (latency: number | null, reason?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        tlsSock?.destroy();
        tunnel?.destroy();
        connectReq?.destroy();
        resolve({ latency, reason });
      };
      const timer = setTimeout(() => finish(null, 'timeout'), timeout);

      // CONNECT 始终显式 host:port（标准端口也带，避免非标端口拼接歧义）。
      const connectHost = `${net.isIP(target.host) === 6 ? `[${target.host}]` : target.host}:${target.port}`;
      connectReq = http.request({
        host: '127.0.0.1',
        port: proxyPort,
        method: 'CONNECT',
        path: connectHost,
        headers: { Host: connectHost },
        timeout,
      });
      connectReq.on('error', () => finish(null, 'connect-error'));
      connectReq.on('timeout', () => finish(null, 'connect-timeout'));
      // CONNECT 非 2xx（如 502）实测仍走 'connect'（携带 statusCode），由下方 statusCode 判定兜 null；
      // 'response' 仅兜「代理把 CONNECT 降级成普通 HTTP 响应」的边缘情况，避免挂到总超时。
      connectReq.on('response', () => finish(null, 'connect-downgraded'));
      connectReq.on('connect', (res, socket) => {
        tunnel = socket;
        if (res.statusCode !== 200) {
          finish(null, `connect-${res.statusCode}`); // finish 内统一 destroy socket
          return;
        }
        socket.setNoDelay(true); // 关 Nagle：小请求 TTFB 不被 delayed-ACK/合包拖慢
        if (target.https) {
          // 隧道上做一次 TLS 握手（仅一次，归入第一次暖身）；必须校验证书，防拦截页被误判成代理可用。
          tlsSock = tls.connect(
            {
              socket,
              host: target.host,
              servername: net.isIP(target.host) ? undefined : target.host,
              rejectUnauthorized: true,
              ca: SPEED_TEST_CA,
            },
            () => this.measureWarmRtt(tlsSock!, target, finish, requiredStatus)
          );
          tlsSock.on('error', (error: NodeJS.ErrnoException) =>
            finish(null, `tls-error:${error.code ?? 'unknown'}`)
          );
        } else {
          this.measureWarmRtt(socket, target, finish, requiredStatus);
        }
      });
      connectReq.end();
    });
  }

  /**
   * 出口伴测入口（IpInfoService 代理出口探测成功后调用）：经主核 probe-proxy-in 的 HTTP 代理端口，用与节点测速
   * 完全相同的 CONNECT 隧道 + 2×GET 量 warm TTFB —— 产出口径 == latencyMap 的测速值（同端点/同算法/同 warm 语义），
   * 故可合法写入节点延迟。返回 null = 隧道不可用/超时/非 2xx/对端过早关闭 → 调用方放弃写入（绝不写 -1）。
   */
  async checkProxyHealth(proxyPort: number): Promise<boolean> {
    for (const url of [
      'https://www.gstatic.com/generate_204',
      'https://cp.cloudflare.com/generate_204',
    ]) {
      const result = await this.measureViaTunnel(proxyPort, 5000, resolveSpeedTestTarget(url), 204);
      if (result.latency !== null) return true;
    }
    return false;
  }

  async measureWarmRttViaHttpProxy(proxyPort: number, testUrl?: string): Promise<number | null> {
    const target = resolveSpeedTestTarget(testUrl);
    const { latency, reason } = await this.measureWithFallback(
      proxyPort,
      SpeedTestService.MEASURE_TIMEOUT_MS,
      target
    );
    // 失败记 reason（connect-502/timeout/early-close/http-403 等）至 debug——伴测 runner 侧仅拿到 null，
    // 排障（真机 V6 失败降级）须在此保留原因，否则失败静默无从区分。
    if (latency === null) {
      // Y1（§12.3.2）：带 target host——V37 判读 WARP 无延迟根因（early-close / http-4xx / MTU timeout）须知打的哪个目标。
      this.logManager.addLog(
        'debug',
        `出口伴测失败 (${reason ?? 'unknown'}) target=${target.host}:${target.port} port=${proxyPort}`,
        'SpeedTest'
      );
    }
    return latency;
  }

  private async probeEndpointTargetResolvedIps(
    proxyPort: number,
    server: ServerConfig,
    tag: string,
    targetHost: string,
    timeout: number
  ): Promise<SpeedTestResolvedIpDiagnostic> {
    const resolverPath = `dns-exit-${server.id} tcp/53 probe`;
    if (net.isIP(targetHost)) {
      return {
        serverId: server.id,
        serverName: server.name,
        tag,
        targetHost,
        resolverPath,
        resolvedIps: [targetHost],
      };
    }
    try {
      const resolvedIps = await this.queryDnsAOverTcpViaProxy(proxyPort, targetHost, timeout);
      return {
        serverId: server.id,
        serverName: server.name,
        tag,
        targetHost,
        resolverPath,
        resolvedIps,
        error: resolvedIps.length === 0 ? 'no-a-record' : undefined,
      };
    } catch (e: any) {
      return {
        serverId: server.id,
        serverName: server.name,
        tag,
        targetHost,
        resolverPath,
        resolvedIps: [],
        error: e?.message ?? String(e),
      };
    }
  }

  private queryDnsAOverTcpViaProxy(
    proxyPort: number,
    hostname: string,
    timeout: number
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      let connectReq: http.ClientRequest | null = null;
      let socket: net.Socket | null = null;
      let done = false;
      let buf = Buffer.alloc(0);
      const finish = (err: Error | null, ips?: string[]) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket?.destroy();
        connectReq?.destroy();
        if (err) reject(err);
        else resolve(ips ?? []);
      };
      const timer = setTimeout(() => finish(new Error('dns-probe-timeout')), timeout);
      connectReq = http.request({
        host: '127.0.0.1',
        port: proxyPort,
        method: 'CONNECT',
        path: '223.5.5.5:53',
        headers: { Host: '223.5.5.5:53' },
        timeout,
      });
      connectReq.on('error', () => finish(new Error('dns-probe-connect-error')));
      connectReq.on('timeout', () => finish(new Error('dns-probe-connect-timeout')));
      connectReq.on('response', () => finish(new Error('dns-probe-connect-downgraded')));
      connectReq.on('connect', (res, s) => {
        socket = s;
        if (res.statusCode !== 200) {
          s.destroy();
          finish(new Error(`dns-probe-connect-${res.statusCode}`));
          return;
        }
        socket.setNoDelay(true);
        socket.on('error', () => finish(new Error('dns-probe-socket-error')));
        socket.on('end', () => finish(new Error('dns-probe-early-close')));
        socket.on('data', (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length < 2) return;
          const len = buf.readUInt16BE(0);
          if (buf.length < len + 2) return;
          try {
            finish(null, SpeedTestService.parseDnsAResponse(buf.subarray(2, len + 2)));
          } catch (e: any) {
            finish(new Error(e?.message ?? String(e)));
          }
        });
        try {
          socket.write(SpeedTestService.buildDnsTcpQuery(hostname, 1));
        } catch (e: any) {
          finish(new Error(e?.message ?? String(e)));
        }
      });
      connectReq.end();
    });
  }

  private static buildDnsTcpQuery(hostname: string, qtype: number): Buffer {
    const labels = hostname.split('.').filter(Boolean);
    const qnameParts: Buffer[] = [];
    for (const label of labels) {
      const b = Buffer.from(label, 'ascii');
      if (b.length === 0 || b.length > 63) throw new Error('invalid-dns-label');
      qnameParts.push(Buffer.from([b.length]), b);
    }
    qnameParts.push(Buffer.from([0]));
    const body = Buffer.alloc(12 + qnameParts.reduce((n, b) => n + b.length, 0) + 4);
    let off = 0;
    body.writeUInt16BE(Math.floor(Math.random() * 0xffff), off);
    off += 2;
    body.writeUInt16BE(0x0100, off); // RD
    off += 2;
    body.writeUInt16BE(1, off); // QDCOUNT
    off += 2;
    body.writeUInt16BE(0, off); // ANCOUNT
    off += 2;
    body.writeUInt16BE(0, off); // NSCOUNT
    off += 2;
    body.writeUInt16BE(0, off); // ARCOUNT
    off += 2;
    for (const part of qnameParts) {
      part.copy(body, off);
      off += part.length;
    }
    body.writeUInt16BE(qtype, off);
    off += 2;
    body.writeUInt16BE(1, off); // IN
    const frame = Buffer.alloc(body.length + 2);
    frame.writeUInt16BE(body.length, 0);
    body.copy(frame, 2);
    return frame;
  }

  private static parseDnsAResponse(buf: Buffer): string[] {
    if (buf.length < 12) throw new Error('dns-response-short');
    const qd = buf.readUInt16BE(4);
    const an = buf.readUInt16BE(6);
    let off = 12;
    for (let i = 0; i < qd; i++) {
      off = SpeedTestService.skipDnsName(buf, off) + 4; // qtype + qclass
      if (off > buf.length) throw new Error('dns-question-truncated');
    }
    const ips: string[] = [];
    for (let i = 0; i < an; i++) {
      off = SpeedTestService.skipDnsName(buf, off);
      if (off + 10 > buf.length) throw new Error('dns-answer-truncated');
      const type = buf.readUInt16BE(off);
      const klass = buf.readUInt16BE(off + 2);
      const rdlen = buf.readUInt16BE(off + 8);
      off += 10;
      if (off + rdlen > buf.length) throw new Error('dns-rdata-truncated');
      if (type === 1 && klass === 1 && rdlen === 4) {
        ips.push(`${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`);
      }
      off += rdlen;
    }
    return ips;
  }

  private static skipDnsName(buf: Buffer, offset: number): number {
    let off = offset;
    let jumps = 0;
    while (off < buf.length) {
      const len = buf[off];
      if ((len & 0xc0) === 0xc0) {
        if (off + 1 >= buf.length) throw new Error('dns-pointer-truncated');
        jumps++;
        if (jumps > 16) throw new Error('dns-pointer-loop');
        return off + 2;
      }
      if (len === 0) return off + 1;
      if ((len & 0xc0) !== 0) throw new Error('dns-label-invalid');
      off += 1 + len;
    }
    throw new Error('dns-name-truncated');
  }

  /**
   * 在一条已建立的隧道（net.Socket 或隧道上的 tls.TLSSocket）上发两次 GET，只计第二次「响应头收齐」的耗时（warm RTT）。
   *
   * 按 Content-Length/chunked 边界消费第一次响应后再发第二次请求；正文不能冒充响应头。
   * 支持分段、chunk 扩展/尾部和信息响应；无法复用或畸形报文返回失败，缓冲受限。
   * 第二次响应头收齐且状态码满足检测要求才产生延迟值。
   * 请求用 origin-form（隧道直连 origin，路径非代理绝对 URI）。
   */
  private measureWarmRtt(
    conn: net.Socket | tls.TLSSocket,
    target: SpeedTestTarget,
    finish: (latency: number | null, reason?: string) => void,
    requiredStatus?: number
  ): void {
    const request = `GET ${target.path} HTTP/1.1\r\nHost: ${target.hostHeader}\r\nConnection: keep-alive\r\n\r\n`;
    let buf = '';
    let firstDone = false;
    let start = 0;
    let finished = false;
    const complete = (latency: number | null, reason?: string) => {
      if (finished) return;
      finished = true;
      finish(latency, reason);
    };
    conn.on('data', (chunk: Buffer) => {
      if (finished) return;
      buf += chunk.toString('latin1');
      // Bound untrusted headers/body buffering; generate_204 has no body.
      if (buf.length > 1024 * 1024) {
        complete(null, 'http-response-too-large');
        return;
      }
      try {
        while (true) {
          const end = buf.indexOf('\r\n\r\n');
          if (end < 0) {
            if (buf.length > 65536) complete(null, 'http-header-too-large');
            return;
          }
          if (end > 65536) {
            complete(null, 'http-header-too-large');
            return;
          }
          const header = buf.slice(0, end);
          const code = parseHttpStatusCode(header);
          if (code === null) {
            complete(null, 'http-unparsable');
            return;
          }
          if (code >= 100 && code < 200 && code !== 101) {
            buf = buf.slice(end + 4);
            continue;
          }
          if (!firstDone) {
            const length = warmResponseLength(buf, header, end + 4, code);
            if (length === undefined) return;
            buf = buf.slice(length);
            if (buf.length) {
              complete(null, 'http-framing-invalid');
              return;
            }
            firstDone = true;
            start = performance.now();
            conn.write(request);
            return;
          }
          if (
            !isAcceptableSpeedTestStatus(code) ||
            (requiredStatus !== undefined && code !== requiredStatus)
          ) {
            complete(null, `http-${code}`);
          } else {
            complete(Math.round(performance.now() - start));
          }
          return;
        }
      } catch {
        complete(null, 'http-framing-invalid');
      }
    });
    conn.on('error', () => complete(null, 'tunnel-error'));
    conn.on('end', () => complete(null, 'early-close')); // 对端在测完前关闭 → 失败
    conn.write(request); // 第一次（暖身，丢弃计时）
  }

  /**
   * 并发上限执行（固定大小 worker 池）：最多 `limit` 个任务同时进行，其余排队。
   * 用于测速——完成即补位，workerIndex 在整个任务期间固定，用于绑定探测端口。
   */
  private async runWithLimit<T>(
    items: T[],
    limit: number,
    fn: (item: T, workerIndex: number) => Promise<void>
  ): Promise<void> {
    let idx = 0;
    let failed = false;
    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      async (_, workerIndex) => {
        while (!failed && idx < items.length) {
          const i = idx++;
          try {
            await fn(items[i], workerIndex);
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      }
    );
    // 不提前返回：同槽还有在飞请求时不能结束任务并允许下一次测速重用该槽。
    const settled = await Promise.allSettled(workers);
    const rejection = settled.find((result) => result.status === 'rejected');
    if (rejection?.status === 'rejected') throw rejection.reason;
  }

  private async checkProbeConfig(
    binary: string,
    file: string,
    config: Record<string, unknown>
  ): Promise<boolean> {
    await fs.writeFile(file, JSON.stringify(config), { mode: 0o600 });
    return new Promise((resolve, reject) => {
      execFile(
        binary,
        ['check', '-c', file],
        { timeout: 5000, maxBuffer: 65536, windowsHide: true },
        (error) => {
          if (!error) resolve(true);
          else if (typeof error.code === 'number' && !error.killed) resolve(false);
          else reject(new Error('Probe core validation unavailable'));
        }
      );
    });
  }

  private async findFreePorts(count: number): Promise<number[]> {
    const servers: net.Server[] = [];
    const ports: number[] = [];

    try {
      // 同时绑定所有端口，确保不冲突
      for (let i = 0; i < count; i++) {
        const srv = net.createServer();
        await new Promise<void>((resolve, reject) => {
          srv.listen(0, '127.0.0.1', () => resolve());
          srv.on('error', reject);
        });
        ports.push((srv.address() as net.AddressInfo).port);
        servers.push(srv);
      }
    } finally {
      // 关闭所有临时服务器，释放端口给 sing-box 使用
      await Promise.all(
        servers.map((srv) => new Promise<void>((resolve) => srv.close(() => resolve())))
      );
    }

    return ports;
  }

  /**
   * 等待端口可连接（表示 sing-box 已就绪）
   */
  private async waitForPortReady(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(500);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, '127.0.0.1');
      });

      if (ok) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }
}

/** Consume the first response body before issuing the timed request on the same connection. */
function warmResponseLength(
  buf: string,
  header: string,
  bodyStart: number,
  code: number
): number | undefined {
  if (code === 204 || code === 304) return bodyStart;
  const lengths = [...header.matchAll(/^content-length:\s*(.*?)\s*$/gim)].map((m) => m[1]);
  const encodings = [...header.matchAll(/^transfer-encoding:\s*(.*?)\s*$/gim)].map((m) =>
    m[1].toLowerCase()
  );
  if (encodings.length) {
    if (lengths.length || encodings.length !== 1 || encodings[0] !== 'chunked')
      throw new Error('ambiguous-framing');
    let offset = bodyStart;
    while (true) {
      const lineEnd = buf.indexOf('\r\n', offset);
      if (lineEnd < 0) return undefined;
      const line = buf.slice(offset, lineEnd);
      if (!/^[0-9a-f]+(?:;[^\r\n]*)?$/i.test(line)) throw new Error('invalid-chunk');
      const size = Number.parseInt(line.split(';')[0], 16);
      if (!Number.isSafeInteger(size) || size > 1024 * 1024) throw new Error('invalid-size');
      offset = lineEnd + 2;
      if (size === 0) {
        if (buf.slice(offset, offset + 2) === '\r\n') return offset + 2;
        const trailersEnd = buf.indexOf('\r\n\r\n', offset);
        return trailersEnd < 0 ? undefined : trailersEnd + 4;
      }
      if (buf.length < offset + size + 2) return undefined;
      if (buf.slice(offset + size, offset + size + 2) !== '\r\n')
        throw new Error('invalid-chunk-end');
      offset += size + 2;
    }
  }
  // Close-delimited responses cannot be reused for a warm request.
  if (!lengths.length || lengths.some((value) => !/^\d+$/.test(value) || value !== lengths[0]))
    throw new Error('missing-length');
  const length = Number(lengths[0]);
  if (!Number.isSafeInteger(length) || length > 1024 * 1024) throw new Error('invalid-length');
  return buf.length >= bodyStart + length ? bodyStart + length : undefined;
}

/** Do not release the single-flight slot while the previous temporary kernel still owns sessions. */
async function stopProbeProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;
  await new Promise<void>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.removeListener('exit', finish);
      child.removeListener('close', finish);
      child.removeListener('error', finish);
      resolve();
    };
    child.once('exit', finish);
    child.once('close', finish);
    child.once('error', finish);
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may already have exited between the deadline and signal delivery.
      } finally {
        finish();
      }
    }, 2000);
    try {
      if (!child.kill('SIGTERM')) finish();
    } catch {
      finish();
    }
  });
}
