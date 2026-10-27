# 暗影VPN

<div align="center">

<img src="docs/banner.png" width="100%" alt="暗影VPN" />

**简体中文** · [English](README.en.md)

</div>

跨平台代理 / VPN 客户端，覆盖 macOS、Windows、Linux 与 Android。以 sing-box 为主核，按节点能力自动搭配 Xray / mihomo。

## 支持的协议

**代理协议**（分享链接 / 订阅导入）

- VLESS、VMess、Trojan、Shadowsocks、ShadowsocksR（经 mihomo）
- Hysteria2、Hysteria v1（经 mihomo）、TUIC、AnyTLS、Snell、Naive
- SOCKS、HTTP、SSH
- 自定义：直接粘贴 sing-box outbound JSON，能否启用由内核探测判定

**组网**

- WireGuard（含 `wireguard://`/`wg://` 分享链接与 Cloudflare WARP 注册）、Tailscale

**企业 VPN**（桌面端）

- aTrust、EasyConnect —— 经 zju-connect 引擎
- Cisco AnyConnect、Pulse/Ivanti、Juniper Network Connect、GlobalProtect、F5、Fortinet、Array —— 经 OpenConnect 引擎
- 兼容性以真实网关验证为准，未验证的厂商不做宣称，见 [enterprise-runtime/COMPATIBILITY.md](enterprise-runtime/COMPATIBILITY.md)

## 导入方式

- 订阅：Clash YAML/JSON、sing-box JSON、Xray JSON、Base64 链接组；默认自动识别，可限定协议
- 分享链接：`vless` `vmess` `trojan` `hysteria` `hysteria2`/`hy2` `ss` `ssr` `anytls` `snell` `tuic` `naive` `socks5`/`socks` `http(s)` `wireguard`/`wg`
- 部分解析失败时保留已有节点与失败条目；未知传输不静默降级为 TCP

## 分流方式

- **接管模式**：TUN 虚拟网卡自动接管（连接时自动接管系统 DNS，停止/退出/崩溃自动还原）；智能分流下同地区直连、其余代理
- **智能分流**：自动识别出口 IP 的国家/地区，同地区直连、其余代理；识别失败时暂走代理
- **应用分流**：按已安装应用/进程设代理、直连、阻断或指定节点
- **自定义规则**：域名、IP CIDR、GeoIP 规则，规则热更新不断线

## 主要功能

- 多内核自动选择：sing-box 统一接管/路由/DNS/统计；Xray 处理 XHTTP/SplitHTTP；mihomo 处理 Clash 扩展
- 企业 VPN 一键接入：网关识别 → 表单/OAuth 登录 → 隧道 → 网关资源投影为本地 SOCKS
- 真实延迟测速：经代理发起 HTTPS 请求，区分 TCP/TLS/HTTP 阶段
- 订阅自动更新、节点自动切换；应用更新按 SHA-256 校验
- 界面语言：简体中文 / 繁體中文 / English / Русский / فارسی

## 下载

从 [Releases](https://github.com/dsanying/VPN/releases) 获取最新版本：

- **macOS**：DMG（arm64 / x64）
- **Windows**：安装版与便携版（x64）
- **Linux**：AppImage / deb
- **Android**：APK

企业 VPN 与 Xray/mihomo 兼容引擎为桌面端功能。

## 许可

[MIT](LICENSE.txt)。本软件仅供学习与研究使用，请遵守所在地法律法规。
