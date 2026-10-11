import type { ServerConfig, LogLevel } from './types';
import { ProtocolParser, type IProtocolParser } from './protocol-parser';
import { decodeBase64Utf8 } from './portable-codec';
import {
  CLASH_PROBE_RE,
  tryLoadClashDoc,
  parseClashProxies,
  resolveProxyProviders,
  type ClashDoc,
} from './clash-subscription-parser';
import { parseXrayOutbounds } from './xray-import';
import { parseSingboxOutbounds, type SingboxOutbound } from './singbox-subscription-parser';
import { serverFingerprint } from './subscription-reconciliation';

interface ParserLogger {
  addLog(level: LogLevel, message: string, source: string): unknown;
}

/** Content parsing is portable; the host owns verified network access and request policy. */
export class PortableSubscriptionParser {
  constructor(
    private readonly fetchProviderText: (url: string, signal: AbortSignal) => Promise<string>,
    private readonly protocolParser: IProtocolParser = new ProtocolParser(),
    private readonly logManager: ParserLogger = { addLog: () => undefined }
  ) {}
  parseSingboxOutbounds(outbounds: SingboxOutbound[], subscriptionId: string): ServerConfig[] {
    return parseSingboxOutbounds(outbounds, subscriptionId, this.logManager);
  }

  private dedupeByFingerprint(servers: ServerConfig[]): ServerConfig[] {
    const seen = new Map<string, ServerConfig>();
    for (const s of servers) {
      const key = serverFingerprint(s);
      if (!seen.has(key)) seen.set(key, s);
    }
    return [...seen.values()];
  }
  async parseSubscriptionContent(
    trimmed: string,
    subscriptionId: string,
    ctx: {
      allowProviders: boolean;
      // throwOnEmpty=false：provider 复用路径用（0 节点返回空集而非 throw，让 resolveProxyProviders
      // 按 permanent 0-node 处理；真正的 YAML/JSON 结构错误仍由 tryLoadClashDoc 上抛）。默认 true。
      throwOnEmpty?: boolean;
    }
  ): Promise<{ servers: ServerConfig[]; partial?: boolean; failedProviders?: string[] }> {
    if (new TextEncoder().encode(trimmed).byteLength > 10 * 1024 * 1024)
      throw new Error('订阅内容体积超过上限');
    const throwOnEmpty = ctx.throwOnEmpty !== false;
    // ── 1. JSON: sing-box outbounds 或 JSON 编码的 Clash ──────────────
    // 数据穿仓风险：try 只包 JSON.parse 本身，catch 仅消化「非 JSON」(SyntaxError) 以 fall through；
    // 分流调用（parseSingboxOutbounds/handleClashDoc）移出 catch 作用域 —— 否则 handleClashDoc 的
    // 「0 节点必须 throw」会被这个 catch 吞掉，fall through 到 Base64 返回空集，reconcile 删光节点。
    let json: unknown;
    let isJson = false;
    try {
      json = JSON.parse(trimmed);
      isJson = true;
    } catch {
      // 非 JSON（SyntaxError）→ fall through 到 YAML / URL-list 分支
    }
    if (isJson && json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      if (Array.isArray(obj.outbounds)) {
        if (
          obj.outbounds.some(
            (outbound: unknown) =>
              !!outbound &&
              typeof outbound === 'object' &&
              'protocol' in outbound &&
              !('type' in outbound)
          )
        ) {
          const result = parseXrayOutbounds(obj.outbounds, new Date().toISOString());
          result.servers.forEach((server) => {
            server.subscriptionId = subscriptionId;
          });
          if (!result.servers.length && throwOnEmpty)
            throw new Error('Xray subscription contains no usable nodes');
          result.warnings.forEach((message) =>
            this.logManager.addLog('warn', message, 'Subscription')
          );
          return { servers: result.servers, partial: result.failed > 0 || result.skipped > 0 };
        }
        this.logManager.addLog(
          'info',
          '检测到 sing-box JSON 格式，解析 outbounds...',
          'Subscription'
        );
        const servers = this.parseSingboxOutbounds(obj.outbounds, subscriptionId);
        // 0 节点必须 throw（与 Clash 分支对齐），不返回空集 → 防 reconcile 删光存量 + 清 selectedServerId。
        if (servers.length === 0) {
          if (throwOnEmpty) throw new Error('sing-box 订阅解析得到 0 个可用节点');
          return { servers: [] };
        }
        this.logManager.addLog(
          'info',
          `成功从 sing-box 订阅解析了 ${servers.length} 个节点`,
          'Subscription'
        );
        return { servers };
      }
      if (
        Array.isArray(obj.proxies) ||
        (obj['proxy-providers'] && typeof obj['proxy-providers'] === 'object')
      ) {
        this.logManager.addLog(
          'info',
          '检测到 JSON 编码的 Clash 配置，解析 proxies...',
          'Subscription'
        );
        // handleClashDoc 的 0 节点 throw 在此正常上抛（不再被 catch 吞）。
        return await this.handleClashDoc(obj as ClashDoc, subscriptionId, ctx);
      }
    }

    // ── 2. Clash YAML（命中 proxies: 或 proxy-providers:）─────────────
    if (CLASH_PROBE_RE.test(trimmed)) {
      this.logManager.addLog('info', '检测到 Clash YAML 格式，解析 proxies...', 'Subscription');
      const doc = tryLoadClashDoc(trimmed); // 解析失败上抛，不静默落 Base64
      const hasProxies = Array.isArray(doc.proxies);
      const hasProviders = !!doc['proxy-providers'] && typeof doc['proxy-providers'] === 'object';
      if (!hasProxies && !hasProviders) {
        throw new Error('检测到 Clash 订阅特征，但 proxies/proxy-providers 结构异常');
      }
      return await this.handleClashDoc(doc, subscriptionId, ctx);
    }

    // ── 3/4. URL list (plain or Base64-encoded) ──────────────────────
    let decodedContent = trimmed;
    if (!decodedContent.includes('://')) {
      try {
        decodedContent = decodeBase64Utf8(decodedContent);
      } catch {
        this.logManager.addLog('warn', '尝试 Base64 解码失败，可能原本就是明文', 'Subscription');
      }
    }

    // trim 每行（与 parseLocalContent 口径一致）：前导空白的合法链接否则被 startsWith 误判「不支持 scheme」。
    const lines = decodedContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const servers: ServerConfig[] = [];
    const now = new Date().toISOString();

    // 丢弃可见性（issue #263）：逐行 warn 之外聚合两类丢弃计数——①scheme 不受支持的行（原完全静默）
    // ②解析失败的行（原只有散落 warn）——最终 info 一并给出，用户不翻告警也能看出「导入不全」。
    let failedLines = 0;
    const unsupportedSchemes = new Map<string, number>();
    for (const line of lines) {
      if (this.protocolParser.isSupported(line)) {
        try {
          const server = this.protocolParser.parseUrl(line);
          server.subscriptionId = subscriptionId;
          server.createdAt = now;
          server.updatedAt = now;
          servers.push(server);
        } catch (e: any) {
          failedLines++;
          this.logManager.addLog('warn', `解析订阅中的节点失败: ${e.message}`, 'Subscription');
        }
      } else if (line.includes('://')) {
        const scheme = line.split('://')[0].trim().toLowerCase();
        unsupportedSchemes.set(scheme, (unsupportedSchemes.get(scheme) ?? 0) + 1);
      }
    }
    if (unsupportedSchemes.size > 0) {
      const detail = [...unsupportedSchemes.entries()].map(([s, c]) => `${s}(${c})`).join(', ');
      this.logManager.addLog('warn', `跳过不支持的协议链接: ${detail}`, 'Subscription');
    }

    if (servers.length === 0) {
      // URL-list/Base64 分支 0 节点也必须 throw（与 Clash/sing-box 对齐），不返回空集 →
      // 防 reconcile 删光存量节点 + 清 selectedServerId（正常订阅不会 0 节点）。
      const hadUrlLines = lines.some((l) => l.includes('://'));
      if (throwOnEmpty) {
        throw new Error(
          hadUrlLines
            ? '订阅中的节点 URL 均无法解析（协议不支持或格式错误），解析得到 0 个可用节点'
            : '无法识别订阅格式：既非 sing-box JSON，也未发现可解析的节点 URL（可能 Base64 解码失败或格式不受支持）'
        );
      }
      return { servers: [] };
    }
    const skippedTotal = failedLines + [...unsupportedSchemes.values()].reduce((a, b) => a + b, 0);
    this.logManager.addLog(
      'info',
      `成功从订阅解析了 ${servers.length} 个节点${skippedTotal > 0 ? `（另有 ${skippedTotal} 条被跳过/失败，详见上方告警）` : ''}`,
      'Subscription'
    );
    return { servers };
  }

  /**
   * Clash 文档统一收口：解析内联 proxies + 编排 proxy-providers + 合并去重。
   * 合计 0 节点必须 throw（防穿仓：空数组经 reconcile 会删光该订阅节点）。
   * @returns partial=true 当任一 provider 失败（调用方 reconcile 改 merge-only 不删 leftover）。
   */
  private async handleClashDoc(
    doc: ClashDoc,
    subscriptionId: string,
    ctx: {
      allowProviders: boolean;
      throwOnEmpty?: boolean;
    }
  ): Promise<{ servers: ServerConfig[]; partial?: boolean; failedProviders?: string[] }> {
    const now = new Date().toISOString();

    // 内联 proxies
    const inline = parseClashProxies(doc.proxies, subscriptionId, now);
    for (const w of inline.warnings) this.logManager.addLog('warn', w, 'Subscription');

    let providerServers: ServerConfig[] = [];
    let partial = false;
    let failedProviders: string[] = [];

    const providers = doc['proxy-providers'];
    if (providers && typeof providers === 'object') {
      if (!ctx.allowProviders) {
        // 深度硬封顶 2 层：provider 内容再含 proxy-providers → 只取内联 + warn。
        this.logManager.addLog(
          'warn',
          'provider 内容再嵌套 proxy-providers，已忽略（不递归，深度封顶 2 层）',
          'Subscription'
        );
      } else {
        const result = await resolveProxyProviders(providers, {
          fetchText: async (url, signal) => {
            return this.fetchProviderText(url, signal);
          },
          parseContent: async (text) => {
            // provider 响应复用主解析（allowProviders:false → 不递归 providers；触发 handleClashDoc
            // 的「再嵌套 proxy-providers → warn 不递归」活分支）。throwOnEmpty:false → 0 节点返回空集，
            // 交由 resolveProxyProviders 按 permanent 0-node 处理（不消失成功节点、不误判 transient）。
            const r = await this.parseSubscriptionContent(text, subscriptionId, {
              allowProviders: false,
              throwOnEmpty: false,
            });
            return { servers: r.servers, skipped: 0, failed: 0, warnings: [] };
          },
          log: (level, message) => this.logManager.addLog(level, message, 'Subscription'),
          subscriptionId,
          now,
          maxProviders: 8,
          fetchTimeoutMs: 15_000,
        });
        providerServers = result.servers;
        partial = result.anyFailed;
        failedProviders = result.failedProviders;
        for (const w of result.warnings) this.logManager.addLog('warn', w, 'Subscription');
      }
    }

    // 内联在前、provider 在后 → 去重留内联那份。
    const merged = this.dedupeByFingerprint([...inline.servers, ...providerServers]);

    if (merged.length === 0) {
      // 防穿仓：Clash 分支(内联+provider)合计 0 必须 throw，不静默落 Base64。
      // throwOnEmpty=false（provider 复用路径）时返回空集，交由 resolveProxyProviders 按 permanent 0-node 处理。
      if (ctx.throwOnEmpty !== false) {
        throw new Error(
          `Clash 订阅解析得到 0 个可用节点（跳过 ${inline.skipped}、失败 ${inline.failed}）`
        );
      }
      return {
        servers: [],
        partial: partial || undefined,
        failedProviders: failedProviders.length ? failedProviders : undefined,
      };
    }

    this.logManager.addLog(
      'info',
      `Clash 订阅解析完成：内联 ${inline.servers.length} + provider ${providerServers.length} → 去重后 ${merged.length} 个节点${partial ? '（部分 provider 失败，本次将 merge-only 防穿仓）' : ''}`,
      'Subscription'
    );
    return {
      servers: merged,
      partial: partial || undefined,
      failedProviders: failedProviders.length ? failedProviders : undefined,
    };
  }
}
