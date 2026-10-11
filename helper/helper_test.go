package main

import (
	"context"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"shadowvpn/helperrpc"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestConstrainedFiles(t *testing.T) {
	old := confDir
	defer func() { confDir = old }()
	confDir = t.TempDir()
	outside := t.TempDir()
	cfg := filepath.Join(confDir, "config.json")
	if err := os.WriteFile(cfg, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if !cfgAllowed(cfg) {
		t.Fatal("normal config denied")
	}
	_ = os.WriteFile(filepath.Join(outside, "external.json"), []byte("{}"), 0600)
	_ = os.Symlink(filepath.Join(outside, "external.json"), filepath.Join(confDir, "link.json"))
	_ = os.Symlink(outside, filepath.Join(confDir, "escape"))
	for _, name := range []string{filepath.Join(confDir, "link.json"), filepath.Join(confDir, "escape", "external.json"), confDir, filepath.Join(outside, "external.json"), "relative.json"} {
		if cfgAllowed(name) {
			t.Fatalf("config escaped %s", name)
		}
	}
	_ = os.Symlink(filepath.Join(outside, "external.json"), filepath.Join(confDir, "log-link"))
	if err := os.Link(filepath.Join(outside, "external.json"), filepath.Join(confDir, "log-hardlink")); err != nil {
		t.Fatal(err)
	}
	fifo := filepath.Join(confDir, "fifo")
	if err := syscall.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{filepath.Join(confDir, "log-link"), filepath.Join(confDir, "log-hardlink"), filepath.Join(confDir, "escape", "root.log"), filepath.Join(outside, "root.log"), fifo} {
		file, err := openLog(name)
		if err == nil {
			file.Close()
			t.Fatalf("unsafe log opened %s", name)
		}
	}
	file, err := openLog(filepath.Join(confDir, "normal.log"))
	if err != nil {
		t.Fatal(err)
	}
	info, _ := file.Stat()
	file.Close()
	if info.Mode().Perm() != 0600 {
		t.Fatal("log not private")
	}
	confDir = ""
	if cfgAllowed(cfg) {
		t.Fatal("empty confinement accepted")
	}
}
func TestRootLogOwnership(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires sudo to exercise root-created log ownership")
	}
	uid, err := strconv.Atoi(os.Getenv("SUDO_UID"))
	if err != nil || uid == 0 {
		t.Fatal("requires a non-root SUDO_UID")
	}
	gid, err := strconv.Atoi(os.Getenv("SUDO_GID"))
	if err != nil {
		t.Fatal(err)
	}
	old := confDir
	defer func() { confDir = old }()
	confDir = t.TempDir()
	if err := os.Chown(confDir, uid, gid); err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(confDir, "startup.log")
	if err := os.WriteFile(name, []byte("earlier\n"), 0644); err != nil {
		t.Fatal(err)
	}
	file, err := openLog(name)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.WriteString("current\n"); err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	stat := info.Sys().(*syscall.Stat_t)
	if int(stat.Uid) != uid || int(stat.Gid) != gid || info.Mode().Perm() != 0600 {
		t.Fatalf("log ownership or private permissions incorrect: %+v", stat)
	}
	content, err := os.ReadFile(name)
	if err != nil || string(content) != "earlier\ncurrent\n" {
		t.Fatalf("append history lost: %s, %v", content, err)
	}
}
func TestSlowChild(t *testing.T) {
	if os.Getenv("SHADOW_HELPER_TEST_CHILD") != "1" {
		return
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM)
	<-signals
	time.Sleep(350 * time.Millisecond)
	os.Exit(0)
}
func TestStopWaitsWithoutOverlappingStart(t *testing.T) {
	command := exec.Command(os.Args[0], "-test.run=TestSlowChild")
	command.Env = append(os.Environ(), "SHADOW_HELPER_TEST_CHILD=1")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	mu.Lock()
	child = command
	childDone = done
	stopping = false
	mu.Unlock()
	defer func() { _ = command.Process.Kill(); <-done }()
	go func() {
		_ = command.Wait()
		mu.Lock()
		child = nil
		childDone = nil
		stopping = false
		close(done)
		mu.Unlock()
	}()
	time.Sleep(100 * time.Millisecond)
	response := executeCommand(context.Background(), "stop", &helperrpc.Arguments{})
	if !strings.HasPrefix(response, "OK stopping ") {
		t.Fatal(response)
	}
	response = executeCommand(context.Background(), "status", &helperrpc.Arguments{})
	if !strings.HasPrefix(response, "OK stopping ") {
		t.Fatal("lost pending child", response)
	}
	response = executeCommand(context.Background(), "start", &helperrpc.Arguments{Values: []string{"ignored", "", "0"}})
	if response != "ERR stopping" {
		t.Fatal("overlapping start", response)
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("child not reaped")
	}
	if response := executeCommand(context.Background(), "status", &helperrpc.Arguments{}); response != "OK stopped" {
		t.Fatal(response)
	}
}
