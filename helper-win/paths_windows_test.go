//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfinedFiles(t *testing.T) {
	old := confDir
	defer func() { confDir = old }()
	confDir = t.TempDir()
	config := filepath.Join(confDir, "config.json")
	if err := os.WriteFile(config, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if !cfgAllowed(config) {
		t.Fatal("normal config denied")
	}
	outside := filepath.Join(t.TempDir(), "outside.log")
	if err := os.WriteFile(outside, []byte("unchanged"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{outside, confDir, "relative.json", config + ":extra"} {
		if cfgAllowed(name) {
			t.Fatal("unsafe config accepted", name)
		}
		if file, _, err := openConfinedFile(name, true); err == nil {
			file.Close()
			t.Fatal("unsafe log accepted", name)
		}
	}
	hardlink := filepath.Join(confDir, "hardlink.log")
	if err := os.Link(outside, hardlink); err != nil {
		t.Fatal(err)
	}
	if file, _, err := openConfinedFile(hardlink, true); err == nil {
		file.Close()
		t.Fatal("hardlink accepted")
	}
	file, _, err := openConfinedFile(filepath.Join(confDir, "normal.log"), true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("normal"); err != nil {
		file.Close()
		t.Fatal(err)
	}
	file.Close()
	body, err := os.ReadFile(outside)
	if err != nil || string(body) != "unchanged" {
		t.Fatal(err, string(body))
	}
	confDir = ""
	if cfgAllowed(config) {
		t.Fatal("empty confdir allowed")
	}
}

func TestConfinedFilePinsConfigIdentity(t *testing.T) {
	old := confDir
	defer func() { confDir = old }()
	confDir = t.TempDir()
	config := filepath.Join(confDir, "config.json")
	if err := os.WriteFile(config, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	file, _, err := openConfinedFile(config, false)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := os.Rename(config, config+".old"); err == nil {
		t.Fatal("config replaced while helper has its handle")
	}
	// 内容写入是正常编辑行为；保持句柄只阻止路径身份被换。
	if err := os.WriteFile(config, []byte(`{"log":{}}`), 0600); err != nil {
		t.Fatal("normal config write blocked", err)
	}
}

func TestConfinedFilesRejectSymlinkEscape(t *testing.T) {
	old := confDir
	defer func() { confDir = old }()
	confDir = t.TempDir()
	outsideDir := t.TempDir()
	target := filepath.Join(outsideDir, "outside.json")
	if err := os.WriteFile(target, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(confDir, "link.json")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	if cfgAllowed(link) {
		t.Fatal("symlink config escape allowed")
	}
	if file, _, err := openConfinedFile(link, true); err == nil {
		file.Close()
		t.Fatal("symlink log escape allowed")
	}
	directoryLink := filepath.Join(confDir, "escape")
	if err := os.Symlink(outsideDir, directoryLink); err != nil {
		t.Fatal(err)
	}
	if cfgAllowed(filepath.Join(directoryLink, "outside.json")) {
		t.Fatal("directory reparse escape allowed")
	}
}
