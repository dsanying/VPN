# 暗影VPN

<div align="center">

<img src="docs/banner.png" width="100%" alt="暗影VPN" />

[简体中文](README.md) · [English](README.en.md) · **繁體中文** · [Русский](README.ru.md) · [فارسی](README.fa.md)

</div>

跨平台代理 / VPN 用戶端。桌面端基於 Electron（React + Ant Design 介面），Android 端基於 Capacitor + VpnService。以 sing-box 為主核，按節點能力自動搭配 Xray / mihomo。基於 FlowZ 持續演進。

## 支援的協定

**代理協定**（分享連結 / 訂閱匯入）

- VLESS、VMess、Trojan、Shadowsocks、ShadowsocksR（經 mihomo）
- Hysteria2、Hysteria v1（經 mihomo）、TUIC、AnyTLS、Snell、Naive
- SOCKS、HTTP、SSH
- 自訂：直接貼上 sing-box outbound JSON，能否啟用由核心探測判定

**組網**

- WireGuard（含 `wireguard://`/`wg://` 分享連結與 Cloudflare WARP 註冊）、Tailscale

**企業 VPN**（桌面端，基於官方/主流上游實作）

- aTrust、EasyConnect —— 經 zju-connect 引擎
- Cisco AnyConnect、Pulse/Ivanti、Juniper Network Connect、GlobalProtect、F5、Fortinet、Array —— 經 OpenConnect 引擎
- 相容性以真實閘道驗證為準，未驗證的廠商不做宣稱。實測與邊界見 [enterprise-runtime/COMPATIBILITY.md](enterprise-runtime/COMPATIBILITY.md)。

## 匯入方式

- 訂閱：Clash YAML/JSON、sing-box JSON、Xray JSON、Base64 連結組；預設自動識別，可限定協定
- 分享連結：`vless` `vmess` `trojan` `hysteria` `hysteria2`/`hy2` `ss` `ssr` `anytls` `snell` `tuic` `naive` `socks5`/`socks` `http(s)` `wireguard`/`wg`
- 部分解析失敗時保留既有節點與失敗項目；未知傳輸不靜默降級為 TCP

## 分流方式

- **接管模式**：系統代理（預設，不改系統 DNS）；TUN 虛擬網卡自動按需接管（應用/程序規則需要時啟用），首頁可強制常開；TUN 可單獨開關系統 DNS 接管
- **智慧分流**：自動識別出口 IP 的國家/地區，同地區直連、其餘代理；識別失敗時暫走代理
- **應用分流**：按已安裝應用/程序設代理、直連、阻斷或指定節點
- **自訂規則**：網域、IP CIDR、GeoIP 規則，規則熱更新不斷線

## 主要功能

- 多核心自動選擇：sing-box 統一接管/路由/DNS/統計；Xray 處理 XHTTP/SplitHTTP；mihomo 處理 Clash 擴充
- 企業 VPN 一鍵接入：閘道識別 → 表單/OAuth 登入 → 隧道 → 按閘道下發資源投影為本地 SOCKS
- 真實延遲測速：經代理發起 HTTPS 請求，區分 TCP/TLS/HTTP 階段；不用 TCP 連接埠連通冒充可用
- 訂閱自動更新、節點自動切換（經節點 HTTPS 探測）；應用更新按 SHA-256 校驗
- 介面語言：简体中文 / 繁體中文 / English / Русский / فارسی

## 平台狀態

- **macOS**（arm64 / x64，DMG）、**Windows**（x64，安裝版與可攜版）、**Linux**（AppImage / deb）
- **Android**：Capacitor + VpnService，內嵌 sing-box 核心
- 企業 VPN 與 Xray/mihomo 相容引擎為桌面實作

## 開發與驗證

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

`npm run dev` 啟動本地開發版（Vite + Electron），介面改動熱更新；主程序與 preload 修改需重啟。真實訂閱驗證使用倉庫外私有輸入檔案：

```sh
SHADOW_VPN_SOURCE_FILE=/absolute/private/config.json \
SHADOW_VPN_REPORT=/absolute/private/report.json \
node scripts/verify-live-backend.cjs
```

不要把訂閱 URL、憑據、應用資料或測試報告提交到倉庫。

## 授權與來源

[MIT](LICENSE.txt)。上游基線 `e0902e8c9aa8a0baa60ae840d5582edd49781b01`（FlowZ 4.3.3），上游說明見 [README.upstream.md](README.upstream.md)。企業執行時期原始碼與授權見 [enterprise-runtime/](enterprise-runtime/README.md)。
