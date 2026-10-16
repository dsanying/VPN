import { compatibilityEngine, type CoreBridge } from './core-capabilities';
import { buildBridgeOutbound } from './compatibility-config';
import type { ServerConfig } from './types';
import type { SingBoxOutbound, SingBoxDomainResolver } from './singbox-config-types';
import { parseWsEarlyData } from './ws-early-data';
import { normalizeDuration } from './duration';
import { validateTlsSpoof } from './tls-spoof';
import { isIpLiteral } from './dns';

/** Explicit host facts: no Node, filesystem, process, or desktop resource lookup in this generator. */
export interface OutboundHost {
  platform: NodeJS.Platform | 'android';
  arch: string;
}
function isQuicManagedTls(protocol: string): boolean {
  return ['hysteria2', 'tuic'].includes(protocol.toLowerCase());
}
export function shouldEmitTlsEngine(
  engine: string | undefined,
  platform: OutboundHost['platform']
): boolean {
  return (
    (engine === 'windows' && platform === 'win32') || (engine === 'apple' && platform === 'darwin')
  );
}
export function buildProxyOutbound(
  server: ServerConfig,
  idToTagMap: Map<string, string>,
  // #57：节点域名 dial 解析器，由调用方传 getNodeDialDomainResolver(config)。形态由调用方决定、本函数纯透传：
  // 字符串 = 仅指定 tag；结构化 = 附带 strategy 覆盖顶层 dns.strategy（关 IPv6 时解锁 AAAA-only 域名节点）。
  //
  // **必填、刻意无默认值**：曾默认 'dns-bootstrap'（字符串形态＝未修复形态）。实测该默认值是静默后门——把
  // buildOutbounds 里的第三参删掉后，全量 3451 测试零红：tsc/单测/snapshot/sing-box check 四层全哑，因为漏传
  // 与「显式选择字符串形态」在类型上不可区分。改必填后，任何新增 call site 漏传 = 编译错误，被迫显式表态。
  nodeResolverTag: SingBoxDomainResolver,
  bridges: Map<string, CoreBridge> | undefined,
  host: OutboundHost
): SingBoxOutbound {
  if (compatibilityEngine(server)) {
    const bridge = bridges?.get(server.id);
    if (!bridge) throw new Error('Compatibility core is not ready');
    return buildBridgeOutbound(
      idToTagMap.get(server.id) || `proxy-${server.id}`,
      bridge
    ) as unknown as SingBoxOutbound;
  }
  // sing-box 要求协议类型必须是小写
  const protocol = server.protocol.toLowerCase();
  const tlsProtocols = ['trojan', 'anytls', 'hysteria2', 'tuic'];

  // 自定义协议（raw-JSON 透传）：原样下发用户的 outbound 对象，仅【强制覆盖 tag】（防撞/防注入），
  // 语义与能否启用由 sing-box check（启动 gate / 表单 probe）判定，暗影VPN 不解析 type。
  if (protocol === 'custom') {
    // 强制覆盖 tag、剥离 detour：内层 detour 会绕过 暗影VPN 的代理链环检测（仅走 server.detour）且 sing-box check
    // 测不出 detour 环 → 运行时拨号死循环。暗影VPN 经 detour 字段统一管理链路，自定义透传不携带内层 detour。
    const { detour: _drop, ...userOutbound } = (server.customSettings?.outbound || {}) as Record<
      string,
      unknown
    >;
    return {
      ...userOutbound,
      tag: idToTagMap.get(server.id) || `proxy-${server.id}`,
    } as unknown as SingBoxOutbound;
  }

  const outbound: SingBoxOutbound = {
    type: protocol,
    tag: idToTagMap.get(server.id) || `proxy-${server.id}`,
    // issue #147：server 恒用原域名——交内核 resolveDialer 运行时解析多 A → DialSerial 逐个 IP 重试（取代旧
    // resolve-ahead 烧单 IP，那会令 destination.IsDomain()=false、关闭内核多 IP 容错，见设计 §1.1）。
    // 多上游 race / 抗单点由 domain_resolver 指向的本地 race server 承担（getNodeDialDomainResolver）。
    server: server.address,
    server_port: server.port,
    // 代理节点域名经引导解析（缺省档 dns-bootstrap=AliDNS IP-DoH，由调用方的 getNodeDialDomainResolver 定档，
    // 本参数无默认值），免疫 UDP 53 限速/劫持，
    // 避免节点解析失败导致全断流；同时防止 dns-local 死循环导致的连接挂起。
    // #57：节点域名解析器档位可改为 dns-node(DNSPod)/dns-local(系统 DNS)，dial 与 rule1 同档（统一 tag）。
    domain_resolver: nodeResolverTag,
  };

  // vless/vmess UDP 封装：默认 xudp；可经 server.packetEncoding 覆盖（兼容拒收 xudp 的旧核心/服务端，
  // 否则 UDP 断流且无从调整）。显式设为空串则省略该字段（不下发 packet_encoding，由核心用其默认）。
  const packetEncoding = server.packetEncoding ?? 'xudp';

  if (protocol === 'vless') {
    outbound.uuid = server.uuid;
    if (server.flow) {
      outbound.flow = server.flow;
    }
    if (packetEncoding) {
      outbound.packet_encoding = packetEncoding;
    }
  }

  if (protocol === 'vmess') {
    outbound.uuid = server.uuid;
    outbound.security = server.vmessSecurity || 'auto';
    outbound.alter_id = server.alterId || 0;
    if (packetEncoding) {
      outbound.packet_encoding = packetEncoding;
    }
  }

  if (protocol === 'trojan') {
    outbound.password = server.password;
  }

  if (protocol === 'hysteria2') {
    outbound.password = server.password;

    // 带宽限制
    if (server.hysteria2Settings?.upMbps) {
      outbound.up_mbps = server.hysteria2Settings.upMbps;
    }
    if (server.hysteria2Settings?.downMbps) {
      outbound.down_mbps = server.hysteria2Settings.downMbps;
    }

    // 混淆配置（salamander / gecko）。gecko 额外支持随机填充包长 min/max_packet_size（仅 gecko 有意义，
    // salamander 忽略 → 仅 gecko 时下发，避免无效字段）。两类型均需 password（sing-box check：缺则 "missing obfs password"）。
    const obfs = server.hysteria2Settings?.obfs;
    if (obfs?.type && obfs?.password) {
      outbound.obfs = {
        type: obfs.type,
        password: obfs.password,
      };
      if (obfs.type === 'gecko') {
        if (typeof obfs.minPacketSize === 'number' && obfs.minPacketSize > 0) {
          outbound.obfs.min_packet_size = obfs.minPacketSize;
        }
        if (typeof obfs.maxPacketSize === 'number' && obfs.maxPacketSize > 0) {
          outbound.obfs.max_packet_size = obfs.maxPacketSize;
        }
      }
    }

    // BBR 拥塞控制 profile（standard / aggressive / conservative）。空 = 核心默认拥塞控制。
    if (server.hysteria2Settings?.bbrProfile) {
      outbound.bbr_profile = server.hysteria2Settings.bbrProfile;
    }

    // 关闭 Chrome QUIC 指纹拟态（sing-box 1.14 disable_chrome_parrot，默认 false=拟态开启）。
    // **仅在用户显式开启时下发 true**，缺省/false 一律省略——省略即上游默认，抗指纹能力白拿，
    // 且未来上游若改默认或改语义，暗影VPN 不会因为写死了一个 false 而把自己钉在旧行为上。
    // 存在的唯一理由是逃生门：拟态照搬 Chrome 的 QUIC 参数，而 Chrome 不声明支持 Ed25519 →
    // 服务端用 Ed25519 证书的 hy2 节点会直接握手失败（上游 release note 明列）。那种场景下用户
    // 除了关掉拟态没有别的自救手段，症状还是「连不上」这种最难自查的形态。
    if (server.hysteria2Settings?.disableChromeParrot === true) {
      outbound.disable_chrome_parrot = true;
    }

    // 网络类型 (tcp/udp)
    if (server.hysteria2Settings?.network) {
      outbound.network = server.hysteria2Settings.network;
    }
  }

  // Snell 特定配置（sing-box 1.14.0-alpha.38+ 官方 outbound；不走 TLS 块——不在 tlsProtocols，勿加 tls/alpn）。
  // version 是主开关：obfs_*（仅 v4）与 mode（仅 v6）互斥，按 version 条件下发；默认值（obfs none/mode default）
  // 不下发，保持配置精简且与核默认一致。
  if (protocol === 'snell') {
    const s = server.snellSettings;
    outbound.version = s?.version; // 4|6（completeness 闸门已保证存在）
    outbound.psk = server.password; // psk 复用 password 字段（同 trojan/hysteria2 惯例）
    if (s?.userkey) {
      outbound.userkey = s.userkey;
    }
    if (s?.reuse) {
      outbound.reuse = true;
    }
    if (s?.network) {
      outbound.network = s.network; // 省略 = both
    }
    if (s?.version === 4) {
      if (s.obfsMode && s.obfsMode !== 'none') {
        outbound.obfs_mode = s.obfsMode;
        outbound.obfs_host = s.obfsHost || 'bing.com';
      }
    } else if (s?.version === 6) {
      if (s.mode && s.mode !== 'default') {
        outbound.mode = s.mode;
      }
    }
  }

  if (protocol === 'anytls') {
    outbound.password = server.password;
    // AnyTLS 的 TLS 永远开启，这里不需要额外处理，类型检查结尾部分统一生成
    // AnyTLS 会话参数。时长字段统一经 normalizeDuration 收敛：表单可能录入裸毫秒整数（如 "5000"），
    // 原样下发会触发 sing-box ParseDuration "missing unit" → 整代理 FATAL。已带单位值幂等透传，空值不下发。
    const checkInterval = normalizeDuration(server.anyTlsSettings?.idleSessionCheckInterval);
    if (checkInterval) {
      outbound.idle_session_check_interval = checkInterval;
    }
    const idleTimeout = normalizeDuration(server.anyTlsSettings?.idleSessionTimeout);
    if (idleTimeout) {
      outbound.idle_session_timeout = idleTimeout;
    }
    if (server.anyTlsSettings?.minIdleSession !== undefined) {
      outbound.min_idle_session = server.anyTlsSettings.minIdleSession;
    }
  }

  if (protocol === 'shadowsocks') {
    if (!server.shadowsocksSettings) {
      throw new Error(`Shadowsocks server ${server.name} missing settings`);
    }
    outbound.method = server.shadowsocksSettings.method;
    outbound.password = server.shadowsocksSettings.password;
    if (server.shadowsocksSettings.plugin) {
      outbound.plugin = server.shadowsocksSettings.plugin;
      outbound.plugin_opts = server.shadowsocksSettings.pluginOptions;
    }
  }

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
      // heartbeat 经 normalizeDuration 收敛：表单录入裸毫秒整数会致 sing-box ParseDuration FATAL；带单位幂等。
      const heartbeat = normalizeDuration(server.tuicSettings.heartbeat);
      if (heartbeat) {
        outbound.heartbeat = heartbeat;
      }
    }
  }

  if (protocol === 'naive') {
    outbound.username = server.username;
    outbound.password = server.password;

    // NaiveProxy specific configuration
    // sing-box 的 naive outbound 由 Cronet 自管 TLS，仅支持 server_name / certificate /
    // certificate_path / ech。下发 alpn 或 insecure:true 会让 sing-box 拒启：
    //   FATAL: initialize outbound: alpn is not supported on naive outbound
    //   FATAL: initialize outbound: insecure is not supported on naive outbound
    // 故这里只下发 server_name（用户在节点上设置的 alpn / allowInsecure 对 naive 无效，忽略）。
    // 参考：https://sing-box.sagernet.org/configuration/outbound/naive/ （TLS 字段限制）
    //       SagerNet/sing-box protocol/naive/outbound.go (v1.13.x) ~L47 的 ALPN/insecure 校验
    outbound.tls = {
      enabled: true,
      server_name: server.tlsSettings?.serverName || server.address,
    };

    // HTTP/3：naive 经 quic:true 走 h3(QUIC/UDP) 拨号传输，对应服务端 `--listen=quic://`。
    // 注意这只改变"拨号传输"：naive 仍只过 TCP（HTTP CONNECT）、不能中继客户端 UDP（除非
    // udp_over_tcp，暗影VPN 不下发）。客户端 QUIC 若走到 naive，由 blockQuic（udp443 reject 逼回退 TCP）
    // 或 sing-box 出站层（"UDP is not supported by outbound"）处理；该拨号本身受 fwmark 保护、
    // 绕过 route 规则，不被 reject 误杀（已实测）。
    if (server.naiveSettings?.useHttp3) {
      outbound.quic = true;
    }
  }

  if (protocol === 'socks') {
    if (server.username) outbound.username = server.username;
    if (server.password) outbound.password = server.password;
    // 默认 SOCKS 版本
    (outbound as any).version = '5';
  }

  if (protocol === 'http') {
    if (server.username) outbound.username = server.username;
    if (server.password) outbound.password = server.password;

    // HTTP outbound headers mapping can be added if needed via server.httpSettings.headers
    if (server.httpSettings?.headers) {
      if (!outbound.transport) outbound.transport = { type: 'http' };
      outbound.transport.headers = server.httpSettings.headers;
    }
    if (server.httpSettings?.path) {
      if (!outbound.transport) outbound.transport = { type: 'http' };
      outbound.transport.path = server.httpSettings.path;
    }
  }

  if (protocol === 'ssh') {
    const ssh = server.sshSettings || {};
    if (ssh.user) outbound.user = ssh.user;
    if (ssh.password) outbound.password = ssh.password;
    if (ssh.privateKey) outbound.private_key = ssh.privateKey;
    if (ssh.privateKeyPath) outbound.private_key_path = ssh.privateKeyPath;
    if (ssh.privateKeyPassphrase) outbound.private_key_passphrase = ssh.privateKeyPassphrase;
    if (ssh.hostKey && ssh.hostKey.length > 0) outbound.host_key = ssh.hostKey;
    if (ssh.hostKeyAlgorithms && ssh.hostKeyAlgorithms.length > 0)
      outbound.host_key_algorithms = ssh.hostKeyAlgorithms;
    if (ssh.clientVersion) outbound.client_version = ssh.clientVersion;
    // 算法协商可选项（P3d）：sing-box 字段名 cipher / mac / kex_algorithm（已 check 实证）。空数组不下发。
    if (ssh.cipher && ssh.cipher.length > 0) outbound.cipher = ssh.cipher;
    if (ssh.mac && ssh.mac.length > 0) outbound.mac = ssh.mac;
    if (ssh.kexAlgorithm && ssh.kexAlgorithm.length > 0) outbound.kex_algorithm = ssh.kexAlgorithm;

    // SSH outbound 不需要 TLS 和传输层配置，直接返回
    return outbound;
  }

  // TLS 配置 (非 Naive 协议，因为 Naive 已在前一段处理了 tls 结构)
  if (
    protocol !== 'naive' &&
    (server.security === 'tls' || server.tlsSettings || tlsProtocols.includes(protocol))
  ) {
    // 为 Trojan 设置默认 ALPN ["http/1.1"] 以提高兼容性
    let finalAlpn = server.tlsSettings?.alpn;
    if (!finalAlpn && protocol === 'trojan') {
      finalAlpn = ['http/1.1'];
    }

    outbound.tls = {
      enabled: true,
      server_name: server.tlsSettings?.serverName || server.address,
      insecure: server.tlsSettings?.allowInsecure || false,
      alpn: finalAlpn,
    };

    // TLS 栈引擎（P3c，sing-box 1.14 tls.engine）：windows(Schannel)/apple(Network.framework) 用系统原生栈，
    // ClientHello 指纹更真。仅对 TCP-TLS 协议下发——Hy2/TUIC 走 QUIC 自带 TLS1.3，系统 TCP-TLS 栈不适用，
    // 表单也不对它们暴露此项。'go'/空 = 跨平台 Go TLS（核心默认），无需显式下发。windows/apple 在非对应平台
    // 运行时 FATAL → shouldEmitTlsEngine 按当前平台门控（表单过滤之外的第二道闸，兜跨平台导入的配置）。
    const tlsEngine = server.tlsSettings?.engine;
    if (!isQuicManagedTls(protocol) && shouldEmitTlsEngine(tlsEngine, host.platform)) {
      outbound.tls.engine = tlsEngine;
    }

    // uTLS 仅适用于基于 TCP 的协议，Hysteria2 和 TUIC 使用 QUIC (UDP) 不支持 uTLS
    const fingerprint = server.tlsSettings?.fingerprint;

    // 默认行为：VLESS 等协议默认开启 chrome 指纹，Trojan 默认不开启（none）以通过标准 TLS 握手
    let finalFingerprint = fingerprint;
    if (!finalFingerprint) {
      if (protocol === 'vless' || protocol === 'anytls') {
        finalFingerprint = 'chrome';
      } else {
        finalFingerprint = 'none';
      }
    }

    if (!isQuicManagedTls(protocol) && finalFingerprint !== 'none') {
      outbound.tls.utls = {
        enabled: true,
        fingerprint: finalFingerprint,
      };
    }

    // ALPN 仅在支持的协议上设置
    if (server.tlsSettings?.alpn) {
      outbound.tls.alpn = server.tlsSettings.alpn;
    }
  }

  if (server.security === 'reality' && server.realitySettings) {
    outbound.tls = {
      enabled: true,
      server_name: server.tlsSettings?.serverName || undefined,
      insecure: server.tlsSettings?.allowInsecure || false,
      utls: {
        enabled: true,
        fingerprint: server.tlsSettings?.fingerprint || 'chrome',
      },
      reality: {
        enabled: true,
        public_key: server.realitySettings.publicKey,
        short_id: server.realitySettings.shortId || '',
      },
    };
  }

  if (
    protocol !== 'hysteria2' &&
    protocol !== 'anytls' &&
    protocol !== 'naive' &&
    server.network &&
    server.network !== 'tcp'
  ) {
    outbound.transport = generateTransportConfig(server);
  }

  // PR-6 抗封增强（ECH / TLS 分片 / Multiplex / Hy2 端口跳跃）统一后处理
  applyAntiCensorshipOptions(outbound, server, host);

  return outbound;
}

/**
 * 生成传输层配置
 */
function generateTransportConfig(server: ServerConfig): SingBoxOutbound['transport'] {
  if (server.network === 'ws' && server.wsSettings) {
    // 0-RTT early-data：分享链/订阅常把约定写进 path（`?ed=<bytes>`[&eh=<header>]）；sing-box 不自动解析它
    // ——会把 `?` 编码成 %3F、整段当字面路径，且默认走 path 模式 → 与 xray 服务端的 /path 分流 + header 早数据
    // 约定错位、连不上（#57 L2 已实测 wire capture）。故在此把 ed/eh 拆成内核显式字段、path 去 ed/eh；
    // path 内无 ed 时回退既有显式字段（如 Clash 订阅的 max-early-data / early-data-header-name）。
    const ed = parseWsEarlyData(server.wsSettings.path || '/');
    return {
      type: 'ws',
      path: ed.path,
      headers: server.wsSettings.headers,
      max_early_data: ed.maxEarlyData ?? server.wsSettings.maxEarlyData,
      early_data_header_name: ed.earlyDataHeaderName ?? server.wsSettings.earlyDataHeaderName,
    };
  }

  if (server.network === 'grpc' && server.grpcSettings) {
    return {
      type: 'grpc',
      service_name: server.grpcSettings.serviceName || '',
    };
  }

  // HTTP/2 传输（v2ray http transport，需 TLS）：host 为 string[]、path 默认 '/'。
  // 不严格门控 httpSettings——任何 network=http 都生成 http 传输，避免回退裸 TCP（导入/表单两路统一）。
  // 'h2' 为旧表单遗留的 network 值（现已统一为 'http'）；兼容旧配置：不必重新编辑即生效。
  if (server.network === 'http' || (server.network as string) === 'h2') {
    return {
      type: 'http',
      host: server.httpSettings?.host,
      path: server.httpSettings?.path || '/',
      method: server.httpSettings?.method,
      headers: server.httpSettings?.headers,
    };
  }

  // httpupgrade：较 ws 更隐蔽的 HTTP Upgrade 传输（复用 ws 的 path / Host）
  if (server.network === 'httpupgrade') {
    return {
      type: 'httpupgrade',
      path: server.wsSettings?.path || '/',
      host: server.wsSettings?.headers?.['Host'] || server.tlsSettings?.serverName,
    };
  }

  if (server.network && server.network !== 'tcp')
    throw new Error(`Unsupported transport: ${server.network}`);
  return undefined;
}

/**
 * PR-6 抗封增强统一后处理：ECH、每节点 TLS 分片、Multiplex(reality+vision 跳过)、Hy2 端口跳跃。
 * 放在 outbound 构建完成后统一处理，避免散落到各协议的 tls/transport 构建点。
 */
function applyAntiCensorshipOptions(
  outbound: SingBoxOutbound,
  server: ServerConfig,
  host: OutboundHost
): void {
  const protocolLower = server.protocol.toLowerCase();

  // fragment 仅对「标准 sing-box TCP-TLS 栈」有意义，以下协议必须排除（否则死配置或直接启动 FATAL）：
  //   · hy2/tuic：TLS 在 QUIC 内、无 TCP ClientHello（死配置）；
  //   · naive：TLS 由 Cronet 自管，naive 出站直接拒绝 fragment 字段（实测
  //     "fragment is not supported on naive outbound" → 启动 FATAL），无论 h2/h3。
  // 注：ECH 不受此限——QUIC 与 naive(Cronet) 均原生支持 ECH。
  const fragmentUnsupported = isQuicManagedTls(protocolLower) || protocolLower === 'naive';

  // ECH（隐藏 SNI）+ 每节点 TLS 分片（抗 SNI-DPI）：需已有 tls 块
  if (outbound.tls) {
    if (server.tlsSettings?.ech) {
      // 可选 ECHConfigList：填了下发 tls.ech.config（PEM 按行拆数组）；留空则 sing-box 从 DNS(HTTPS RR) 自取。
      const echCfg = server.tlsSettings.echConfig?.trim();
      const echLines = echCfg
        ? echCfg
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
        : [];
      outbound.tls.ech =
        echLines.length > 0 ? { enabled: true, config: echLines } : { enabled: true };
    }
    if (server.tlsSettings?.fragment && !fragmentUnsupported) outbound.tls.fragment = true;

    // TLS spoof（P3a 抗审查，sing-box 1.14）：spoofMethod + spoofSni 成对非空才启用——下发 tls.spoof=spoofSni
    //（伪造 ClientHello 的「诱饵 SNI」）+ tls.spoof_method。五重门控（任一不满足即不 emit，否则内核 FATAL / 行为无效）：
    //   1. arch：ARM64 不支持（内核仅 amd64 实现）；
    //   2. 协议：仅标准 TCP-TLS 栈（排除 hy2/tuic 的 QUIC 内 TLS、naive 的 Cronet 自管 TLS），与 fragment 同集；
    //   3. 诱饵 SNI 必须是域名：IP 字面量内核拒（`spoof requires TLS ClientHello with SNI`）；
    //   4. **诱饵 SNI 必须不同于真 server_name**：内核 FATAL `spoof must differ from server_name`（已真核实证）；
    //   5. 方法合法（wrong-ack/wrong-md5/wrong-timestamp）；
    //   6. **真 server_name 本身非 IP 字面量**：节点 address 为 IP 且未填 serverName 时 server_name 回退为 IP，真握手无 SNI →
    //      内核 init 报 `spoof requires TLS ClientHello with SNI` 致整配置 FATAL。由 validateTlsSpoof 收口（传 serverSni 即校验）。
    // 注：提权（CAP_NET_RAW+NET_ADMIN / root / 管理员）是运行期生效条件，不影响配置合法性 → 此处不门控，
    //    UI 已提示需提权；缺权时内核启动期报权限错（非配置 FATAL），属用户环境问题。
    const spoofMethod = server.tlsSettings?.spoofMethod;
    const spoofSni = server.tlsSettings?.spoofSni?.trim();
    const realSni = outbound.tls.server_name;
    // 门控（方法/arch/诱饵非空/诱饵非 IP/协议 TCP-TLS/诱饵≠真 server_name/真 server_name 非 IP）经 validateTlsSpoof
    // 单一真值，与 route action spoof（singbox-custom-rules）共用同一份。
    if (
      validateTlsSpoof(spoofSni, spoofMethod, host.arch, isIpLiteral, {
        protocol: protocolLower,
        serverSni: realSni,
      })
    ) {
      outbound.tls.spoof = spoofSni;
      outbound.tls.spoof_method = spoofMethod;
    }
  }

  // Multiplex（vless/trojan/vmess/shadowsocks）；vision flow(xtls-rprx-vision) 自带流分帧、与 mux
  // 不兼容（与是否 reality 无关，普通 TLS+vision 同样不兼容）→ 跳过
  const mux = server.multiplexSettings;
  const hasVisionFlow = (server.flow || '').toLowerCase().includes('vision');
  if (
    mux?.enabled &&
    ['vless', 'trojan', 'vmess', 'shadowsocks'].includes(protocolLower) &&
    !hasVisionFlow
  ) {
    outbound.multiplex = {
      enabled: true,
      protocol: mux.protocol || 'h2mux',
      ...(mux.maxConnections ? { max_connections: mux.maxConnections } : {}),
      ...(mux.minStreams ? { min_streams: mux.minStreams } : {}),
      ...(mux.padding ? { padding: true } : {}),
    };
  }

  // Hysteria2 端口跳跃（serverPorts 为逗号分隔的范围串，如 "20000:30000"，支持多段）
  if (protocolLower === 'hysteria2' && server.hysteria2Settings?.serverPorts) {
    const ports = server.hysteria2Settings.serverPorts
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ports.length > 0) {
      outbound.server_ports = ports;
      if (server.hysteria2Settings.hopInterval) {
        outbound.hop_interval = server.hysteria2Settings.hopInterval;
      }
    }
  }
}

// ---- generateOutbounds 本体 + selector/Tailscale 簇（SingBoxConfigBuilder 抽取 Phase 2 step 10）----

/** rule-sel 载体：ruleKey→(selectorTag,memberTag) 供 generateSingBoxConfig 回填 currentRuleTargetMap 热切换定位。 */
