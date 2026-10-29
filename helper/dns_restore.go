package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// 系统 DNS 接管残留的 helper 侧兜底还原（2026-10-28 事故加固）：GUI 崩溃 / kill -9 / 强退后，父死看护收割
// root sing-box 的同一时刻，系统 DNS 可能仍停在接管的受控 IP（8.8.8.8）——应用已死无人还原，最长残留到
// 下次应用启动（真机事故：残留过夜，内网 API 全断）。helper 是 root 常驻 daemon，不依赖应用活着，收割
// child 后顺手按 marker 还原，把残留窗口从「到下次应用启动」压到 ≈0。
//
// 安全边界（对齐 cfgAllowed / ifaceAllowed 风格）：
//   - marker 路径由 app 在 start 命令第 7 行（可选）传入，旧客户端缺省 "" → 机制不启用（向后兼容）；
//     仅接受「绝对路径 + 不含 .. + 文件名恰为 system-dns.marker.json」；
//   - 还原只调 /usr/sbin/networksetup -setdnsservers，argv 传参无 shell，服务名与 IP 来自 root 可读的
//     marker JSON（应用写入），无注入面；
//   - 空 IP 列表 → 还原为 DHCP（empty），与应用侧还原语义一致；
//   - 仅 darwin 生效：Windows 从不接管系统 DNS（无 marker），Linux 的 DNS 配置挂在自有 TUN 链路上、
//     链路随核消失，均无需此机制；
//   - 全部服务还原成功才删 marker：部分失败保留，留给下次应用启动的启动恢复重试，绝不误删。

// dnsMarkerFile 与应用侧 SystemDnsManager 写入的接管 marker 同构（shared/system-dns.ts）。
type dnsMarkerFile struct {
	ControlledIp string              `json:"controlledIp"`
	Original     map[string][]string `json:"original"`
}

// markerPathAllowed 校验应用传入的 marker 路径。marker 由 root 读、还原结果直接改系统状态，
// 宁可拒绝也不放宽：绝对路径、任何路径段不含 ..、文件名恰为 system-dns.marker.json。
func markerPathAllowed(p string) bool {
	if p == "" || !filepath.IsAbs(p) || strings.Contains(p, "..") {
		return false
	}
	return filepath.Base(p) == "system-dns.marker.json"
}

// buildNetworkSetupArgs 组单条 networksetup -setdnsservers 参数：空列表 → "empty"（还原为 DHCP），
// 非空逐个追加。纯函数，单测锁语义（与应用侧还原行为一致）。
func buildNetworkSetupArgs(service string, ips []string) []string {
	args := []string{"-setdnsservers", service}
	if len(ips) == 0 {
		return append(args, "empty")
	}
	return append(args, ips...)
}

// dnsRestoreRun 执行钩子，测试中替换以断言参数构造、模拟失败。
var dnsRestoreRun = func(args ...string) error {
	return execRun(execTimeout, "/usr/sbin/networksetup", args...)
}

// restoreDnsFromMarker 读 marker 并逐服务还原系统 DNS；全部成功 → 删 marker。任何一步失败都保留
// marker（下次应用启动的启动恢复兜底重试），best-effort 不抛错。非 darwin、路径非法或 marker 缺失
// → 静默 no-op（未接管 / 已还原属正常路径）。
func restoreDnsFromMarker(markerPath string) {
	if runtime.GOOS != "darwin" || !markerPathAllowed(markerPath) {
		return
	}
	data, err := os.ReadFile(markerPath)
	if err != nil {
		return
	}
	var m dnsMarkerFile
	if err := json.Unmarshal(data, &m); err != nil || len(m.Original) == 0 {
		return // 结构损坏 → 不动手也不删，留给应用侧启动恢复处理
	}
	services := make([]string, 0, len(m.Original))
	for svc := range m.Original {
		services = append(services, svc)
	}
	sort.Strings(services) // 确定性顺序，便于测试与排障
	failed := 0
	for _, svc := range services {
		if err := dnsRestoreRun(buildNetworkSetupArgs(svc, m.Original[svc])...); err != nil {
			failed++ // best-effort：单服务失败不阻断其余服务还原
		}
	}
	if failed == 0 {
		_ = os.Remove(markerPath)
	}
}
