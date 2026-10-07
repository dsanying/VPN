# 暗影VPN

基于 [FlowZ](https://github.com/dododook/FlowZ) 的后端修复版，仓库为 [dsanying/VPN](https://github.com/dsanying/VPN)。当前沿用 FlowZ 的 Electron、React 界面和 sing-box 内核，优先解决订阅导入与测速问题。前端重构暂缓。

## 当前改动

- 默认请求标识由 `FlowZ/<版本号>` 改为通用的 `clash.meta`，仅用于向供应商协商订阅格式；实际格式、节点协议由返回内容自动识别。
- 新建订阅默认“自动识别”，同一订阅可混合多个支持的协议。单选“节点协议”可限定导入范围，无匹配时保留原配置及节点。
- 沿用 Clash YAML/JSON、sing-box JSON、Xray JSON、分享链接及 Base64 链接导入。修复 HTTP Host 数组、method 与额外 headers 丢失，保留 WebSocket headers。
- 经真实代理隧道验证 HTTPS 连通性，默认目标失败后使用独立备用目标复核。限制并发为 4，区分连接、TLS、HTTP、超时等失败原因；流量及到期提示条目不参加测速。
- 应用、后台助手、用户数据及应用更新源独立，避免覆盖 FlowZ。私有预览版默认关闭应用更新检查。

测速显示的是同一连接第二次请求的响应延迟，**不是下载带宽**。节点名称中“GPT”“CN2”等文字并不保证服务可用；不支持的配置会被拒绝或报告，不能将全部客户端格式等同于内核完全兼容。

## 开发和验证

```sh
npm ci
npm run build:helper
npm run fetch:core
npm run fetch:dashboard
npm test -- --runInBand
npm run test:core-gate
npm run lint
npx tsc --noEmit -p tsconfig.renderer.json
npm run build
npm run dev
```

真实订阅测试须显式指定仓库外的私有输入文件，其中 `subscriptions` 是含 `url` 的数组。脚本读取供应商原始 URL，不生成中间迁移订阅：

```sh
SHADOW_VPN_SOURCE_FILE=/absolute/private/config.json \
SHADOW_VPN_REPORT=/absolute/private/report.json \
node scripts/verify-live-backend.cjs
```

此脚本使用已构建后端和 macOS ARM64 官方内核，不修改系统代理，报告仅包含聚合计数及失败原因。不要把订阅 URL、凭据、应用数据或测试报告提交到仓库。

## 状态与来源

实测结果和适用范围见 [验证报告](docs/验证报告.md)，实现说明见 [后端修复](docs/后端修复.md)。当前提供 macOS ARM64 本地预览构建，尚未完成 Developer ID 签名、公证以及 Windows/Linux 系统服务真机验收。

上游基线 `e0902e8c9aa8a0baa60ae840d5582edd49781b01`（FlowZ 4.3.3），保留 [MIT 许可证](LICENSE.txt)、[上游说明](README.upstream.md)及[组件来源](NOTICE.md)。
