package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// markerPathAllowed：只放行「绝对路径 + 无 .. + 文件名恰为 system-dns.marker.json」。
func TestMarkerPathAllowed(t *testing.T) {
	allowed := []string{
		filepath.Join("/Users/u/Library/Application Support/ShadowVPN", "system-dns.marker.json"),
		"/var/root/system-dns.marker.json",
	}
	for _, p := range allowed {
		if !markerPathAllowed(p) {
			t.Errorf("应放行 %q", p)
		}
	}
	denied := []string{
		"",
		"system-dns.marker.json",                 // 相对路径
		"marker.json",                            // 文件名不符
		"/etc/system-dns.marker.json.bak",        // 后缀拼接
		"/Users/u/../etc/system-dns.marker.json", // 目录穿越
		"/Users/u/evil/system-dns.marker.json/../../x", // .. 混入
	}
	for _, p := range denied {
		if markerPathAllowed(p) {
			t.Errorf("应拒绝 %q", p)
		}
	}
}

// buildNetworkSetupArgs：空列表 → empty（还原 DHCP），非空逐个追加，与应用侧还原语义一致。
func TestBuildNetworkSetupArgs(t *testing.T) {
	if got := buildNetworkSetupArgs("Wi-Fi", nil); strings.Join(got, " ") != "-setdnsservers Wi-Fi empty" {
		t.Errorf("空列表应还原为 empty，got %v", got)
	}
	got := buildNetworkSetupArgs("Ethernet", []string{"10.0.0.1", "10.0.0.2"})
	want := "-setdnsservers Ethernet 10.0.0.1 10.0.0.2"
	if strings.Join(got, " ") != want {
		t.Errorf("got %v, want %v", got, want)
	}
}

// restoreDnsFromMarker：按 marker 逐服务还原、全成功删 marker、任一失败保留 marker 且不再删。
func TestRestoreDnsFromMarker(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "system-dns.marker.json")
	body := `{"controlledIp":"8.8.8.8","original":{"Wi-Fi":[],"USB LAN":["10.0.0.1","10.0.0.2"]},"at":1}`
	if err := os.WriteFile(marker, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	var calls [][]string
	t.Run("全部成功", func(t *testing.T) {
		calls = nil
		dnsRestoreRun = func(args ...string) error {
			calls = append(calls, args)
			return nil
		}
		restoreDnsFromMarker(marker)
		if len(calls) != 2 {
			t.Fatalf("应还原 2 个服务，got %v", calls)
		}
		if strings.Join(calls[0], " ") != "-setdnsservers USB LAN 10.0.0.1 10.0.0.2" {
			t.Errorf("非空 IP 应逐个追加，got %v", calls[0])
		}
		if strings.Join(calls[1], " ") != "-setdnsservers Wi-Fi empty" {
			t.Errorf("空 IP 应还原为 empty，got %v", calls[1])
		}
		if _, err := os.Stat(marker); !os.IsNotExist(err) {
			t.Errorf("全成功后 marker 应删除")
		}
	})

	t.Run("任一失败保留 marker", func(t *testing.T) {
		if err := os.WriteFile(marker, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		calls = nil
		dnsRestoreRun = func(args ...string) error {
			calls = append(calls, args)
			return os.ErrPermission
		}
		restoreDnsFromMarker(marker)
		if len(calls) != 2 {
			t.Fatalf("单服务失败不阻断其余服务还原，got %v", calls)
		}
		if _, err := os.Stat(marker); err != nil {
			t.Errorf("有失败时 marker 必须保留给下次启动恢复重试")
		}
	})

	t.Run("路径非法静默 no-op", func(t *testing.T) {
		calls = nil
		dnsRestoreRun = func(args ...string) error { calls = append(calls, args); return nil }
		restoreDnsFromMarker("/etc/evil.json")
		restoreDnsFromMarker("")
		if len(calls) != 0 {
			t.Errorf("非法路径不得执行任何还原，got %v", calls)
		}
	})

	t.Run("marker 缺失 no-op", func(t *testing.T) {
		calls = nil
		dnsRestoreRun = func(args ...string) error { calls = append(calls, args); return nil }
		restoreDnsFromMarker(filepath.Join(dir, "不存在.json"))
		if len(calls) != 0 {
			t.Errorf("marker 缺失（未接管/已还原）应静默，got %v", calls)
		}
	})
}
