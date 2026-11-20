package helperrpc

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// MihomoPath is independent of legacy core updates, which replace their whole directory.
func MihomoPath(legacyBinary string) string {
	name := "mihomo"
	if strings.EqualFold(filepath.Ext(legacyBinary), ".exe") {
		name += ".exe"
	}
	return filepath.Join(filepath.Dir(legacyBinary), "mihomo-runtime", name)
}

// ErrPinMismatch 表示源核摘要不在安装包 pins 白名单内（SecAudit H1 fail-closed）。
// app 侧据此区分「校验失败」与「需更新 helper 以获取新内核 pin」。
var ErrPinMismatch = fmt.Errorf("core digest not in pins whitelist")

// InstallMihomo writes only a fixed executable location. Verified bytes are the written bytes.
// pins 为 nil 时只走 hash 校验（兼容旧调用方/测试）；helper 侧恒传非 nil 白名单（fail-closed）。
func InstallMihomo(legacyBinary, source, digest string, pins *CorePins) error {
	if !filepath.IsAbs(legacyBinary) || len(digest) != 64 {
		return fmt.Errorf("invalid core installation arguments")
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("read core: %w", err)
	}
	sum := sha256.Sum256(data)
	actualHex := hex.EncodeToString(sum[:])
	if !strings.EqualFold(actualHex, digest) {
		return fmt.Errorf("core hash mismatch")
	}
	if pins != nil && !pins.Allows("mihomo", actualHex) {
		return ErrPinMismatch
	}
	destination := MihomoPath(legacyBinary)
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	temporary := destination + ".new"
	if err := os.WriteFile(temporary, data, 0755); err != nil {
		return err
	}
	defer os.Remove(temporary)
	if err := os.Chmod(temporary, 0755); err != nil {
		return err
	}
	return os.Rename(temporary, destination)
}

func MihomoArguments(config string) []string {
	return []string{"-d", filepath.Join(filepath.Dir(config), "mihomo-state"), "-f", config}
}
