import type { ImportParseResult, ImportFormat, ServerConfig } from './types';
import { ProtocolParser, type IProtocolParser } from './protocol-parser';
import { decodeBase64Utf8 } from './portable-codec';
import {
  CLASH_PROBE_RE,
  tryLoadClashDoc,
  parseClashProxies,
  type ClashDoc,
} from './clash-subscription-parser';
import { parseXrayOutbounds } from './xray-import';
import { isServerComplete } from './server-completeness';
import {
  parseSingboxOutbounds,
  SINGBOX_SUPPORTED_TYPES,
  SINGBOX_INTERNAL_TYPES,
  type SingboxOutbound,
  type SubscriptionParserLogger,
} from './singbox-subscription-parser';

const randomUUID = () => globalThis.crypto.randomUUID();

/** Local import is the same parser on desktop and mobile. It never fetches providers. */
export class PortableImportParser {
  private static readonly MAX_BODY_BYTES = 10 * 1024 * 1024;
  constructor(
    private readonly protocolParser: IProtocolParser = new ProtocolParser(),
    private readonly logger: SubscriptionParserLogger = { addLog: () => undefined }
  ) {}
  async parseLocalContent(text: string): Promise<ImportParseResult> {
    const trimmed = (text || '').trim();
    // 体积闸（与网络订阅 MAX_BODY_BYTES 同口径）：防超大文件 / YAML 锚点炸弹经 IPC 进主进程 OOM。
    if (new TextEncoder().encode(trimmed).byteLength > PortableImportParser.MAX_BODY_BYTES) {
      throw new Error('导入内容过大');
    }
    const now = new Date().toISOString();
    const candidates: ServerConfig[] = [];
    const subscriptions: { name: string; url: string }[] = [];
    const warnings: string[] = [];
    let customWrapped = 0;
    let skipped = 0;
    let failed = 0;
    let format: ImportFormat = 'unknown';

    if (trimmed) {
      // 1. JSON：sing-box（outbounds[].type）/ Xray（outbounds[].protocol）/ JSON 编码 Clash
      let json: unknown;
      let isJson = false;
      try {
        json = JSON.parse(trimmed);
        isJson = true;
      } catch {
        /* 非 JSON，fall through */
      }
      if (isJson && json && typeof json === 'object') {
        const obj = json as Record<string, unknown>;
        if (typeof obj.protocol === 'string') {
          format = 'native';
          candidates.push({
            ...obj,
            id: randomUUID(),
            subscriptionId: undefined,
            providerName: undefined,
            createdAt: now,
            updatedAt: now,
          } as unknown as ServerConfig);
        } else if (Array.isArray(obj.outbounds)) {
          const obs = obj.outbounds as Array<Record<string, unknown>>;
          const looksXray = obs.some(
            (o) =>
              o && typeof o === 'object' && typeof o.protocol === 'string' && o.type === undefined
          );
          if (looksXray) {
            format = 'xray';
            const r = parseXrayOutbounds(obs, now);
            candidates.push(...r.servers);
            skipped += r.skipped;
            failed += r.failed;
            warnings.push(...r.warnings);
          } else {
            format = 'singbox';
            const mapped = parseSingboxOutbounds(
              obs as unknown as SingboxOutbound[],
              '',
              this.logger
            );
            for (const s of mapped) {
              s.subscriptionId = undefined;
              s.providerName = undefined;
              s.createdAt = now;
              s.updatedAt = now;
              candidates.push(s);
            }
            // 未映射但合法的 type → 透传 custom（内部 type 如 direct/selector 忽略）
            for (const ob of obs) {
              if (!ob || typeof ob !== 'object') continue;
              const t = ob.type;
              if (typeof t !== 'string' || !t.trim()) continue;
              if (SINGBOX_SUPPORTED_TYPES.has(t) || SINGBOX_INTERNAL_TYPES.has(t)) continue;
              candidates.push(this.makeCustomNode(ob, now));
              customWrapped++;
            }
            // 受支持 type 但缺 server/port 被 parseSingboxOutbounds 丢弃的节点计入 failed（统计准确，对齐 xray/clash 分支）。
            const supportedInputs = obs.filter(
              (o) =>
                o &&
                typeof o === 'object' &&
                typeof o.type === 'string' &&
                SINGBOX_SUPPORTED_TYPES.has(o.type)
            ).length;
            failed += Math.max(0, supportedInputs - mapped.length);
          }
        } else if (
          Array.isArray(obj.proxies) ||
          (obj['proxy-providers'] && typeof obj['proxy-providers'] === 'object')
        ) {
          format = 'clash';
          const c = this.collectClashLocal(obj as ClashDoc, now);
          candidates.push(...c.nodes);
          subscriptions.push(...c.subscriptions);
          skipped += c.skipped;
          failed += c.failed;
          warnings.push(...c.warnings);
        }
      }

      // 2. Clash YAML
      if (format === 'unknown' && CLASH_PROBE_RE.test(trimmed)) {
        format = 'clash';
        const doc = tryLoadClashDoc(trimmed); // 解析失败上抛 = 门控
        const c = this.collectClashLocal(doc, now);
        candidates.push(...c.nodes);
        subscriptions.push(...c.subscriptions);
        skipped += c.skipped;
        failed += c.failed;
        warnings.push(...c.warnings);
      }

      // 3/4. 分享链接 / Base64
      if (format === 'unknown') {
        // Base64 解码（Node 对非字母表字符宽松忽略、不抛；非 base64 文本解出乱码后下方 includes('://') 自然不命中）。
        let decoded = trimmed;
        if (!decoded.includes('://')) {
          decoded = decodeBase64Utf8(decoded);
        }
        if (decoded.includes('://')) {
          format = 'links';
          const lines = decoded
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          for (const line of lines) {
            if (!this.protocolParser.isSupported(line)) {
              skipped++;
              continue;
            }
            try {
              const s = this.protocolParser.parseUrl(line);
              s.subscriptionId = undefined;
              s.providerName = undefined;
              s.createdAt = now;
              s.updatedAt = now;
              candidates.push(s);
            } catch {
              failed++;
            }
          }
        }
      }
    }

    if (format === 'unknown') {
      throw new Error('无法识别文件格式');
    }

    // 最终 gate：仅保留 saveConfig.validateConfig 不会 throw 的节点（与渲染侧 isServerComplete 同口径）。
    // 透传 custom 必含合法 type → 必过 gate；故 unsupported = customWrapped。
    const nodes: ServerConfig[] = [];
    for (const n of candidates) {
      // 与 ConfigManager.validateConfig 对齐：isServerComplete 缺端口上界、不校验 name，这里补齐——
      // 否则 port>65535 / 空 name 的节点会过 gate 却让 SERVER_ADD_BULK 的 saveConfig throw → 整批失败。
      const p = (n.protocol || '').toLowerCase();
      const portOk =
        p === 'custom' ||
        p === 'tailscale' ||
        (typeof n.port === 'number' && n.port >= 1 && n.port <= 65535);
      const nameOk = !!n.name && n.name.trim().length > 0;
      if (isServerComplete(n) && portOk && nameOk) nodes.push(n);
      else failed++;
    }

    return {
      nodes,
      subscriptions,
      stats: { imported: nodes.length, unsupported: customWrapped, skipped, failed },
      warnings,
      format,
    };
  }

  /** Clash 文档（本地，不拉取）：proxies → 自建节点；proxy-providers(type:http) → {name,url} 订阅。 */
  private collectClashLocal(
    doc: ClashDoc,
    now: string
  ): {
    nodes: ServerConfig[];
    subscriptions: { name: string; url: string }[];
    skipped: number;
    failed: number;
    warnings: string[];
  } {
    const r = parseClashProxies(doc.proxies, '', now);
    const nodes = r.servers.map((s) => {
      s.subscriptionId = undefined;
      s.providerName = undefined;
      return s;
    });
    const subscriptions: { name: string; url: string }[] = [];
    const providers = doc['proxy-providers'];
    if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
      for (const [name, v] of Object.entries(providers as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue;
        const pv = v as Record<string, unknown>;
        const type = typeof pv.type === 'string' ? pv.type.toLowerCase() : '';
        const url = typeof pv.url === 'string' ? pv.url.trim() : '';
        // type 缺省按 http 处理（机场常省略）；type:file 等本地源忽略；url 必须 http(s)（拒 file:// 等伪源）。
        if ((type === 'http' || type === '') && /^https?:\/\//i.test(url)) {
          subscriptions.push({ name, url });
        }
      }
    }
    return { nodes, subscriptions, skipped: r.skipped, failed: r.failed, warnings: r.warnings };
  }

  /** 不支持的 sing-box outbound → custom 透传节点（原始 outbound 进 customSettings.outbound）。 */
  private makeCustomNode(ob: Record<string, unknown>, now: string): ServerConfig {
    const type = String(ob.type ?? '');
    const tag = typeof ob.tag === 'string' && ob.tag.trim() ? ob.tag.trim() : type || 'custom';
    return {
      id: randomUUID(),
      name: tag,
      protocol: 'custom',
      address: typeof ob.server === 'string' ? ob.server : '',
      port: typeof ob.server_port === 'number' ? ob.server_port : 0,
      customSettings: { outbound: ob },
      createdAt: now,
      updatedAt: now,
    };
  }
}
