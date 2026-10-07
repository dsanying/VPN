/**
 * sing-box 1.14 管理 API（daemon.StartedService）gRPC 客户端 —— 管理面统一入口（非仅 Tailscale）。
 * 含：Tailscale 状态订阅 + 原生登出，以及 clash 等价管理方法（选节点 / 关连接 / 订阅 Status / 订阅 Connections）。
 * 取代 1.13.x 的「state 目录存在性 + stdout 日志解析」启发式（见 docs/design/tailscale-1.14-management-api.md）。
 *
 * 官方 proto 定义单独维护（避免打包路径依赖），字段与消息均使用 sing-box
 * v1.14.2 官方完整定义；升级核时同步官方 schema。
 *
 * TailscaleEndpointStatus 的 peers 不在顶层：对端按归属用户分组在 userGroups(f8).peers(f5)，
 * 顶层另有 exitNode(f9)=当前选中出口。peer 的 exitNodeOption(f7)=是否广告可当出口（出口下拉判据）。
 * 官方字段布局由独立编码的 wire 测试覆盖；Status、选节点与关连接经 1.14.2 真核实测。
 *
 * 认证（P0 修复）：api service 注入了 secret（= config.clashApiSecret）时，daemon/server.go 会对每个 RPC 校验
 * metadata `authorization: "Bearer <secret>"`（缺失/不符 → Unauthenticated）。本客户端经 call credentials 把 Bearer
 * 注入到所有 unary + stream 调用；secret 为空时退化为不带 metadata（免认证，本地调试/旧核）。
 *
 * 端点：构造参数 endpoint = { host, port, tls? }。本地端点（不带 tls）走 h2c（createInsecure）；带 tls 的端点经
 * TLS——channel credentials 换 createSsl（带可选 CA / skip-verify），Bearer 仍走 per-call metadata（h2c/TLS 一致，不变）。
 * TLS 行为对照 @grpc/grpc-js：createSsl(rootCerts?, ...) —— rootCerts=undefined 用系统默认 CA 链验证；传 CA Buffer
 * 用自定义 CA（自签证书场景）；skipVerify 走 checkServerIdentity no-op + 自签 CA 注入（grpc-js 无「全跳过校验」开关，
 * 见 channelCredentials 实现说明）。
 */
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TailscaleStatusPeer } from '../../shared/tailscale-status';
import { SINGBOX_STARTED_SERVICE_PROTO } from './singbox-started-service-schema';
import { isIpv4 } from '../../shared/ip';

// self 与对端 peer 同构（同一 TailscalePeer 消息）。exitNode/exitNodeOption/active 对 self 通常为空。
export interface TailscalePeer {
  hostName?: string;
  os?: string;
  tailscaleIPs?: string[];
  online?: boolean;
  exitNode?: boolean; // 当前被本节点选作出口
  exitNodeOption?: boolean; // 广告了可当出口（候选资格，是否能进出口下拉的判据）
  active?: boolean; // 近期有活跃直连/流量
  keyExpiry?: string; // longs=String：unix 秒
  stableID?: string;
  expired?: boolean;
}

// 保留别名兼容既有 self 引用（self 即一个 TailscalePeer）。
export type TailscaleSelf = TailscalePeer;

// 对端按归属用户分组的容器（仅承载 peers，分组元信息 FlowZ 不用 → 不映射其它字段）。
export interface TailscaleUserGroup {
  peers?: TailscalePeer[];
}

export interface TailscaleEndpointStatus {
  endpointTag: string; // = FlowZ 节点 tag（server.name）
  backendState: string; // NoState | NeedsLogin | Starting | Running | ...
  authURL: string;
  self?: TailscaleSelf;
  userGroups?: TailscaleUserGroup[]; // 对端按 owner 分组；摊平见 flattenTailscalePeers
  exitNode?: TailscalePeer; // 当前选中的出口节点（peer 形态；endpoint.f9）
}

/**
 * 把 userGroups 各组 peers 摊平成一张去重列表（按 stableID 去重，无 stableID 时按 hostName+首个 IP）。
 * sing-box 把对端按归属用户分组下发（同一台机器不会跨组重复，但跨组去重是廉价护栏）。
 * 纯数据变换，无副作用，供主进程/单测复用。
 */
export function flattenTailscalePeers(status: TailscaleEndpointStatus): TailscalePeer[] {
  const seen = new Set<string>();
  const out: TailscalePeer[] = [];
  for (const g of status.userGroups || []) {
    for (const p of g.peers || []) {
      const key = p.stableID || `${p.hostName || ''}|${(p.tailscaleIPs || [])[0] || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** peer 的内网 IP：首个 IPv4(100.x)，无则首个 IP，再无则空串。用 shared/ip 的严格 isIpv4（非 'contains .' 启发，抗 wire 漂移）。 */
function pickPeerIp(p: { tailscaleIPs?: string[] }): string {
  const ips = p.tailscaleIPs || [];
  return ips.find(isIpv4) || ips[0] || '';
}

/**
 * 摊平 endpoint 状态为 lean peer 列表（EVENT_TAILSCALE_STATUS / TAILSCALE_GET_STATUS 载荷用）。
 * peers 来自 userGroups，**天然排除 self**（self 是 endpoint.self 独立字段，不进 userGroups）。纯函数，供单测。
 */
export function toTailscaleStatusPeers(ep: TailscaleEndpointStatus): TailscaleStatusPeer[] {
  return flattenTailscalePeers(ep).map((p) => ({
    hostName: p.hostName || '',
    ip: pickPeerIp(p),
    online: p.online === true,
    exitNode: p.exitNode === true,
    exitNodeOption: p.exitNodeOption === true,
    active: p.active === true,
    stableID: p.stableID || undefined, // 热重设 exit_node 用（UI 不消费）
  }));
}

// clash 等价方法消息（longs=String → int64/uint64 字段均为 string；enums=String → type 为 'NEW'|'UPDATE'|'CLOSED'）。
export interface SingBoxStatus {
  memory?: string;
  goroutines?: number;
  connectionsIn?: number;
  connectionsOut?: number;
  trafficAvailable?: boolean;
  uplink?: string;
  downlink?: string;
  uplinkTotal?: string;
  downlinkTotal?: string;
}

export interface SingBoxProcessInfo {
  processId?: number;
  userId?: number;
  userName?: string;
  processPath?: string;
  packageNames?: string[];
}

export interface SingBoxConnection {
  id?: string;
  inbound?: string;
  inboundType?: string;
  ipVersion?: number;
  network?: string;
  source?: string;
  destination?: string;
  domain?: string;
  protocol?: string;
  user?: string;
  fromOutbound?: string;
  createdAt?: string;
  closedAt?: string;
  uplink?: string;
  downlink?: string;
  uplinkTotal?: string;
  downlinkTotal?: string;
  rule?: string;
  outbound?: string;
  outboundType?: string;
  chainList?: string[];
  processInfo?: SingBoxProcessInfo;
}

export interface SingBoxConnectionEvent {
  type?: string; // 'NEW' | 'UPDATE' | 'CLOSED'（enums=String）
  id?: string;
  connection?: SingBoxConnection;
  uplinkDelta?: string;
  downlinkDelta?: string;
  closedAt?: string;
}

export interface SingBoxConnectionEvents {
  events?: SingBoxConnectionEvent[];
  reset?: boolean;
}

/**
 * 管理 API 端点。本地端点 = { host:'127.0.0.1', port } 不带 tls（h2c）；带 tls 的端点走 TLS。
 * tls.ca：自签证书的 PEM CA（Buffer/字符串均可，留空用系统默认 CA 链）；tls.skipVerify：跳过证书校验（不安全，仅
 * 自签且无 CA 的便利档，UI 警示）。secret 不在端点里——它是 Bearer per-call metadata（见 authMetadata），h2c/TLS 一致。
 */
export interface SingBoxApiTlsOptions {
  /** PEM 格式 CA（自签证书校验用）；空 → 系统默认 CA 链。 */
  ca?: string;
  /** 跳过服务端证书校验（不安全，仅自签且未提供 CA 的便利场景）。 */
  skipVerify?: boolean;
}

export interface SingBoxApiEndpoint {
  host: string;
  port: number;
  /** 存在即走 TLS（createSsl）；不存在 → 本地 h2c（createInsecure）。 */
  tls?: SingBoxApiTlsOptions;
}

// service 构造器只解析一次（proto 内嵌→写临时文件→loadSync）。
let serviceCtor: grpc.ServiceClientConstructor | null = null;
function getServiceCtor(): grpc.ServiceClientConstructor {
  if (serviceCtor) return serviceCtor;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowvpn-grpc-'));
  try {
    const protoPath = path.join(dir, 'started-service.proto');
    fs.writeFileSync(protoPath, SINGBOX_STARTED_SERVICE_PROTO, { mode: 0o600 });
    const def = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
    });
    const pkg = grpc.loadPackageDefinition(def) as unknown as {
      daemon: { StartedService: grpc.ServiceClientConstructor };
    };
    serviceCtor = pkg.daemon.StartedService;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return serviceCtor;
}

/**
 * 连本地 api service（127.0.0.1:<port>，不加密 h2c），订阅 Tailscale 状态流（断线自动重连）+ clash 等价管理方法。
 * 随主核起停：主核起→start()，主核停→stop()。
 *
 * 兼容：旧构造签名 (port:number, onUpdate) 已迁移为 (endpoint, secret, onUpdate?)；调用方 ProxyManager 已同步。
 */
export class SingBoxApiClient {
  private readonly host: string;
  private readonly port: number;
  private readonly tls?: SingBoxApiTlsOptions;
  private readonly secret: string;
  private readonly onUpdate?: (endpoints: TailscaleEndpointStatus[]) => void;

  private client: grpc.Client | null = null;
  private call: grpc.ClientReadableStream<{ endpoints?: TailscaleEndpointStatus[] }> | null = null;
  private stopped = false;
  private retryTimer: NodeJS.Timeout | null = null;

  /**
   * @param endpoint 管理 API 端点（{host, port, tls?}）。本地 = 无 tls（h2c）；远程 = 带 tls（TLS）。
   * @param secret   Bearer 鉴权 secret（本地 = config.clashApiSecret；远程 = 远端实例 secret）；空串 → 免认证。
   * @param onUpdate Tailscale 状态订阅回调（可选——纯做 clash 管理调用时可不传，不自动 start 订阅）。
   */
  constructor(
    endpoint: SingBoxApiEndpoint,
    secret: string,
    onUpdate?: (endpoints: TailscaleEndpointStatus[]) => void
  ) {
    this.host = endpoint.host;
    this.port = endpoint.port;
    this.tls = endpoint.tls;
    this.secret = secret;
    this.onUpdate = onUpdate;
  }

  private target(): string {
    // F4：裸 IPv6 字面量（如 '::1'）须方括号包裹，否则 '::1:9090' 是非法 gRPC target。
    // host 字段不含端口，任何 ':' 即 IPv6 字面量——含 IPv4-mapped 写法 '::ffff:1.2.3.4'。
    // 此处刻意保留「含 ':' 即包裹」的最宽判定（gRPC target 仅需正确加括号，无需 IP 校验）；与 shared 的
    // isIpv6Literal（R4-1 后已纳入 IPv4-mapped）对该地址结论一致，仅本判定更宽容（不校验末段是否严格 IPv4）。
    // 已带方括号（'[::1]'）/IPv4/域名（无 ':'）照旧不包裹。
    const host =
      this.host.includes(':') && !this.host.startsWith('[') ? `[${this.host}]` : this.host;
    return `${host}:${this.port}`;
  }

  /**
   * 通道凭据：本地（无 tls）= h2c insecure；远程（带 tls）= TLS createSsl。
   *
   * createSsl(rootCerts?, privateKey?, certChain?, verifyOptions?)（@grpc/grpc-js）：
   *  - rootCerts=null/undefined → 用系统默认受信 CA 链验证服务端证书（公网正规证书场景）；
   *  - rootCerts=CA Buffer（PEM）→ 仅用该 CA 验证（自签证书场景，FlowZ 把 tls.ca 字符串转 Buffer 传入）；
   *  - skipVerify：grpc-js 无「完全关闭校验」单一开关；用 verifyOptions.checkServerIdentity 返回 undefined（不抛=接受）
   *    放过 hostname/SAN 不匹配。注意——仅 checkServerIdentity 仍会按 rootCerts 验证书链；自签且未提供 CA 时链亦不过，
   *    故 skipVerify 同时把 rootCerts 兜底为空 Buffer + 该 no-op，达到「自签便利直连」效果（不安全，仅便利档，UI 警示）。
   *
   * 真机待验：createSsl 的 CA/skipVerify 对真实 sing-box 1.14 核（api service 开 TLS + secret）的握手行为，本机无远程
   * 实例难验；以 grpc-js 文档语义实现，标记真机验证（远端 1.14 核暴露 TLS 管理 API 后跑连通测试）。
   */
  private channelCredentials(): grpc.ChannelCredentials {
    if (!this.tls) return grpc.credentials.createInsecure();
    const caBuf = this.tls.ca ? Buffer.from(this.tls.ca, 'utf-8') : undefined;
    if (this.tls.skipVerify) {
      // 跳过校验：rootCerts 给空 Buffer（避免系统 CA 链对自签直接拒）+ checkServerIdentity no-op（放过 SAN/hostname）。
      return grpc.credentials.createSsl(caBuf ?? Buffer.alloc(0), null, null, {
        checkServerIdentity: () => undefined,
      });
    }
    // 正常校验：有 CA 用 CA，无 CA 用系统默认 CA 链（caBuf=undefined）。
    return grpc.credentials.createSsl(caBuf);
  }

  /** 每调用 Bearer 认证 metadata。h2c 下 call credentials 不可用——combineChannelCredentials over insecure 实测抛
   *  'Cannot compose insecure credentials'（@grpc/grpc-js 拒绝明文通道附 call creds）；改逐调用 metadata，实测对
   *  secret 保护的 api service 认证通过（GetVersion OK / no-auth → 16 UNAUTHENTICATED）。secret 空则免认证。 */
  private authMetadata(): grpc.Metadata {
    const md = new grpc.Metadata();
    if (this.secret) md.set('authorization', `Bearer ${this.secret}`);
    return md;
  }

  private newClient(): grpc.Client {
    const Ctor = getServiceCtor();
    return new Ctor(this.target(), this.channelCredentials());
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    if (!this.onUpdate) return; // 无订阅回调：纯管理调用客户端，不开 Tailscale 状态流
    try {
      this.client = this.newClient();
      this.call = (
        this.client as unknown as {
          SubscribeTailscaleStatus: (
            req: Record<string, never>,
            md: grpc.Metadata
          ) => grpc.ClientReadableStream<{ endpoints?: TailscaleEndpointStatus[] }>;
        }
      ).SubscribeTailscaleStatus({}, this.authMetadata());
      this.call.on('data', (msg) => {
        // stop 后守卫：gRPC cancel() 是 best-effort，已派发进事件循环的在途 data 帧仍可能触发——
        // 不加守卫会在 stop（换节点/切模式后旧 client 已弃用、ProxyManager 已置 client=null）后
        // 用陈旧 endpoint 状态推一条跨代 EVENT_TAILSCALE_STATUS，误点亮/熄灭错节点登录态。
        if (this.stopped) return;
        this.onUpdate?.(msg?.endpoints || []);
      });
      this.call.on('error', () => this.scheduleReconnect());
      this.call.on('end', () => this.scheduleReconnect());
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    this.cleanupCall();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, 2000);
  }

  private cleanupCall(): void {
    try {
      this.call?.cancel();
    } catch {
      /* ignore */
    }
    this.call = null;
    try {
      this.client?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
  }

  /** 原生登出指定 endpoint（不清 state 目录）。一次性 unary call，独立连接。带 deadline 保证必 settle（B-1）。 */
  logout(endpointTag: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const c = this.newClient();
        const opts: grpc.CallOptions = {
          deadline: new Date(Date.now() + SingBoxApiClient.UNARY_DEADLINE_MS),
        };
        (
          c as unknown as {
            TailscaleLogout: (
              req: { endpointTag: string },
              md: grpc.Metadata,
              options: grpc.CallOptions,
              cb: (err: grpc.ServiceError | null) => void
            ) => void;
          }
        ).TailscaleLogout({ endpointTag }, this.authMetadata(), opts, (err) => {
          try {
            c.close();
          } catch {
            /* ignore */
          }
          if (err) reject(err);
          else resolve();
        });
      } catch (e) {
        reject(e as Error);
      }
    });
  }

  // unary 调用 deadline（ms）：核启动中（TCP accept 但 StartedService 方法尚未 serve）或 wedged 时 gRPC 回调
  // 永不触发 → promise 永挂 → 连接页 Close/Close-All 按钮永久 spinner（B-1）。对齐被删 ClashApiClient.request 的
  // timeoutMs=2000，保证每次 unary 必在 ~2s 内 settle（DEADLINE_EXCEEDED → reject 走调用方既有错误处理契约）。
  private static readonly UNARY_DEADLINE_MS = 2000;

  /** 通用一次性 unary 调用（独立连接，调用后即关）。供 clash 等价方法复用。带绝对 deadline 保证必 settle。 */
  private unary<TReq>(method: string, req: TReq): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const c = this.newClient();
        const opts: grpc.CallOptions = {
          deadline: new Date(Date.now() + SingBoxApiClient.UNARY_DEADLINE_MS),
        };
        (
          c as unknown as Record<
            string,
            (
              r: TReq,
              md: grpc.Metadata,
              options: grpc.CallOptions,
              cb: (err: grpc.ServiceError | null) => void
            ) => void
          >
        )[method](req, this.authMetadata(), opts, (err) => {
          try {
            c.close();
          } catch {
            /* ignore */
          }
          if (err) reject(err);
          else resolve();
        });
      } catch (e) {
        reject(e as Error);
      }
    });
  }

  /** clash 等价：在 selector/urltest group 内选定出站。 */
  selectOutbound(groupTag: string, outboundTag: string): Promise<void> {
    return this.unary('SelectOutbound', { groupTag, outboundTag });
  }

  /**
   * 热重设指定 TS endpoint 的出口节点（EditPrefs{ExitNodeID}，幂等）：re-advertise 后强制核重解析 exit_node，
   * 免整重启核（sing-box watchState 失败后不随 netmap 重试的缺口的补丁通道）。同值为核侧 no-op。
   */
  setTailscaleExitNode(endpointTag: string, stableID: string): Promise<void> {
    return this.unary('SetTailscaleExitNode', { endpointTag, stableID });
  }

  /** clash 等价：按 id 关闭单条连接。 */
  closeConnection(id: string): Promise<void> {
    return this.unary('CloseConnection', { id });
  }

  /**
   * 连通探活（P5 Phase2 远端连通测试，只读无副作用）：开一条 SubscribeStatus 流，收到首帧 → ok（鉴权/TLS/可达均通过）；
   * 流 error（含 16 UNAUTHENTICATED / TLS 握手失败 / 连接拒绝） → reject；timeoutMs 内无任何帧/错误 → reject('timeout')。
   * 探活后立即 cancel 流 + close client（不留连接）。供「连通测试」按钮用，不影响 start/stop 的订阅生命周期。
   */
  probe(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let client: grpc.Client | null = null;
      let stream: grpc.ClientReadableStream<unknown> | null = null;
      const done = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          stream?.cancel();
        } catch {
          /* ignore */
        }
        try {
          client?.close();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => done(new Error('probe timeout')), timeoutMs);
      try {
        client = this.newClient();
        stream = (
          client as unknown as Record<
            string,
            (r: { interval: number }, md: grpc.Metadata) => grpc.ClientReadableStream<unknown>
          >
        ).SubscribeStatus({ interval: 1_000_000_000 }, this.authMetadata());
        stream.on('data', () => done());
        stream.on('error', (e: Error) => done(e));
        stream.on('end', () => done(new Error('stream ended before any frame')));
      } catch (e) {
        done(e as Error);
      }
    });
  }

  /** clash 等价：关闭全部连接（Empty 请求）。 */
  closeAllConnections(): Promise<void> {
    return this.unary('CloseAllConnections', {});
  }

  /**
   * clash 等价：订阅 Status 流（内存/goroutine/流量速率/累计）。intervalNs = 推送间隔（纳秒，int64）。
   * 复用 SubscribeTailscaleStatus 的断线重连模式，返回一个 stop 句柄供调用方停订阅。
   */
  subscribeStatus(intervalNs: number, onStatus: (status: SingBoxStatus) => void): () => void {
    return this.subscribeStream<{ interval: number }, SingBoxStatus>(
      'SubscribeStatus',
      { interval: intervalNs },
      onStatus
    );
  }

  /**
   * clash 等价：订阅 Connections 事件流（NEW/UPDATE/CLOSED 增量 + reset 全量重置）。intervalNs = 推送间隔（纳秒）。
   * 复用断线重连模式，返回 stop 句柄。
   */
  subscribeConnections(
    intervalNs: number,
    onEvents: (events: SingBoxConnectionEvents) => void
  ): () => void {
    return this.subscribeStream<{ interval: number }, SingBoxConnectionEvents>(
      'SubscribeConnections',
      { interval: intervalNs },
      onEvents
    );
  }

  /**
   * 通用 server-streaming 订阅（独立连接 + 2s 断线重连），返回 stop 句柄。
   * 与 Tailscale 订阅流（this.call）相互独立——各持各的 client/retryTimer，互不干扰生命周期。
   */
  private subscribeStream<TReq, TMsg>(
    method: string,
    req: TReq,
    onMsg: (msg: TMsg) => void
  ): () => void {
    let stopped = false;
    let client: grpc.Client | null = null;
    let stream: grpc.ClientReadableStream<TMsg> | null = null;
    let retry: NodeJS.Timeout | null = null;

    const cleanup = (): void => {
      try {
        stream?.cancel();
      } catch {
        /* ignore */
      }
      stream = null;
      try {
        client?.close();
      } catch {
        /* ignore */
      }
      client = null;
    };

    const schedule = (): void => {
      if (stopped || retry) return;
      cleanup();
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, 2000);
    };

    const connect = (): void => {
      if (stopped) return;
      try {
        client = this.newClient();
        stream = (
          client as unknown as Record<
            string,
            (r: TReq, md: grpc.Metadata) => grpc.ClientReadableStream<TMsg>
          >
        )[method](req, this.authMetadata());
        stream.on('data', (msg: TMsg) => {
          if (stopped) return;
          onMsg(msg);
        });
        stream.on('error', () => schedule());
        stream.on('end', () => schedule());
      } catch {
        schedule();
      }
    };

    connect();

    return () => {
      stopped = true;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      cleanup();
    };
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.cleanupCall();
  }
}
