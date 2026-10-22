# ShadowVPN (暗影VPN)

<div align="center">

<img src="docs/banner.png" width="100%" alt="ShadowVPN" />

[简体中文](README.md) · **English**

</div>

A cross-platform proxy / VPN client for macOS, Windows, Linux, and Android. sing-box is the primary core, with Xray / mihomo auto-selected per node capability.

## Supported protocols

**Proxy protocols** (share links / subscriptions)

- VLESS, VMess, Trojan, Shadowsocks, ShadowsocksR (via mihomo)
- Hysteria2, Hysteria v1 (via mihomo), TUIC, AnyTLS, Snell, Naive
- SOCKS, HTTP, SSH
- Custom: paste a sing-box outbound JSON; enablement is probed against the running core

**Mesh**

- WireGuard (incl. `wireguard://`/`wg://` share links and Cloudflare WARP registration), Tailscale

**Enterprise VPN** (desktop)

- aTrust, EasyConnect — via the zju-connect engine
- Cisco AnyConnect, Pulse/Ivanti, Juniper Network Connect, GlobalProtect, F5, Fortinet, Array — via the OpenConnect engine
- Compatibility is claimed only where verified against a real gateway; see [enterprise-runtime/COMPATIBILITY.md](enterprise-runtime/COMPATIBILITY.md)

## Import formats

- Subscriptions: Clash YAML/JSON, sing-box JSON, Xray JSON, Base64 link groups; auto-detected by default, can be restricted to a protocol
- Share links: `vless` `vmess` `trojan` `hysteria` `hysteria2`/`hy2` `ss` `ssr` `anytls` `snell` `tuic` `naive` `socks5`/`socks` `http(s)` `wireguard`/`wg`
- On partial parse failure, existing nodes and failed entries are preserved; unknown transports are never silently downgraded to TCP

## Routing modes

- **Takeover**: system proxy (default, no system DNS changes); TUN virtual adapter engages on demand, or can be forced on; system DNS takeover under TUN is a separate toggle
- **Smart split**: auto-detects the egress IP country/region — same-region destinations go direct, the rest proxied; falls back to proxy when detection fails
- **Per-app routing**: proxy / direct / block / pin a node per installed app or process
- **Custom rules**: domain, IP CIDR and GeoIP rules with hot reload (no reconnect)

## Key features

- Automatic multi-core selection: sing-box handles takeover/routing/DNS/stats; Xray handles XHTTP/SplitHTTP; mihomo handles Clash extensions
- One-click enterprise VPN: gateway detection → form/OAuth sign-in → tunnel → gateway resources projected as local SOCKS outbounds
- Real latency measurement over the proxy via HTTPS requests, split into TCP/TLS/HTTP phases
- Auto subscription updates and node failover; app updates verified by SHA-256
- UI languages: 简体中文 / 繁體中文 / English / Русский / فارسی

## Download

Get the latest build from [Releases](https://github.com/dsanying/VPN/releases):

- **macOS**: DMG (arm64 / x64)
- **Windows**: installer and portable (x64)
- **Linux**: AppImage / deb
- **Android**: APK

Enterprise VPN and the Xray/mihomo compatibility engines are desktop features.

## License

[MIT](LICENSE.txt). This software is for learning and research purposes only; please comply with the laws and regulations of your jurisdiction.
