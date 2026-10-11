package helperrpc

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestInstallMihomoUsesVerifiedBytesAndSeparateLocation(t *testing.T) {
	directory := t.TempDir()
	legacy := filepath.Join(directory, "core", "sing-box")
	source := filepath.Join(directory, "fixture-core")
	data := []byte("fictional executable")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if err := InstallMihomo(legacy, source, hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(MihomoPath(legacy))
	if err != nil || string(actual) != string(data) {
		t.Fatalf("unexpected installed bytes: %v", err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatal("legacy core changed")
	}
	if err := os.WriteFile(source, []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := InstallMihomo(legacy, source, hex.EncodeToString(sum[:])); err == nil {
		t.Fatal("unverified replacement accepted")
	}
	actual, _ = os.ReadFile(MihomoPath(legacy))
	if string(actual) != string(data) {
		t.Fatal("failed installation replaced working core")
	}
}

func TestMihomoCommandPaths(t *testing.T) {
	if got := MihomoPath(filepath.Join("locked", "sing-box.exe")); filepath.Base(got) != "mihomo.exe" {
		t.Fatal(got)
	}
	args := MihomoArguments(filepath.Join("user data", "config.json"))
	if len(args) != 4 || args[0] != "-d" || args[2] != "-f" || args[3] != filepath.Join("user data", "config.json") {
		t.Fatal(args)
	}
}
