import type { ServerConfig } from './types';
import type { SingBoxEndpoint, SingBoxDomainResolver } from './singbox-config-types';
import { isIpLiteral } from './dns';
import {
  wireguardPeerAllowedIps,
  meshUsesSystemInterface,
  meshNodeCarriesFullTunnel,
  TS_SYSTEM_INTERFACE_NAME,
  WG_SYSTEM_INTERFACE_NAME,
} from './endpoint-routes';

export function buildWireGuardEndpoint(
  server: ServerConfig,
  tag: string,
  domainResolverTag: SingBoxDomainResolver | undefined,
  platform: string
): SingBoxEndpoint {
  const s = server.wireguardSettings;
  if (!s || !s.privateKey || !s.peerPublicKey || !s.localAddress?.length) {
    throw new Error('WireGuard 配置缺少 privateKey/peerPublicKey/localAddress');
  }
  // Layer A：allowInternet=on→specific ∪ {0/0,::/0}；off→specific；off/system+无具体段→null。
  // null 表示空 allowed_ips（FATAL），调用方应已用 isMeshNodeUnroutable 预拦不发射；此处兜底抛错（防直调，如测速）。
  const allowedIps = wireguardPeerAllowedIps(server);
  if (allowedIps === null) {
    throw new Error(
      'WireGuard 节点无可路由网段（关外网 或 system 内核接口 且无具体段）：空 allowed_ips 会致 sing-box FATAL'
    );
  }
  // 域名 server 才需 domain_resolver（IP 字面量直拨、无需解析）。endpoint 级显式优于仅靠
  // route.default_domain_resolver——后者的「单 DNS server 时可省略」豁免更脆弱，且 1.14 deprecation 走向是
  // 域名 dial 必须显式 resolver。peer 级 domain_resolver 内核不接受（实测 FATAL unknown field），故放 endpoint 顶层。
  const needsResolver = !!domainResolverTag && !isIpLiteral(server.address);
  const usesSystemInterface = meshUsesSystemInterface(server);
  return {
    type: 'wireguard',
    tag,
    ...(needsResolver ? { domain_resolver: domainResolverTag } : {}),
    // Phase 2：reverseMesh=true → system:true（真内核 WG 接口，反向可达 / 全隧道出口）；缺省 false=userspace gVisor。
    // 全隧道时 allowed_ips 含 0/0（wireguardPeerAllowedIps）→ sing-box 按 allowed_ips 装接口作用域 0/0 路由、内核接口出口。
    // system:true 需 helper 提权，由连接闸门/校验确保仅 helper 活跃时该节点 reverseMesh 才成立（见 server-completeness）。
    // WG 内核接口名 = `name`（sing-box 1.14 wireguard endpoint 字段；TS 端点用 `system_interface_name`，两协议
    // 对应键不同——sing-box check 实证：WG 端点下 interface_name/system_interface_name 均 FATAL `unknown field`，
    // 唯 `name` 通过）：固定名供出口托管/清理定位。
    system: usesSystemInterface,
    // 固定名仅非 macOS 下发（macOS utun 名动态、不接受自定义名）；macOS 按 localAddress 反查接口。
    ...(usesSystemInterface && platform !== 'darwin' ? { name: WG_SYSTEM_INTERFACE_NAME } : {}),
    mtu: s.mtu && s.mtu > 0 ? s.mtu : 1408,
    address: s.localAddress,
    private_key: s.privateKey,
    peers: [
      {
        address: server.address,
        port: server.port,
        public_key: s.peerPublicKey,
        allowed_ips: allowedIps,
        ...(s.preSharedKey ? { pre_shared_key: s.preSharedKey } : {}),
        // keepalive 缺省强制 25s：WireGuard 是无连接 UDP，client 多在 NAT 后，无 keepalive 则 NAT 映射超时
        // → 入向不可达、隧道静默断连。故未显式设置时兜 25s 维持映射，避免断连（用户可在表单调大）。
        persistent_keepalive_interval:
          s.persistentKeepalive && s.persistentKeepalive > 0 ? s.persistentKeepalive : 25,
        ...(s.reserved?.length === 3 ? { reserved: s.reserved } : {}),
      },
    ],
  };
}

export function buildTailscaleEndpoint(
  server: ServerConfig,
  tag: string,
  stateDir: string,
  platform: string
): SingBoxEndpoint {
  const ts = server.tailscaleSettings || {};
  const ep: SingBoxEndpoint = { type: 'tailscale', tag, state_directory: stateDir };
  const authKey = ts.authKey?.trim();
  if (authKey) ep.auth_key = authKey;
  const controlUrl = ts.controlUrl?.trim();
  if (controlUrl) ep.control_url = controlUrl;
  const hostname = ts.hostname?.trim();
  if (hostname) ep.hostname = hostname;
  // exit_node 仅在节点「承载全隧道」时下发：关外网→不下发。**TS 的 exit_node 与 system 模式正交**——exit_node
  // 是 tailnet 层概念（选 peer 经 tailnet 出），不落 0/0 OS 默认路由，故不触发结论A 的 0/0 冲突，system:true 下也下发
  // （与 WG 0/0 受 system 约束不同；见 meshNodeCarriesFullTunnel 协议口径 + docs/design/mesh-mode-exit-redesign.md）。
  // 节点仍承载 tailnet/routes 段（force-route）。system_interface 由下方 meshUsesSystemInterface 单独下发。
  const exitNode = meshNodeCarriesFullTunnel(server) ? ts.exitNode?.trim() : undefined;
  if (exitNode) {
    ep.exit_node = exitNode;
    if (ts.exitNodeAllowLanAccess) ep.exit_node_allow_lan_access = true;
  }
  if (ts.acceptRoutes) ep.accept_routes = true;
  if (ts.ephemeral) ep.ephemeral = true;
  const adv = (ts.advertiseRoutes || []).map((c) => c.trim()).filter(Boolean);
  if (adv.length) ep.advertise_routes = adv;
  // P4a 新字段（全可选；sing-box check 实证 1.14-alpha.32）：
  //  advertise_tags（Since 1.12.0）：ACL 标签数组（按标签授权 tailnet）；空清单不下发。
  //  sshServer（ssh_server，Since 1.13.0）：true → ssh_server:true（badoption bool 形式，等价 {enabled:true}）；节点跑 Tailscale SSH。
  //  relayServerPort：>0 → relay_server_port（peer relay 入站中继监听端口）。
  const advTags = (ts.advertiseTags || []).map((tg) => tg.trim()).filter(Boolean);
  if (advTags.length) ep.advertise_tags = advTags;
  if (ts.sshServer) ep.ssh_server = true;
  if (typeof ts.relayServerPort === 'number' && ts.relayServerPort > 0) {
    ep.relay_server_port = ts.relayServerPort;
  }
  // Phase 2：reverseMesh=true → system_interface=true（真 TUN，反向可达/作 subnet router）；需 helper 提权，
  // 由连接闸门/校验确保仅 helper 活跃时成立。缺省省略=tsnet 用户态、零提权。
  // 下发固定 system_interface_name：① 出口托管(MeshExitRouteManager)按此名在内核接口装 exit 拆半默认路由
  //（sing-box 只装 tailnet+子网、不装 exit 0/0，真机实证）；② 起停/清理按名精确定位。见 mesh-exit-route.ts。
  if (meshUsesSystemInterface(server)) {
    ep.system_interface = true;
    // macOS 内核 utun 名由内核动态分配、不接受自定义名（设了可能 FATAL）→ 仅非 macOS 下发固定名；
    // macOS 出口托管按接口地址（tailnet 100.x）反查接口名，不依赖固定名（用户实证 utunXX 动态）。
    if (platform !== 'darwin') ep.system_interface_name = TS_SYSTEM_INTERFACE_NAME;
  }
  return ep;
}
