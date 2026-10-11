# 组件来源

本项目基于 dododook/FlowZ 的 MIT 代码，基线为 e0902e8c9aa8a0baa60ae840d5582edd49781b01。上游版权及完整许可保留于 LICENSE.txt，原说明保留于 README.upstream.md。

随包 sing-box 来自 SagerNet/sing-box 官方发布，使用 core-manifest.json 固定版本与 SHA-256，未修改内核二进制。内核源码及许可见 https://github.com/SagerNet/sing-box ，下载产物随官方归档保留 LICENSE。内核不进入 Git；构建时下载官方版本。

依赖、字体及厂商 Go 库的原许可文件保留在相应目录。本地前端实验分支 prototype 与当前 FlowZ 主分支实现独立，不能将实验验证结果当作本分支的验证。

本轮内核管理 schema 逐字来自 sing-box v1.14.2 的 daemon/started_service.proto，保留上游 GPL-3.0-or-later 许可说明，见 licenses/sing-box-LICENSE.txt；不将这份上游定义标为 MIT。JSON-RPC 服务端采用 creachadair/jrpc2（BSD-3-Clause），vendored 依赖保留各自 LICENSE；客户端采用 json-rpc-2.0。官方面板采用 SagerNet/sing-box-dashboard 已部署构建，来源提交及 SHA-256 记录在 dashboard-manifest.json，资源不入 Git。

当前客户端采用 React、Ant Design、ECharts 的公开 API 与各依赖自己的开源许可。早期本地试验使用了 UniAuth PR #506（ec9a87b03a00fafa23781b2377b58307c985b9cc）的专有模板；其版权声明不授予本项目分发权。2026-10-11 已移除不可达模板源码并重写实际入口、主题生成、共享组件和检查器。主题采用 Ant Design 的公开 defaultAlgorithm/darkAlgorithm，数据色采用 @ant-design/colors 的公开预设。实际替换范围和只读复核边界见 docs/规范/前端实现替换记录.md。历史声明用于记录来源，不作为当前实现的许可，也不把修改摘要当作获得原版权授权。

根目录 LICENSE.txt 适用于保留的 FlowZ 代码，不替代各组件自身的许可。构建及分发须保留实际依赖、字体、补丁与原生内核的许可证和对应源码要求。

日志查看器使用 @melloware/react-logviewer（MPL-2.0）：https://github.com/melloware/react-logviewer 。原组件许可继续适用，本项目为其测量回调添加动画帧调度补丁（web/patches/@melloware__react-logviewer@6.6.0.patch），保留并提供补丁源码及原许可。

兼容内核 Xray-core v26.3.27（XTLS/Xray-core，MPL-2.0）和 mihomo v1.19.32（MetaCubeX/mihomo，GPL-3.0）来自各自官方稳定版，未修改二进制。版本、归档与二进制 SHA-256 固定在 src/shared/compatibility-core-manifest.json；原许可证分别保留在 licenses/xray-LICENSE.txt、licenses/mihomo-LICENSE.txt，未来构建配置包含 licenses 目录。Xray 源码：https://github.com/XTLS/Xray-core/tree/v26.3.27 ；mihomo 源码：https://github.com/MetaCubeX/mihomo/tree/v1.19.32 。辅助内核通过本地 SOCKS 桥接，保持独立进程。

Android 使用官方 sing-box v1.14.3 的 libbox 源码构建（提交 7054cac5124465ffdb145870d7c01885566711b1），不是把桌面可执行文件塞进 APK。固定源码、构建标签、gomobile 与 NDK 版本见 src/shared/android-core-manifest.json，完整构建脚本见 scripts/build-android-core.mjs；android/core-overlay 提供独立、可取消、验证 TLS 与 HTTP 成功状态的节点检测扩展，构建时在临时源码目录应用，固定上游源码保持不变。生成的 AAR 不入 Git。上游 GPL-3.0-or-later 许可保留于 licenses/sing-box-android-LICENSE.txt，源码：https://github.com/SagerNet/sing-box/tree/v1.14.3 。构建同步生成含检测扩展的对应源码归档 sing-box-android-source-<版本>.tar.gz 与摘要凭据 libbox-build.json，发布流程将两者与 APK 一起提供。Android 分发须按 GPL 提供对应源码与构建信息，根目录 MIT 许可不能覆盖此原生组件。VpnService 平台 API 对照官方 SagerNet/sing-box-for-android 项目核验，实际接入代码单独维护。
