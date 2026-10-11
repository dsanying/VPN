# 内部分流数据

[English](README.en.md)

仅保留四个核心种子：`geoip-cn`、`geosite-cn`、`geosite-geolocation-!cn`、`geosite-private`。清单见 `src/main/services/builtin-geo-rulesets.ts`。

智能分流根据实际检测到的地区使用对应 GeoIP 数据；其他地区数据由后台按需下载。局域网域名数据用于绕过内网。运行缓存位于 `<userData>/rules/`，后台更新失败时保留有效缓存。首次缺少地区数据且下载失败时不能启用该地区分流。

应用分流按已安装应用的进程路径匹配，不下载网站或服务清单。旧服务数据、资源目录及用户资源管理功能已移除。

来源：SagerNet sing-geoip / sing-geosite 的 rule-set 分支；private 域名数据来自 MetaCubeX/meta-rules-dat 的 sing 分支。
