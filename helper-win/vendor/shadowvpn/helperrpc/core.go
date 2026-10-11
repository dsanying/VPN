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

// InstallMihomo writes only a fixed executable location. Verified bytes are the written bytes.
func InstallMihomo(legacyBinary, source, digest string) error {
	if !filepath.IsAbs(legacyBinary) || len(digest) != 64 {
		return fmt.Errorf("invalid core installation arguments")
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("read core: %w", err)
	}
	sum := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), digest) {
		return fmt.Errorf("core hash mismatch")
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
