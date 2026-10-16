# 暗影VPN

<div align="center">

<img src="docs/banner.png" width="100%" alt="暗影VPN" />

[English](README.en.md) · [繁體中文](README.zh-TW.md) · [Русский](README.ru.md) · [فارسی](README.fa.md)

</div>

跨平台代理 / VPN 客户端。桌面端基于 Electron（React + Ant Design 界面），Android 端基于 Capacitor + VpnService。以 sing-box 为主核，按节点能力自动搭配 Xray / mihomo。基于 FlowZ 持续演进。

## 支持的协议

**代理协议**（分享链接 / 订阅导入）

- VLESS、VMess、Trojan、Shadowsocks、ShadowsocksR（经 mihomo）
- Hysteria2、Hysteria v1（经 mihomo）、TUIC、AnyTLS、Snell、Naive
- SOCKS、HTTP、SSH
- 自定义：直接粘贴 sing-box outbound JSON，能否启用由内核探测判定

**组网**

- WireGuard（含 `wireguard://`/`wg://` 分享链接与 Cloudflare WARP 注册）、Tailscale

**企业 VPN**（桌面端，基于官方/主流上游实现）

- aTrust、EasyConnect —— 经 zju-connect 引擎
- Cisco AnyConnect、Pulse/Ivanti、Juniper Network Connect、GlobalProtect、F5、Fortinet、Array —— 经 OpenConnect 引擎
- 兼容性以真实网关验证为准，未验证的厂商不做宣称。实测与边界见 [enterprise-runtime/COMPATIBILITY.md](enterprise-runtime/COMPATIBILITY.md)。

## 导入方式

- 订阅：Clash YAML/JSON、sing-box JSON、Xray JSON、Base64 链接组；默认自动识别，可限定协议
- 分享链接：`vless` `vmess` `trojan` `hysteria` `hysteria2`/`hy2` `ss` `ssr` `anytls` `snell` `tuic` `naive` `socks5`/`socks` `http(s)` `wireguard`/`wg`
- 部分解析失败时保留已有节点与失败条目；未知传输不静默降级为 TCP

## 分流方式

- **接管模式**：系统代理（默认，不改系统 DNS）；TUN 虚拟网卡自动按需接管（应用/进程规则需要时启用），首页可强制常开；TUN 可单独开关系统 DNS 接管
- **智能分流**：自动识别出口 IP 的国家/地区，同地区直连、其余代理；识别失败时暂走代理
- **应用分流**：按已安装应用/进程设代理、直连、阻断或指定节点
- **自定义规则**：域名、IP CIDR、GeoIP 规则，规则热更新不断线

## 主要功能

- 多内核自动选择：sing-box 统一接管/路由/DNS/统计；Xray 处理 XHTTP/SplitHTTP；mihomo 处理 Clash 扩展
- 企业 VPN 一键接入：网关识别 → 表单/OAuth 登录 → 隧道 → 按网关下发资源投影为本地 SOCKS
- 真实延迟测速：经代理发起 HTTPS 请求，区分 TCP/TLS/HTTP 阶段；不用 TCP 端口连通冒充可用
- 订阅自动更新、节点自动切换（经节点 HTTPS 探测）；应用更新按 SHA-256 校验
- 界面语言：简体中文 / 繁體中文 / English / Русский / فارسی

## 平台状态

- **macOS**（arm64 / x64，DMG）、**Windows**（x64，安装版与便携版）、**Linux**（AppImage / deb）
- **Android**：Capacitor + VpnService，内嵌 sing-box 内核
- 企业 VPN 与 Xray/mihomo 兼容引擎为桌面实现

## 开发和验证

```sh
npm ci
pnpm --dir web install --frozen-lockfile
npm run build:helper
npm run fetch:core
npm run fetch:dashboard
npm test -- --runInBand
npm run test:core-gate
npm run lint
npm run typecheck:renderer
pnpm --dir web check
npm run build
npm run dev
```

`npm run dev` 启动本地开发版（Vite + Electron），界面改动热更新；主进程与 preload 修改需重启。真实订阅验证使用仓库外私有输入文件：

```sh
SHADOW_VPN_SOURCE_FILE=/absolute/private/config.json \
SHADOW_VPN_REPORT=/absolute/private/report.json \
node scripts/verify-live-backend.cjs
```

不要把订阅 URL、凭据、应用数据或测试报告提交到仓库。

## 许可与来源

[MIT](LICENSE.txt)。上游基线 `e0902e8c9aa8a0baa60ae840d5582edd49781b01`（FlowZ 4.3.3），上游说明见 [README.upstream.md](README.upstream.md)。企业运行时源码与许可见 [enterprise-runtime/](enterprise-runtime/README.md)。
