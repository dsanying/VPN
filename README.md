# 暗影VPN

基于 [FlowZ](https://github.com/dododook/FlowZ) 的后端修复版，仓库为 [dsanying/VPN](https://github.com/dsanying/VPN)。后端采用 Electron / Node.js，以及官方 sing-box、Xray 和 mihomo；前端已迁移为 React + Ant Design + Zustand + i18next，保留简洁的客户端操作方式。当前只做源码本地开发与验证。

## 当前改动

- 前端统一主题、组件、中文与英文文案；八个平级页面，新增和编辑直接使用抽屉，设置按分组直接展示，不增加对象详情页。详见 [前端改造与验证](docs/前端改造.md)。

- 首页实时展示下载/上传曲线、速率和累计量；连接出口图支持按域名/应用切换，完整活动连接可滚动和翻页查看。进程与出口信息缺失时明确标为未识别。
- 默认请求标识由 `FlowZ/<版本号>` 改为通用的 `clash.meta`，仅用于向供应商协商订阅格式；实际格式、节点协议由返回内容自动识别。
- 新建订阅默认“自动识别”，同一订阅可混合多个支持的协议。单选“节点协议”可限定导入范围，无匹配时保留原配置及节点。
- 沿用 Clash YAML/JSON、sing-box JSON、Xray JSON、分享链接及 Base64 链接导入。修复 HTTP Host 数组、method 与额外 headers 丢失，保留 WebSocket headers。
- 分开显示入口 TCP 建连与真实代理 HTTPS 延迟。默认 Google 204，失败后在同一预算内使用 Cloudflare 204 复核，并显示实际备用目标。限制并发为 16，区分连接、TLS、HTTP、超时；流量及到期提示不参加测速。UDP 类协议及无法确认直连路径的 TUN 场景不显示入口数值。
- 常用网站只检测网络连通性，覆盖 YouTube、Instagram 等 16 个站点；有效 HTTP 响应表示可达，显示状态码，仅明确的地区拒绝标为地区受限，不判断登录、播放或网页内容。
- 智能分流自动识别直连网络的国家/地区，使用 SagerNet 国家 IP 规则：同地区目标直连，其余代理；应用与自定义规则优先。无需手选地区或反向设置，识别或规则准备失败时暂走代理。地区来自网络出口，不代表 GPS 物理位置。
- 连接默认自动按需接管：普通使用采用系统代理，不改系统 DNS；有效应用/进程规则需要时自动启用 TUN。首页可强制 TUN，取消后恢复自动判断；断开仍恢复网络，已安装助手继续驻留。设置可单独关闭 TUN 系统 DNS 接管，但局域网 DNS 查询可能绕过隧道。
- 应用分流可直接选择已安装应用，自动匹配安装目录及辅助进程；提供代理、直连、阻断、跟随分流和指定节点，保存时启用全局接管与智能分流，DNS 跟随应用出口。Safari 共用网络进程及容器启动器无法可靠隔离时明确标为不可自动识别，避免伪装成完整支持。
- 自动切换使用经节点的 HTTPS 检测；出口 IP 改用 HTTPS，DNSPod 使用官方域名校验证书；应用更新按官方 SHA-256 校验下载与安装前文件，缺少摘要时拒绝自动安装。
- 运行组件、开发工具与 sing-box 升级至核验时的最新稳定版，助手通信改为标准 JSON-RPC 2.0，修复进程清理和转发恢复。详情见 [依赖升级与助手验证](docs/依赖升级.md)。
- 应用、后台助手、用户数据及应用更新源独立，避免覆盖 FlowZ。私有预览版默认关闭应用更新检查。

测速显示的是同一连接第二次请求的响应延迟，**不是下载带宽**。节点名称中“GPT”“CN2”等文字并不保证服务可用；不支持的配置会被拒绝或报告，不能将全部客户端格式等同于内核完全兼容。

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

使用 `npm run dev` 查看真实客户端；页面、样式和交互修改会自动热更新，无需制作安装包。主进程和 preload 修改需要重新启动开发进程。5172 网页演示入口已移除。

真实订阅测试须显式指定仓库外的私有输入文件，其中 `subscriptions` 是含 `url` 的数组。脚本读取供应商原始 URL，不生成中间迁移订阅：

```sh
SHADOW_VPN_SOURCE_FILE=/absolute/private/config.json \
SHADOW_VPN_REPORT=/absolute/private/report.json \
node scripts/verify-live-backend.cjs
```

此脚本使用已构建后端和 macOS ARM64 官方内核，不修改系统代理，报告仅包含聚合计数及失败原因。不要把订阅 URL、凭据、应用数据或测试报告提交到仓库。

## 状态与来源

实测结果和适用范围见 [验证报告](docs/验证报告.md)，实现说明见 [后端修复](docs/后端修复.md)。前端采用共享 React + Ant Design，桌面为 Electron，Android 为 Capacitor。macOS arm64/x64 DMG、Windows x64 安装版及便携版 EXE 已构建；Mac arm64 已做真实安装包界面验证，尚未完成 Developer ID 签名、公证及 Windows/Intel Mac 原生验收。Android 已接入真实 VpnService、libbox 和 SQLite，但共享页面业务桥及设备验收尚未完成，debug APK 不能当作 VPN 成品。公开 Release 和旧版升级新版的安装验证均未完成。

上游基线 `e0902e8c9aa8a0baa60ae840d5582edd49781b01`（FlowZ 4.3.3），保留 [MIT 许可证](LICENSE.txt)、[上游说明](README.upstream.md)及[组件来源](NOTICE.md)。

### 多内核兼容

按节点能力自动选择执行内核，无需手动切换：sing-box 负责统一接管、路由、DNS、连接统计与测速入口；Xray 处理 XHTTP / SplitHTTP 及原生 Xray 节点；mihomo 处理 SSR 等 Clash 扩展节点。Clash 生态采用 mihomo 内核；v2rayN、Shadowrocket 的链接与配置作为输入格式兼容，不需要启动这些客户端。

支持 XHTTP 的 VLESS / VMess / Trojan 分享链接、Clash xhttp-opts / splithttp-opts、原生 Xray JSON、SSR 分享链接及 Clash SSR；保留传输扩展参数和凭据，不将未知传输改成 TCP。订阅部分解析失败继续保留已有节点。具体边界与验证见 [多内核兼容](docs/多内核兼容.md)。

辅助内核从官方稳定版下载并校验：`npm run fetch:compat-cores`。本地开发 `npm run dev`，内核检查 `npm run test:core-gate`。上述多内核兼容为桌面实现，Android 当前内嵌 sing-box，尚未实现 Xray/mihomo 移动桥接；不能据共享解析器推断所有协议都能在手机执行。
