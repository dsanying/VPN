# 企业 VPN 兼容依据与覆盖范围

验收不以用户能否提供每种产品的账号为前提。协议层依据固定版本源码与公开接口接线，并以离线夹具验证认证、参数传递、TLS、隧道资源和生命周期；真实网关属于额外部署验证。协议识别、接口测试、真实端到端验证分别记录，不能相互替代。

## 现有企业 SSL VPN 引擎

| 产品/协议 | 实现来源 | 当前应用接线 | 明确边界 |
| --- | --- | --- | --- |
| Cisco AnyConnect / ocserv | [libopenconnect](https://www.infradead.org/openconnect/anyconnect.html) | 动态表单、分组、账密、隧道、资源、用户态 SOCKS | 不支持浏览器 SSO、客户端证书与 CSD 准入 |
| Juniper Network Connect | [libopenconnect](https://www.infradead.org/openconnect/juniper.html) | 标准动态表单、分组、账密、隧道 | 定制网页、JavaScript、Host Checker 与 IPv6 边界遵循上游；不支持浏览器认证 |
| Pulse / Ivanti | [libopenconnect](https://www.infradead.org/openconnect/pulse.html) | 标准动态表单、账密、隧道 | 不支持 Host Checker、证书与浏览器认证 |
| GlobalProtect | [libopenconnect](https://www.infradead.org/openconnect/globalprotect.html) | 标准表单、门户/网关选项、账密、隧道 | 不支持 SAML 浏览器桥接、HIP 与客户端证书 |
| F5 BIG-IP | [libopenconnect](https://www.infradead.org/openconnect/f5.html) | 标准表单、登录域、账密、隧道 | 不支持任意 JavaScript 登录与 f5-vpn URI |
| Fortinet FortiGate SSL VPN | [libopenconnect](https://www.infradead.org/openconnect/fortinet.html) | 标准表单、账密、可由表单返回的 MFA、PPP 隧道 | 不支持新版非 PPP wire protocol、客户端证书与 SAML 桥接 |
| Array Networks SSL VPN | [libopenconnect](https://www.infradead.org/openconnect/array.html) | 标准账密与隧道 | 上游仅明确基本账密，其他认证方式不支持 |
| aTrust | [zju-connect 固定版本源码](https://github.com/Mythologyli/zju-connect) | 无凭据认证方式发现；按真实登录域选择密码/CAS/OAuth2/短信；验证码、附加认证经统一挑战；用户态 SOCKS | CAS/OAuth2 需要浏览器登录并提交回调 URL；未知私有认证类型不盲试账密 |
| EasyConnect | [zju-connect 固定版本源码](https://github.com/Mythologyli/zju-connect) | 账密、验证码、隧道、资源、用户态 SOCKS | 不支持客户端证书；可识别不等于完整兼容 |

应用选择引擎由 shared/enterprise-vpn.ts 的显式注册表管理，新增协议必须登记来源，不会默认继承另一个引擎。认证发现与运行时挑战共享字段 schema、输出大小限制和保存选项验证。发现缓存复用六小时有效期和 single flight；aTrust 运行时重新读取可用认证方法，失效选择不回退其他登录域。SSO 回调限定原网关 HTTPS origin、已知回调路径和必需凭据参数，不允许将会话提交到其他站点。

## 常见标准 VPN 协议盘点

这些与以上 HTTPS 企业门户不是同一种 wire protocol，不能靠门户页面或扩充名称匹配完成适配。

| 协议 | 公开实现依据 | 支持范围 |
| --- | --- | --- |
| WireGuard | [WireGuard](https://www.wireguard.com/) / 当前已有内核 WireGuard 节点 | 已有节点实现，保留独立配置识别；不是 HTTPS 网关识别 |
| Tailscale | [Tailscale 源码](https://github.com/tailscale/tailscale) / 当前已有内核 endpoint | 已有节点及登录生命周期；不是通用企业门户协议 |
| OpenVPN | [OpenVPN 源码](https://github.com/OpenVPN/openvpn) | 不在支持范围（需要独立引擎、ovpn 配置/证书导入与管理接口） |
| IKEv2/IPsec | [strongSwan](https://docs.strongswan.org/docs/latest/config/IKEv2.html) | 不在支持范围（需要 IKE/EAP/证书配置与平台隧道适配） |
| L2TP/IPsec、SSTP、SoftEther 原生协议 | [SoftEther 文档与源码](https://www.softether.org/spec)、[源码](https://github.com/SoftEtherVPN/SoftEtherVPN) | 不在支持范围（需要独立协议引擎或平台适配；SoftEther 服务端可经其他已支持协议接入） |

订阅分享链接层面：vless/vmess/trojan/ss/ssr/hy2/anytls/snell/tuic/naive/socks/http 之外，新增 `hysteria://`（Hysteria v1，经 mihomo 兼容引擎）与 `wireguard://`/`wg://`（原生 WireGuard 节点）解析与往返导出；`juicity://`、`shadowtls://`、OpenVPN/IKEv2 等不在支持范围（无通行分享格式或需要独立引擎）。

## 参考客户端

以下公开实现的接口与交互设计用作对照参考（仅参考，未复用源码）：

- OpenConnect GUI：引擎与图形交互分离。
- openconnect-sso：Cisco SAML 需要图形浏览器和认证结果交回引擎。
- gp-saml-gui：GlobalProtect SAML 从网关响应取得 username 与 prelogin-cookie 等，再交给 OpenConnect。
- EZ4Connect：aTrust/EasyConnect 使用 zju-connect，并提供认证交互。

## 验证覆盖

- C 适配器离线测试覆盖七种 OpenConnect 协议的调用接线、初始表单、保存分组、交互字段、匿名管道传递 cookie 和证书拒绝。这是应用适配器合同测试，不等同于完整重测上游七种 wire protocol。
- Go 测试验证 aTrust 可用认证方法筛选、选项匹配、唯一选项自动选择、失效域拒绝与 SSO 回调 origin/路径校验。
- TypeScript 测试验证统一发现缓存、选项保存与凭据边界。
- Cisco AnyConnect 与 aTrust 已按真实网关端到端验证：识别、认证（账密 / OAuth2 外部登录）、隧道与本地 SOCKS 投影全链路通过；网关下发的宽泛 CIDR 经应用层过滤仅保留内网与窄前缀公网段。其余厂商仅有适配器契约与上游对齐证据。
- 企业引擎当前为桌面实现（macOS 已验证）；Windows OpenConnect 用户态隧道与 Android 企业引擎不包含在支持范围内。

### TLS 校验作用域（与官方客户端对齐）

- 网关 HTTPS 会话（aTrust auth/config、EasyConnect 登录证书钉扎后的传输）保留完整 CA 校验。
- 厂商隧道面（aTrust SDP 边缘节点 TLS、EasyConnect 协议握手与令牌请求、登录前初始传输）按官方客户端语义不校验 CA：节点使用 Sangfor 自签设备证书，身份由内层 ticket/签名密钥握手承担。这是上游固定提交 `c1f06af` 明示对齐官方客户端的行为；覆盖层不再改动这些位置。
