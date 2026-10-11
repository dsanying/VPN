import type { ServerConfig } from './types';
import { normalizeDuration } from './duration';
export interface SubscriptionParserLogger {
  addLog(level: 'warn', message: string, source: string): void;
}

// ── Sing-box outbound types we support ──────────────────────────────────────
type SingboxTls = {
  enabled?: boolean;
  server_name?: string;
  insecure?: boolean;
  alpn?: string[];
  utls?: { enabled?: boolean; fingerprint?: string };
  reality?: { enabled?: boolean; public_key?: string; short_id?: string };
  ech?: { enabled?: boolean };
  fragment?: boolean;
};
type SingboxTransport = {
  type?: string;
  path?: string;
  host?: string | string[];
  method?: string;
  headers?: Record<string, string | string[]>;
  service_name?: string;
};
type SingboxMultiplex = {
  enabled?: boolean;
  protocol?: string;
  max_connections?: number;
  min_streams?: number;
  padding?: boolean;
};
export type SingboxOutbound = {
  type: string;
  tag: string;
  server?: string;
  server_port?: number;
  server_ports?: string[];
  hop_interval?: string;
  disable_chrome_parrot?: boolean; // hysteria2，sing-box 1.14；漏收会杀 Ed25519 证书节点的连通性
  uuid?: string;
  flow?: string;
  packet_encoding?: string;
  username?: string;
  password?: string;
  method?: string;
  plugin?: string;
  plugin_opts?: string;
  obfs?: { type?: string; password?: string };
  // naive：是否启用 HTTP/3 (QUIC) 传输
  quic?: boolean;
  // vmess
  alter_id?: number;
  security?: string;
  // tuic
  congestion_control?: string;
  udp_relay_mode?: string;
  zero_rtt_handshake?: boolean;
  heartbeat?: string;
  // anytls
  idle_session_check_interval?: string;
  idle_session_timeout?: string;
  min_idle_session?: number;
  // ssh（private_key_path 属本机文件路径，跨设备订阅无意义，不收；其余 sing-box ssh outbound 字段全收）
  user?: string;
  private_key?: string;
  private_key_passphrase?: string;
  host_key?: string[];
  host_key_algorithms?: string[];
  client_version?: string;
  cipher?: string[];
  mac?: string[];
  kex_algorithm?: string[];
  // snell（sing-box 1.14.0-alpha.38+；version 与 ShadowTLS 共用字段名）
  version?: number;
  psk?: string;
  userkey?: string;
  reuse?: boolean;
  obfs_mode?: string;
  obfs_host?: string;
  mode?: string;
  network?: string;
  tls?: SingboxTls;
  transport?: SingboxTransport;
  multiplex?: SingboxMultiplex;
};

/** parseSingboxOutbounds 能直接映射的 sing-box outbound type（其余在本地导入时透传为 custom 或跳过）。 */
export const SINGBOX_SUPPORTED_TYPES = new Set([
  'shadowsocks',
  'vless',
  'trojan',
  'hysteria2',
  'naive',
  'vmess',
  'tuic',
  'anytls',
  'snell',
  'socks',
  'http',
  'ssh',
]);

/** sing-box transport.type → ServerConfig.network 可承载的传输（其余 sing-box 不支持/FlowZ 无落点，整节点跳过）。 */
const SINGBOX_SUPPORTED_TRANSPORTS = new Set(['ws', 'grpc', 'http', 'httpupgrade']);
/** sing-box 非代理内部 outbound type（本地导入忽略，不作节点、不透传 custom）。 */
export const SINGBOX_INTERNAL_TYPES = new Set(['direct', 'block', 'dns', 'selector', 'urltest']);

export function parseSingboxOutbounds(
  outbounds: SingboxOutbound[],
  subscriptionId: string,
  logManager: SubscriptionParserLogger
): ServerConfig[] {
  const SUPPORTED = SINGBOX_SUPPORTED_TYPES;
  const servers: ServerConfig[] = [];
  const now = new Date().toISOString();

  // 丢弃可见性（issue #263 调查项）：原三类 silent continue（不支持 type / 缺 server·port / 不支持 transport）
  // 完全无日志——「8 进 4 出」用户无从察觉。聚合计数，函数尾统一 warn。
  const skipByType = new Map<string, number>();
  let missingFields = 0;
  const skipByTransport = new Map<string, number>();

  for (const ob of outbounds) {
    if (!SUPPORTED.has(ob.type)) {
      // direct/block/selector 等内部 outbound 是配置结构而非节点，不计入「丢弃」噪声。
      if (!SINGBOX_INTERNAL_TYPES.has(ob.type)) {
        skipByType.set(ob.type, (skipByType.get(ob.type) ?? 0) + 1);
      }
      continue;
    }
    // 支持仅含 server_ports（端口跳跃、无 server_port）的 Hy2 节点：从首个范围的低位端口推导 port
    const effectivePort =
      ob.server_port ??
      (ob.server_ports?.[0] ? parseInt(ob.server_ports[0].split(':')[0], 10) : undefined);
    if (!ob.server || !effectivePort) {
      missingFields++;
      continue;
    }
    // 不支持的 transport（quic 等）：入库会静默降级裸 TCP 产假节点，整节点跳过（与分享链/Clash 路径统一口径）。
    if (ob.transport?.type && !SINGBOX_SUPPORTED_TRANSPORTS.has(ob.transport.type)) {
      skipByTransport.set(ob.transport.type, (skipByTransport.get(ob.transport.type) ?? 0) + 1);
      continue;
    }

    try {
      const base: Partial<ServerConfig> = {
        id: crypto.randomUUID(),
        name: ob.tag || `${ob.server}:${effectivePort}`,
        address: ob.server,
        port: effectivePort,
        subscriptionId,
        createdAt: now,
        updatedAt: now,
      };

      // vless/vmess UDP 封装：JSON 订阅显式携带时透传（缺省时不写，由 ProxyManager 默认 xudp）
      if (ob.packet_encoding !== undefined) {
        base.packetEncoding = ob.packet_encoding;
      }

      // TLS / Reality
      if (ob.tls && ob.tls.enabled !== false) {
        const hasReality = ob.tls.reality?.enabled && ob.tls.reality.public_key;
        base.security = hasReality ? 'reality' : 'tls';
        base.tlsSettings = {
          serverName: ob.tls.server_name,
          allowInsecure: ob.tls.insecure ?? false,
          alpn: ob.tls.alpn,
          fingerprint: ob.tls.utls?.fingerprint,
          ech: ob.tls.ech?.enabled === true ? true : undefined,
          fragment: ob.tls.fragment === true ? true : undefined,
        };
        if (hasReality && ob.tls.reality) {
          base.realitySettings = {
            publicKey: ob.tls.reality.public_key!,
            shortId: ob.tls.reality.short_id,
          };
        }
      }

      // Transport
      if (ob.transport?.type) {
        const t = ob.transport;
        const netType = t.type as 'ws' | 'grpc' | 'http' | 'httpupgrade';
        base.network = netType;
        if (netType === 'ws') {
          // 与 httpupgrade 对齐：transport.host 折叠进 Host header（部分配置把 ws Host 放在 t.host），
          // 避免同一节点经 JSON 订阅 vs 分享链解析出不一致的 wsSettings（丢 Host）。
          base.wsSettings = {
            path: t.path,
            headers: {
              ...Object.fromEntries(
                Object.entries(t.headers ?? {}).map(([key, value]) => [
                  key,
                  Array.isArray(value) ? value.join(', ') : value,
                ])
              ),
              ...(typeof t.host === 'string' ? { Host: t.host } : {}),
            },
          };
        } else if (netType === 'grpc') {
          base.grpcSettings = { serviceName: t.service_name };
        } else if (netType === 'http') {
          base.httpSettings = {
            path: t.path,
            host: typeof t.host === 'string' ? [t.host] : t.host,
            method: t.method,
            headers: t.headers
              ? Object.fromEntries(
                  Object.entries(t.headers).map(([key, value]) => [
                    key,
                    Array.isArray(value) ? value : [value],
                  ])
                )
              : undefined,
          };
        } else if (netType === 'httpupgrade') {
          // httpupgrade 复用 ws 设置承载 path/Host
          base.wsSettings = {
            path: t.path,
            headers: {
              ...Object.fromEntries(
                Object.entries(t.headers ?? {}).map(([key, value]) => [
                  key,
                  Array.isArray(value) ? value.join(', ') : value,
                ])
              ),
              ...(typeof t.host === 'string' ? { Host: t.host } : {}),
            },
          };
        }
      }

      // Multiplex（vless/trojan/vmess/ss）
      if (ob.multiplex?.enabled) {
        base.multiplexSettings = {
          enabled: true,
          protocol: (ob.multiplex.protocol as 'smux' | 'yamux' | 'h2mux') || 'h2mux',
          maxConnections: ob.multiplex.max_connections,
          minStreams: ob.multiplex.min_streams,
          padding: ob.multiplex.padding,
        };
      }

      // Protocol-specific
      if (ob.type === 'shadowsocks') {
        servers.push({
          ...(base as ServerConfig),
          protocol: 'shadowsocks',
          shadowsocksSettings: {
            method: ob.method ?? 'aes-256-gcm',
            password: ob.password ?? '',
            plugin: ob.plugin,
            pluginOptions: ob.plugin_opts,
          },
        });
      } else if (ob.type === 'vless') {
        servers.push({
          ...(base as ServerConfig),
          protocol: 'vless',
          uuid: ob.uuid ?? '',
          flow: ob.flow,
        });
      } else if (ob.type === 'trojan') {
        servers.push({
          ...(base as ServerConfig),
          protocol: 'trojan',
          password: ob.password ?? '',
        });
      } else if (ob.type === 'hysteria2') {
        const hy2: ServerConfig = {
          ...(base as ServerConfig),
          protocol: 'hysteria2',
          password: ob.password ?? '',
          security: 'tls',
        };
        const hy2Settings: NonNullable<ServerConfig['hysteria2Settings']> = {};
        if (ob.obfs?.type === 'salamander' && ob.obfs.password) {
          hy2Settings.obfs = { type: 'salamander', password: ob.obfs.password };
        }
        // 端口跳跃：server_ports 形如 ["20000:30000"]，存为逗号分隔字符串
        if (ob.server_ports && ob.server_ports.length > 0) {
          hy2Settings.serverPorts = ob.server_ports.join(',');
          if (ob.hop_interval) hy2Settings.hopInterval = ob.hop_interval;
        }
        // Chrome QUIC 指纹拟态开关（sing-box 1.14）。**本格式必须收**，与 Clash 订阅不同：Clash 无对应
        // 字段故不解析，而这里解析的就是 sing-box 原生 outbound，该键真实存在。
        // 漏收的后果不是「少个优化」而是**连不上**：服务端证书为 Ed25519 时，机场只能靠下发
        // disable_chrome_parrot:true 让客户端能握手；剥掉它 → 拟态开启 → 握手直接失败。且用户手动
        // 打开开关自救后，下次订阅刷新按「以订阅值为准」对账会再次抹掉 → 死循环。
        if (ob.disable_chrome_parrot === true) {
          hy2Settings.disableChromeParrot = true;
        }
        if (Object.keys(hy2Settings).length > 0) {
          hy2.hysteria2Settings = hy2Settings;
        }
        servers.push(hy2);
      } else if (ob.type === 'naive') {
        // sing-box naive 的 quic:true 表示走 HTTP/3 (QUIC) 传输（h3 节点）
        servers.push({
          ...(base as ServerConfig),
          protocol: 'naive',
          username: ob.username ?? '',
          password: ob.password ?? '',
          naiveSettings: ob.quic ? { useHttp3: true } : undefined,
        });
      } else if (ob.type === 'vmess') {
        servers.push({
          ...(base as ServerConfig),
          protocol: 'vmess',
          uuid: ob.uuid ?? '',
          alterId: ob.alter_id,
          vmessSecurity: ob.security,
        });
      } else if (ob.type === 'tuic') {
        const tuic: ServerConfig = {
          ...(base as ServerConfig),
          protocol: 'tuic',
          uuid: ob.uuid ?? '',
          password: ob.password ?? '',
        };
        const ts: NonNullable<ServerConfig['tuicSettings']> = {};
        if (ob.congestion_control)
          ts.congestionControl = ob.congestion_control as NonNullable<
            ServerConfig['tuicSettings']
          >['congestionControl'];
        if (ob.udp_relay_mode)
          ts.udpRelayMode = ob.udp_relay_mode as NonNullable<
            ServerConfig['tuicSettings']
          >['udpRelayMode'];
        if (ob.zero_rtt_handshake !== undefined) ts.zeroRttHandshake = ob.zero_rtt_handshake;
        // heartbeat 规整：纯数字(毫秒)补 ms，否则透传 → 防 sing-box ParseDuration "missing unit"。
        const hb = normalizeDuration(ob.heartbeat);
        if (hb) ts.heartbeat = hb;
        if (Object.keys(ts).length > 0) tuic.tuicSettings = ts;
        servers.push(tuic);
      } else if (ob.type === 'anytls') {
        const anytls: ServerConfig = {
          ...(base as ServerConfig),
          protocol: 'anytls',
          password: ob.password ?? '',
        };
        const as: NonNullable<ServerConfig['anyTlsSettings']> = {};
        if (ob.idle_session_check_interval)
          as.idleSessionCheckInterval = ob.idle_session_check_interval;
        if (ob.idle_session_timeout) as.idleSessionTimeout = ob.idle_session_timeout;
        if (ob.min_idle_session !== undefined) as.minIdleSession = ob.min_idle_session;
        if (Object.keys(as).length > 0) anytls.anyTlsSettings = as;
        servers.push(anytls);
      } else if (ob.type === 'socks') {
        servers.push({
          ...(base as ServerConfig),
          protocol: 'socks',
          username: ob.username,
          password: ob.password,
        });
      } else if (ob.type === 'http') {
        servers.push({
          ...(base as ServerConfig),
          protocol: 'http',
          username: ob.username,
          password: ob.password,
        });
      } else if (ob.type === 'ssh') {
        // ssh：与 Clash 路径（ClashSubscriptionParser mapNode ssh 分支）对齐的落点；
        // private_key_path 是本机文件路径、跨设备订阅无意义，刻意不映射。
        const ssh: NonNullable<ServerConfig['sshSettings']> = {};
        if (ob.user) ssh.user = ob.user;
        if (ob.password) ssh.password = ob.password;
        if (ob.private_key) ssh.privateKey = ob.private_key;
        if (ob.private_key_passphrase) ssh.privateKeyPassphrase = ob.private_key_passphrase;
        if (ob.host_key && ob.host_key.length > 0) ssh.hostKey = ob.host_key;
        if (ob.host_key_algorithms && ob.host_key_algorithms.length > 0)
          ssh.hostKeyAlgorithms = ob.host_key_algorithms;
        if (ob.client_version) ssh.clientVersion = ob.client_version;
        // 算法协商覆盖（对接老/特定 SSH 服务端）：丢弃会静默退回默认算法集、连不上且无从排查。
        if (ob.cipher && ob.cipher.length > 0) ssh.cipher = ob.cipher;
        if (ob.mac && ob.mac.length > 0) ssh.mac = ob.mac;
        if (ob.kex_algorithm && ob.kex_algorithm.length > 0) ssh.kexAlgorithm = ob.kex_algorithm;
        servers.push({
          ...(base as ServerConfig),
          protocol: 'ssh',
          network: 'tcp',
          security: 'none',
          sshSettings: Object.keys(ssh).length > 0 ? ssh : undefined,
        });
      } else if (ob.type === 'snell') {
        // sing-box 官方 snell（1.14.0-alpha.38+）：version 仅 4/6；psk 复用 password 落点。
        // 超出能力（旧版本号/缺 psk）warn 跳过——validateConfig 对 snell 必填强校验，坏节点入库会连累整份订阅保存失败。
        if (ob.version !== 4 && ob.version !== 6) {
          logManager.addLog(
            'warn',
            `跳过 snell outbound "${ob.tag}"：版本 ${ob.version ?? '(缺失)'} 不受支持（sing-box 仅支持 4/6）`,
            'Subscription'
          );
          continue;
        }
        if (!ob.psk?.trim()) {
          // trim 语义与 protocolRequirementError 的 password?.trim() 对齐：空白 psk 穿闸入库会连累整份订阅保存。
          logManager.addLog('warn', `跳过 snell outbound "${ob.tag}"：缺 psk`, 'Subscription');
          continue;
        }
        const snell: NonNullable<ServerConfig['snellSettings']> = { version: ob.version };
        // obfs 仅 v4（SnellSettings 不变量）：v6 携带 obfs_mode 的脏 JSON 不落库，与 URL/Clash 路口径一致。
        if (ob.version === 4 && ob.obfs_mode === 'http') {
          snell.obfsMode = 'http';
          if (ob.obfs_host) snell.obfsHost = ob.obfs_host;
        }
        if (ob.version === 6 && (ob.mode === 'unshaped' || ob.mode === 'unsafe-raw')) {
          snell.mode = ob.mode;
        }
        if (ob.reuse) snell.reuse = true;
        if (ob.network === 'tcp' || ob.network === 'udp') snell.network = ob.network;
        if (ob.userkey) snell.userkey = ob.userkey;
        servers.push({
          ...(base as ServerConfig),
          protocol: 'snell',
          password: ob.psk,
          snellSettings: snell,
        });
      }
    } catch (e: any) {
      logManager.addLog(
        'warn',
        `解析 sing-box outbound "${ob.tag}" 失败: ${e.message}`,
        'Subscription'
      );
    }
  }
  if (skipByType.size > 0) {
    const detail = [...skipByType.entries()].map(([t, c]) => `${t}(${c})`).join(', ');
    logManager.addLog('warn', `跳过不支持的 outbound 类型: ${detail}`, 'Subscription');
  }
  if (skipByTransport.size > 0) {
    const detail = [...skipByTransport.entries()].map(([t, c]) => `${t}(${c})`).join(', ');
    logManager.addLog('warn', `跳过不支持的传输层类型: ${detail}`, 'Subscription');
  }
  if (missingFields > 0) {
    logManager.addLog('warn', `跳过 ${missingFields} 个缺 server/port 的 outbound`, 'Subscription');
  }
  return servers;
}
