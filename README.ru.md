# ShadowVPN (暗影VPN)

<div align="center">

<img src="docs/banner.png" width="100%" alt="ShadowVPN" />

[简体中文](README.md) · [English](README.en.md) · [繁體中文](README.zh-TW.md) · **Русский** · [فارسی](README.fa.md)

</div>

Кроссплатформенный прокси / VPN-клиент. Десктоп построен на Electron (интерфейс React + Ant Design); Android — на Capacitor + VpnService. Основное ядро — sing-box, Xray / mihomo подключаются автоматически по возможностям узла. Проект развивается на базе FlowZ.

## Поддерживаемые протоколы

**Прокси-протоколы** (ссылки / подписки)

- VLESS, VMess, Trojan, Shadowsocks, ShadowsocksR (через mihomo)
- Hysteria2, Hysteria v1 (через mihomo), TUIC, AnyTLS, Snell, Naive
- SOCKS, HTTP, SSH
- Произвольный: вставьте sing-box outbound JSON; пригодность проверяется пробой реального ядра

**Mesh-сети**

- WireGuard (включая ссылки `wireguard://`/`wg://` и регистрацию Cloudflare WARP), Tailscale

**Корпоративный VPN** (десктоп; на базе официальных/мейнстримных апстрим-реализаций)

- aTrust, EasyConnect — движок zju-connect
- Cisco AnyConnect, Pulse/Ivanti, Juniper Network Connect, GlobalProtect, F5, Fortinet, Array — движок OpenConnect
- Совместимость заявляется только по факту проверки на реальном шлюзе. См. [enterprise-runtime/COMPATIBILITY.md](enterprise-runtime/COMPATIBILITY.md).

## Импорт

- Подписки: Clash YAML/JSON, sing-box JSON, Xray JSON, Base64-группы ссылок; автоопределение по умолчанию, можно ограничить протоколом
- Ссылки: `vless` `vmess` `trojan` `hysteria` `hysteria2`/`hy2` `ss` `ssr` `anytls` `snell` `tuic` `naive` `socks5`/`socks` `http(s)` `wireguard`/`wg`
- При частичной ошибке разбора сохраняются существующие узлы и неудачные записи; неизвестные транспорты никогда не деградируют молча до TCP

## Режимы маршрутизации

- **Перехват**: системный прокси (по умолчанию, без изменения системного DNS); TUN-адаптер включается по требованию, когда нужны правила приложений/процессов, либо принудительно; захват системного DNS в TUN отключается отдельно
- **Умная маршрутизация**: страна/регион выходного IP определяется автоматически — направления того же региона идут напрямую, остальные через прокси; при сбое определения — прокси
- **По приложениям**: прокси / напрямую / блокировать / закрепить узел для установленного приложения или процесса
- **Свои правила**: домены, IP CIDR, GeoIP; горячая перезагрузка правил без обрыва

## Основные возможности

- Автоматический выбор ядра: sing-box — перехват/маршрутизация/DNS/статистика; Xray — XHTTP/SplitHTTP; mihomo — расширения Clash
- Корпоративный VPN в один клик: распознавание шлюза → форма/OAuth-вход → туннель → ресурсы шлюза проецируются в локальные SOCKS-узлы
- Реальная измеряемая задержка через прокси (HTTPS-запросы), раздельно TCP/TLS/HTTP; TCP-доступность порта не выдаётся за работоспособность
- Автообновление подписок и автопереключение узлов (HTTPS-пробы через узел); обновления приложения проверяются по SHA-256
- Языки интерфейса: 简体中文 / 繁體中文 / English / Русский / فارسی

## Состояние платформ

- **macOS** (arm64 / x64, DMG), **Windows** (x64, установщик и portable), **Linux** (AppImage / deb)
- **Android**: Capacitor + VpnService, встроенное ядро sing-box
- Корпоративный VPN и совместимые ядра Xray/mihomo — десктопные реализации

## Разработка и проверка

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

`npm run dev` запускает локальную dev-сборку (Vite + Electron) с горячей перезагрузкой интерфейса; изменения main-процесса и preload требуют перезапуска. Проверка на реальных подписках использует приватные файлы вне репозитория:

```sh
SHADOW_VPN_SOURCE_FILE=/absolute/private/config.json \
SHADOW_VPN_REPORT=/absolute/private/report.json \
node scripts/verify-live-backend.cjs
```

Не коммитьте URL подписок, учётные данные, пользовательские данные и отчёты в репозиторий.

## Лицензия и происхождение

[MIT](LICENSE.txt). Апстрим-база `e0902e8c9aa8a0baa60ae840d5582edd49781b01` (FlowZ 4.3.3); см. [README.upstream.md](README.upstream.md). Исходники и лицензии enterprise-runtime: [enterprise-runtime/](enterprise-runtime/README.md).
