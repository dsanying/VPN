# ShadowVPN (暗影VPN)

<div align="center">

<img src="docs/banner.png" width="100%" alt="ShadowVPN" />

[简体中文](README.md) · **English** · [繁體中文](README.zh-TW.md) · [Русский](README.ru.md) · [فارسی](README.fa.md)

</div>

A cross-platform proxy / VPN client. Desktop builds on Electron (React + Ant Design UI); Android uses Capacitor + VpnService. sing-box is the primary core, with Xray / mihomo auto-selected per node capability. Evolved from FlowZ.

## Supported protocols

**Proxy protocols** (share links / subscriptions)

- VLESS, VMess, Trojan, Shadowsocks, ShadowsocksR (via mihomo)
- Hysteria2, Hysteria v1 (via mihomo), TUIC, AnyTLS, Snell, Naive
- SOCKS, HTTP, SSH
- Custom: paste a sing-box outbound JSON; enablement is probed against the running core

**Mesh**

- WireGuard (incl. `wireguard://`/`wg://` share links and Cloudflare WARP registration), Tailscale

**Enterprise VPN** (desktop; built on official/mainstream upstream implementations)

- aTrust, EasyConnect — via the zju-connect engine
- Cisco AnyConnect, Pulse/Ivanti, Juniper Network Connect, GlobalProtect, F5, Fortinet, Array — via the OpenConnect engine
- Compatibility claims follow real-gateway verification only; unverified vendors are not claimed. See [enterprise-runtime/COMPATIBILITY.md](enterprise-runtime/COMPATIBILITY.md).

## Import formats

- Subscriptions: Clash YAML/JSON, sing-box JSON, Xray JSON, Base64 link groups; auto-detected by default, can be restricted to a protocol
- Share links: `vless` `vmess` `trojan` `hysteria` `hysteria2`/`hy2` `ss` `ssr` `anytls` `snell` `tuic` `naive` `socks5`/`socks` `http(s)` `wireguard`/`wg`
- On partial parse failure, existing nodes and failed entries are preserved; unknown transports are never silently downgraded to TCP

## Routing modes

- **Takeover**: system proxy (default, no system DNS changes); TUN virtual adapter engages on demand when app/process rules need it, or can be forced on; system DNS takeover under TUN can be toggled separately
- **Smart split**: auto-detects the egress IP country/region — same-region destinations go direct, the rest proxied; falls back to proxy when detection fails
- **Per-app routing**: proxy / direct / block / pin a node per installed app or process
- **Custom rules**: domain, IP CIDR and GeoIP rules with hot reload (no reconnect)

## Key features

- Automatic multi-core selection: sing-box handles takeover/routing/DNS/stats; Xray handles XHTTP/SplitHTTP; mihomo handles Clash extensions
- One-click enterprise VPN: gateway detection → form/OAuth sign-in → tunnel → resources projected as local SOCKS outbounds
- Real latency measurement over the proxy via HTTPS requests, split into TCP/TLS/HTTP phases — TCP port reachability is never presented as availability
- Auto subscription updates and node failover (HTTPS probes through the node); app updates verified by SHA-256
- UI languages: 简体中文 / 繁體中文 / English / Русский / فارسی

## Platform status

- **macOS** (arm64 / x64, DMG), **Windows** (x64, installer and portable), **Linux** (AppImage / deb)
- **Android**: Capacitor + VpnService, embedded sing-box core
- Enterprise VPN and the Xray/mihomo compatibility engines are desktop implementations

## Development and verification

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

`npm run dev` launches the local development build (Vite + Electron) with hot-reload UI; main-process and preload changes need a restart. Real-subscription verification uses private input files outside the repo:

```sh
SHADOW_VPN_SOURCE_FILE=/absolute/private/config.json \
SHADOW_VPN_REPORT=/absolute/private/report.json \
node scripts/verify-live-backend.cjs
```

Never commit subscription URLs, credentials, app data, or test reports to the repository.

## License and provenance

[MIT](LICENSE.txt). Upstream baseline `e0902e8c9aa8a0baa60ae840d5582edd49781b01` (FlowZ 4.3.3); see [README.upstream.md](README.upstream.md). Enterprise runtime source and licenses: [enterprise-runtime/](enterprise-runtime/README.md).
