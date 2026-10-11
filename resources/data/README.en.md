# Internal routing data

[简体中文](README.md)

Only four core seeds remain: `geoip-cn`, `geosite-cn`, `geosite-geolocation-!cn`, and `geosite-private`. The manifest is `src/main/services/builtin-geo-rulesets.ts`.

Smart routing uses GeoIP data for the detected region; other regions are downloaded on demand in the background. Private domain data supports LAN bypass. Runtime files live in `<userData>/rules/`; failed updates retain valid cached data. A region cannot be enabled when its initial data download fails.

Application routing matches installed executable paths and does not download website or service lists. The old service datasets, catalog, and user resource management have been removed.

Sources: SagerNet sing-geoip and sing-geosite, rule-set branches; private domains from MetaCubeX/meta-rules-dat, sing branch.
