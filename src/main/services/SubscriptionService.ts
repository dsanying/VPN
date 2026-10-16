import {
  serverFingerprint,
  reconcileServers,
  leftoverToKeep,
} from '../../shared/subscription-reconciliation';
import { physicalSubscriptionFetch } from './subscription-physical-network';
import {
  requestSubscription,
  DEFAULT_SUBSCRIPTION_USER_AGENT,
  type SubscriptionRequestRoute,
} from '../../shared/subscription-request';
import { load as yamlLoad, CORE_SCHEMA } from 'js-yaml';
import { parseSubscriptionUsage, parseSubscriptionUserInfo } from '../../shared/subscription-usage';
import { randomUUID } from 'crypto';
import { session, type Session } from 'electron';
import type { ServerConfig, SubscriptionConfig, ImportParseResult } from '../../shared/types';
import { ProtocolParser } from './ProtocolParser';
import { LogManager } from './LogManager';
import { safeRedirectFetch } from '../safe-redirect-fetch';
import { PortableImportParser } from '../../shared/import-parser';
import { PortableSubscriptionParser } from '../../shared/subscription-content-parser';
import { summarizeNodeProtocols } from '../../shared/subscription-protocol';
import {
  classifySubscriptionError,
  type SubscriptionPreviewResult,
} from '../../shared/subscription-preview';

/** 默认请求 Clash Meta 格式；仅作为本地解析器已支持的格式协商，用户自定义 UA 优先。 */
export function defaultSubscriptionUserAgent(): string {
  return DEFAULT_SUBSCRIPTION_USER_AGENT;
}

export interface SubscriptionUpdateResult {
  success: boolean;
  addedServers: number;
  updatedServers: number;
  deletedServers: number;
  error?: string;
  userInfo?: SubscriptionConfig['userInfo'];
  /** §16.3.4：304/无内容变化 → true（UI 可弹「订阅无变化」toast，不 force-restart）。 */
  unchanged?: boolean;
}

export class SubscriptionService {
  // 响应体积上限：超大响应直接 OOM（兼缓解 YAML 锚点炸弹的输入面）。content-length 预检 + 读取后字节校验双闸。
  private static readonly MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB
  // 主订阅 fetch 超时（比 provider 15s 宽）：防 slow-loris 挂死、scheduler isRunning 永真卡死后续更新。
  private static readonly MAIN_FETCH_TIMEOUT_MS = 30_000;

  private protocolParser: ProtocolParser;
  private logManager: LogManager;
  // 固定代理入口会话按端口隔离，避免重启改变正在执行的请求路径。
  private proxiedSession: Session | null = null;
  private proxiedSessionPort: number | null = null;
  // 固定路径端口读取器；由宿主注入，代理不可用不伪装为直连成功。
  private requestPortsProvider: (() => { direct: number; proxy: number } | null) | null = null;

  constructor(protocolParser: ProtocolParser, logManager: LogManager) {
    this.protocolParser = protocolParser;
    this.logManager = logManager;
  }

  /** 注入与连通性检测共用的固定直连/代理入口。 */
  setRequestPortsProvider(provider: () => { direct: number; proxy: number } | null): void {
    this.requestPortsProvider = provider;
  }

  private async getDirectSession(port: number): Promise<Session> {
    const routed = session.fromPartition(`shadowvpn-subscription-direct-${port}`);
    await routed.setProxy({
      proxyRules: `http://127.0.0.1:${port}`,
      proxyBypassRules: '<-loopback>',
    });
    return routed;
  }

  /** 固定代理 mixed 入口；每个端口使用独立会话，禁用隐式绕过。 */
  private async getProxiedSession(port: number): Promise<Session> {
    if (this.proxiedSession && this.proxiedSessionPort === port) return this.proxiedSession;
    const s = session.fromPartition(`shadowvpn-subscription-proxied-${port}`);
    await s.setProxy({ proxyRules: `http://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    this.proxiedSession = s;
    this.proxiedSessionPort = port;
    return s;
  }

  static serverFingerprint = serverFingerprint;
  static reconcileServers = reconcileServers;
  static leftoverToKeep = leftoverToKeep;

  private parseUsageDocument(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      if (!/^(?:user[-_]?info|usage|traffic|subscription)\s*:/im.test(text)) return undefined;
      try {
        return yamlLoad(text, { schema: CORE_SCHEMA });
      } catch {
        return undefined;
      }
    }
  }

  private parseUserInfo(header: string | null): SubscriptionConfig['userInfo'] | undefined {
    return parseSubscriptionUserInfo(header);
  }

  private contentParser(ctx: {
    viaProxy: SubscriptionRequestRoute;
    userAgent: string;
  }): PortableSubscriptionParser {
    return new PortableSubscriptionParser(
      async (url, signal) =>
        (await this.fetchSubscriptionText(url, ctx.viaProxy, ctx.userAgent, signal)).text,
      this.protocolParser,
      this.logManager
    );
  }

  /** URL query 脱敏（去整段 query，常含 ?token=），仅用于日志，防 token 落 app.log。 */
  private static redactUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.search ? `${u.origin}${u.pathname}?<redacted>` : `${u.origin}${u.pathname}`;
    } catch {
      // 非法 URL：截断到 ? 前，兜底去 query
      const q = url.indexOf('?');
      return q >= 0 ? `${url.slice(0, q)}?<redacted>` : url;
    }
  }

  /**
   * 第一层（网络）：拉取订阅文本。含 SSRF guard + 会话选择 + ok 校验。
   * 抽出供 proxy-providers 编排复用——provider url 来自订阅正文(远端可控)，复用同一 fetch 路径
   * 天然继承 SSRF guard（这是"必须复用"的安全硬理由）。
   * @returns { text, userInfo }（仅主订阅消费 userInfo；provider 调用忽略）。
   */
  private async fetchSubscriptionText(
    url: string,
    route: SubscriptionRequestRoute,
    userAgent: string,
    signal?: AbortSignal,
    conditional?: { etag?: string; lastModified?: string }
  ) {
    return requestSubscription(
      route,
      () => !!this.requestPortsProvider?.()?.proxy,
      (proxy) =>
        this.fetchSubscriptionTextOnRoute(
          url,
          proxy,
          userAgent,
          signal ?? AbortSignal.timeout(SubscriptionService.MAIN_FETCH_TIMEOUT_MS),
          conditional
        ),
      (error) => {
        const failure = error as { message?: string; code?: string; cause?: { code?: string } };
        const kind = classifySubscriptionError({
          message: failure?.message,
          code: failure?.code ?? failure?.cause?.code,
        }).errorKind;
        return !signal?.aborted && ['dns', 'timeout', 'refused', 'http', 'unknown'].includes(kind);
      }
    );
  }

  private async fetchSubscriptionTextOnRoute(
    url: string,
    viaProxy: boolean,
    userAgent: string,
    signal?: AbortSignal,
    conditional?: { etag?: string; lastModified?: string }
  ): Promise<{
    text: string;
    userInfo?: SubscriptionConfig['userInfo'];
    /** §16.3.4：本次 200 响应的验证器（回写 sub，下次条件 GET 用）。 */
    etag?: string;
    lastModified?: string;
    /** §16.3.4：304 Not Modified（条件 GET 命中）→ text 空、调用方短路 parse/reconcile。 */
    notModified?: boolean;
  }> {
    // 解析初始 URL：限 http(s)。
    const parse = (u: string): URL => {
      let urlObj: URL | null;
      try {
        urlObj = new URL(u);
      } catch {
        urlObj = null;
      }
      if (!urlObj || (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:')) {
        throw new Error(
          `订阅地址协议不支持（仅允许 http/https）: ${SubscriptionService.redactUrl(u)}`
        );
      }
      return urlObj;
    };

    const ports = this.requestPortsProvider?.();
    if (viaProxy && !ports?.proxy) throw new Error('Subscription proxy is unavailable');
    const selectedSession = viaProxy
      ? await this.getProxiedSession(ports!.proxy)
      : ports?.direct
        ? await this.getDirectSession(ports.direct)
        : undefined;
    const fetchImpl = selectedSession
      ? selectedSession.fetch.bind(selectedSession)
      : physicalSubscriptionFetch;
    const viaProxiedSession = viaProxy;

    // H1+H2：初始 URL + 每跳 Location 都过 SSRF guard，收口到 safeRedirectFetch（首跳 + 逐跳复检防 redirect
    // 跳到内网的 SSRF 绕过）。先 parse 校验协议（保留订阅特有「订阅地址协议不支持」文案 + 脱敏），再交 helper。
    // 仅实际走 proxied（viaProxiedSession）才豁免 暗影VPN FakeIP（系统 DNS 把公网域名解析成假 IP、经核反查真实、
    // 本机内网不可达）；直连/端口回退不豁免，防域名真实解析到本机内网的 SSRF。helper 的安全拒绝（含「重定向
    // 次数超过上限」「本机/内网」）按原文案冒泡给 UI。
    parse(url); // 初始 URL 协议校验（http/https）
    // §16.3.4 条件 GET：带上次 validator（If-None-Match / If-Modified-Since，缓存验证器非凭据，逐跳携带无泄漏面）。
    const condHeaders: Record<string, string> = {};
    if (conditional?.etag) condHeaders['If-None-Match'] = conditional.etag;
    if (conditional?.lastModified) condHeaders['If-Modified-Since'] = conditional.lastModified;
    const response = await safeRedirectFetch<GlobalResponse>({
      fetchImpl: (u, init) => fetchImpl(u, init) as Promise<GlobalResponse>,
      url,
      userAgent,
      exemptFakeIp: viaProxiedSession,
      ...(Object.keys(condHeaders).length ? { headers: condHeaders } : {}),
      ...(signal ? { signal } : {}),
    });
    // §16.3.4：304 Not Modified → 短路，不读 body、不 parse/reconcile（零节点扰动、省流省渲染）。
    // **仅当本次确实发了条件头才认 304**（fail-safe）：provider 拉取从不带条件头，若某 CDN/缓存对无验证器请求
    // 违规返 304，认它会得空 body→0 节点→permanent 删节点；此时应维持原「304 非 ok → throw」→ transient → merge-only 保留。
    if (response.status === 304 && Object.keys(condHeaders).length > 0) {
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      return { text: '', notModified: true };
    }
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // The HTTP error remains the request failure, even if cleanup fails.
      }
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    // content-length 预检（早拒超大响应）。
    const cl = response.headers.get('content-length');
    if (cl) {
      const n = parseInt(cl, 10);
      if (Number.isFinite(n) && n > SubscriptionService.MAX_BODY_BYTES) {
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        throw new Error(
          `订阅响应体积 ${n} 字节超过上限 ${SubscriptionService.MAX_BODY_BYTES}，已拒绝`
        );
      }
    }

    const userInfo = this.parseUserInfo(response.headers.get('subscription-userinfo'));
    // §16.3.4：回传本次 200 的验证器供回写 sub（下次条件 GET）。
    const etag = response.headers.get('etag') ?? undefined;
    const lastModified = response.headers.get('last-modified') ?? undefined;
    // 流式读取并按字节累计上限（content-length 可缺失/撒谎，读取侧硬校验兜底）。
    const text = await this.readBodyCapped(response);
    return { text, userInfo, etag, lastModified };
  }

  /**
   * 流式读取响应体，累计字节超 MAX_BODY_BYTES 即 abort + throw（防 OOM；缓解 YAML 锚点炸弹输入面）。
   * 无 body（如某些 204）→ 退回 response.text()。
   */
  private async readBodyCapped(response: GlobalResponse): Promise<string> {
    const max = SubscriptionService.MAX_BODY_BYTES;
    const body = response.body;
    if (!body) {
      const t = await response.text();
      if (Buffer.byteLength(t, 'utf-8') > max) {
        throw new Error(`订阅响应体积超过上限 ${max}，已拒绝`);
      }
      return t;
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > max) {
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            throw new Error(`订阅响应体积超过上限 ${max}，已拒绝`);
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
  }

  /**
   * 第二层（解析）：trimmed 内容 → ServerConfig[]。四分支：
   *   ① Sing-box JSON(outbounds) / JSON 编码 Clash(proxies / proxy-providers)
   *   ② Clash YAML(proxies / proxy-providers)
   *   ③ 明文 URL-list
   *   ④ Base64 URL-list
   * ctx.allowProviders：主订阅 true；provider 响应以 false 再入本函数 → 不递归 proxy-providers（深度硬封顶 2 层）。
   * @returns servers + partial（任一 provider 失败 → 调用方 reconcile 改 merge-only 防穿仓）。
   */
  private async parseSubscriptionContent(
    trimmed: string,
    subscriptionId: string,
    ctx: {
      allowProviders: boolean;
      viaProxy: SubscriptionRequestRoute;
      userAgent: string;
      throwOnEmpty?: boolean;
    }
  ): Promise<{ servers: ServerConfig[]; partial?: boolean; failedProviders?: string[] }> {
    return this.contentParser(ctx).parseSubscriptionContent(trimmed, subscriptionId, ctx);
  }

  /**
   * 拉取并解析订阅 URL，返回 ServerConfig 列表。
   * 支持格式:
   *   1. Sing-box JSON (带 outbounds 数组) — GlaDOS /singbox/ 等
   *   2. Clash / mihomo YAML（proxies / proxy-providers）
   *   3. 明文 URL 列表 (每行一个 vless:// / ss:// / trojan:// ...)
   *   4. Base64 编码的 URL 列表
   * @param userAgent 可选 UA（per-sub ?? 全局 ?? 默认）；缺省时用 defaultSubscriptionUserAgent()。
   * @returns partial=true 当 Clash provider 部分失败 → 调用方 reconcile 改 merge-only 防穿仓。
   */
  async fetchSubscription(
    url: string,
    subscriptionId: string,
    viaProxy: SubscriptionRequestRoute = 'auto',
    userAgent?: string,
    conditional?: { etag?: string; lastModified?: string }
  ): Promise<{
    servers: ServerConfig[];
    userInfo?: SubscriptionConfig['userInfo'];
    partial?: boolean;
    failedProviders?: string[];
    /** §16.3.4：本次 200 响应验证器 + 是否含 provider（供调用方回写 sub）。 */
    etag?: string;
    lastModified?: string;
    hasProviders?: boolean;
    /** §16.3.4：304 命中 → servers 空、调用方短路 reconcile（仅刷元数据）。 */
    notModified?: boolean;
  }> {
    try {
      // url 常含 ?token=，日志脱敏（去 query）防 token 落 app.log。
      this.logManager.addLog(
        'info',
        `正在拉取订阅: ${SubscriptionService.redactUrl(url)}（${viaProxy === 'auto' ? '自动路径' : viaProxy ? '经代理' : '直连'}）`,
        'Subscription'
      );

      const ua = userAgent?.trim() || DEFAULT_SUBSCRIPTION_USER_AGENT;
      // 主订阅 fetch 加超时（30s，比 provider 15s 宽）→ 防 slow-loris 挂死 scheduler.isRunning 永真。
      // §16.3.4：conditional 由调用方决定是否传（provider 型订阅豁免——见 subscription-handlers/scheduler）。
      const { text, userInfo, etag, lastModified, notModified } = await this.fetchSubscriptionText(
        url,
        viaProxy,
        ua,
        undefined,
        conditional
      );
      // §16.3.4：304 → 内容无变化，短路 parse/reconcile（零节点扰动）。
      if (notModified) {
        this.logManager.addLog('info', '订阅无变化（304），跳过解析', 'Subscription');
        return { servers: [], notModified: true, etag, lastModified };
      }
      if (userInfo) {
        this.logManager.addLog('info', '订阅流量信息已获取', 'Subscription');
      }

      const trimmed = text.trim();
      // §16.3.4：hasProviders=含 Clash proxy-providers → 回写 sub，下次豁免条件 GET（主正文 304 会掩盖 provider 独立变化）。
      // 兼容 YAML（行首 `proxy-providers:`）与 JSON 形态（`"proxy-providers":`，同支持路径 handleClashDoc）两种键形，
      // 避免 JSON 型 provider 订阅漏检 → 误发条件头 → 主正文恒 304 掩盖 provider 变化 → 节点无限期陈旧。宁可误判 true
      //（多一次全量拉取，零回归）不可漏判。
      const hasProviders =
        /(^|\n)\s*proxy-providers\s*:/.test(trimmed) || /"proxy-providers"\s*:/.test(trimmed);
      const { servers, partial, failedProviders } = await this.parseSubscriptionContent(
        trimmed,
        subscriptionId,
        {
          allowProviders: true,
          viaProxy,
          userAgent: ua,
        }
      );

      return {
        servers,
        userInfo: parseSubscriptionUsage(
          userInfo,
          servers.map((server) => server.name),
          this.parseUsageDocument(trimmed)
        ),
        partial,
        failedProviders,
        etag,
        lastModified,
        hasProviders,
      };
    } catch (error: any) {
      // 失败日志同样脱敏 url。
      this.logManager.addLog(
        'error',
        `拉取订阅失败 (${SubscriptionService.redactUrl(url)}): ${error.message}`,
        'Subscription'
      );
      throw error;
    }
  }

  /**
   * 订阅预检（新增订阅前先行）。动机（先加后删闪现/竞态 + 失败无原因）：add 原为「先建记录 → 再拉节点」，
   * 拉取失败要么留空订阅要么删记录（闪现），且只有布尔无原因。改为**预检先行**——用 URL **拉取 + 解析但
   * 不写 config、不建订阅记录、不碰 reconcile**；成功返回节点数，失败返回**分类错误**供 UI 说清原因 + 留窗。
   *
   * 复用 fetchSubscriptionText（含 SSRF guard——安全硬要求，绝不自写 fetch）+ parseSubscriptionContent
   * （throwOnEmpty:true → 0 节点抛错，经 classifySubscriptionError 落 empty 分类）。tempSubId 随机、仅供解析
   * 用不入库（预检产物整体丢弃，只取 servers.length）。
   */
  async previewSubscription(url: string): Promise<SubscriptionPreviewResult> {
    const viaProxy: SubscriptionRequestRoute = 'auto';
    const userAgent = DEFAULT_SUBSCRIPTION_USER_AGENT;
    const tempSubId = randomUUID(); // 不入库
    try {
      const { text } = await this.fetchSubscriptionText(url, viaProxy, userAgent);
      const { servers } = await this.parseSubscriptionContent(text.trim(), tempSubId, {
        allowProviders: true,
        viaProxy,
        userAgent,
        throwOnEmpty: true,
      });
      return {
        ok: true,
        nodeCount: servers.length,
        protocols: summarizeNodeProtocols(servers),
      };
    } catch (err: any) {
      // 摊平错误信号交纯分类器（不自己判分类）：message + code(err.code ?? cause.code) + 从
      // 'HTTP Error: NNN'（fetchSubscriptionText 的 HTTP 失败文案 `HTTP Error: ${status} ${statusText}`）提 status。
      const message: string = err?.message ?? '';
      const httpMatch = /HTTP Error:\s*(\d{3})/.exec(message);
      const httpStatus = httpMatch ? parseInt(httpMatch[1], 10) : undefined;
      const cls = classifySubscriptionError({
        message,
        code: err?.code ?? err?.cause?.code,
        httpStatus,
      });
      return {
        ok: false,
        errorKind: cls.errorKind,
        httpStatus: cls.httpStatus,
        message: SubscriptionService.redactUrl(message), // 脱敏，仅诊断
      };
    }
  }

  /**
   * 本地导入解析（不联网）：文件/文本字符串 → 自建节点 + （仅 Clash）订阅条目 + 统计。
   * 复用订阅解析的同款探测与解析器（sing-box JSON / Clash / base64 / 分享链接），新增 Xray 分支。
   *  - 节点一律剥离 subscriptionId/providerName → 归入「自建」（可编辑、可删除）。
   *  - sing-box JSON 中未映射但合法的 outbound type → 透传为 custom（使用时经启动 gate 置灰）；Xray/Clash 未支持 → 跳过报告。
   *  - proxy-providers 仅提取 {name,url}，**不拉取**（导入订阅默认不自动更新/直连）。
   *  - 最终用 isServerComplete 过滤掉会让 saveConfig.validateConfig throw 的节点（计 failed），保证批量入库不整体失败。
   *  - 不可识别格式 → throw（门控，调用方提示报错）。
   */
  async parseLocalContent(text: string): Promise<ImportParseResult> {
    return new PortableImportParser(this.protocolParser, this.logManager).parseLocalContent(text);
  }
}
