//go:build linux

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"shadowvpn/helperrpc"
	"strings"
	"syscall"
	"testing"
	"time"
)

// isAuthorized：授权 uid 列表解析 + root 恒授权 + 缺文件失败安全。
func TestIsAuthorized(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "auth")
	if err := os.WriteFile(f, []byte("1000\n1001\n\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	authFile = f
	for _, uid := range []uint32{1000, 1001} {
		if !isAuthorized(uid) {
			t.Errorf("uid %d 应被授权", uid)
		}
	}
	if isAuthorized(1002) {
		t.Error("uid 1002 不在列表，不应被授权")
	}
	if !isAuthorized(0) {
		t.Error("root(0) 应恒被授权")
	}
	// 缺失授权文件 → 非 root 一律未授权（失败安全），root 仍授权。
	authFile = filepath.Join(dir, "nonexistent")
	if isAuthorized(1000) {
		t.Error("授权文件缺失时非 root 应未授权")
	}
	if !isAuthorized(0) {
		t.Error("授权文件缺失时 root 仍应授权")
	}
}

// ownedBy：属主校验（open+fstat）。
func TestOwnedBy(t *testing.T) {
	f := filepath.Join(t.TempDir(), "x")
	if err := os.WriteFile(f, []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	self := uint32(os.Getuid())
	if ok, err := ownedBy(f, self); err != nil || !ok {
		t.Errorf("本进程 uid 应拥有自建文件: ok=%v err=%v", ok, err)
	}
	if ok, _ := ownedBy(f, self+9999); ok {
		t.Error("错误 uid 不应通过属主校验")
	}
	if ok, err := ownedBy(filepath.Join(t.TempDir(), "none"), self); ok || err == nil {
		t.Error("不存在的路径应返回 false + err")
	}
}

// ssPidRe：从 ss 输出行提取 LISTEN 持有者 pid。
func TestSsPidRe(t *testing.T) {
	line := `LISTEN 0 4096 0.0.0.0:9090 0.0.0.0:* users:(("sing-box",pid=1234,fd=7))`
	m := ssPidRe.FindAllStringSubmatch(line, -1)
	if len(m) != 1 || m[0][1] != "1234" {
		t.Errorf("期望提取 pid=1234，实际 %v", m)
	}
	if got := ssPidRe.FindAllStringSubmatch("no match here", -1); len(got) != 0 {
		t.Errorf("无 pid 行不应匹配，实际 %v", got)
	}
}

func TestUserLogRejectsForeignOwnerAndSymlinks(t *testing.T) {
	dir := t.TempDir()
	uid, gid := uint32(os.Getuid()), uint32(os.Getgid())
	outside := filepath.Join(t.TempDir(), "outside.log")
	if err := os.WriteFile(outside, []byte("preserved"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.log")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if file, err := openUserLog(link, uid, gid); err == nil {
		file.Close()
		t.Fatal("symlink accepted")
	}
	if file, err := openUserLog(outside, uid+1, gid); err == nil {
		file.Close()
		t.Fatal("foreign directory accepted")
	}
	file, err := openUserLog(filepath.Join(dir, "owned.log"), uid, gid)
	if err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	file.Close()
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal(info, err)
	}
	body, err := os.ReadFile(outside)
	if err != nil || string(body) != "preserved" {
		t.Fatal(err, string(body))
	}
}

func TestSlowOwnedChild(t *testing.T) {
	if os.Getenv("SHADOW_LINUX_CHILD") != "1" {
		return
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM)
	fmt.Println("ready")
	<-signals
	time.Sleep(250 * time.Millisecond)
	os.Exit(0)
}

func TestCleanupOnlyOwnedAndWaitsForRestore(t *testing.T) {
	originalAuth := authFile
	defer func() { authFile = originalAuth }()
	uid := uint32(os.Getuid())
	authFile = filepath.Join(t.TempDir(), "authorized")
	if err := os.WriteFile(authFile, []byte(fmt.Sprintf("%d\n%d\n", uid, uid+1)), 0600); err != nil {
		t.Fatal(err)
	}
	foreign := exec.Command("sleep", "30")
	foreign.Args[0] = "sing-box run"
	if err := foreign.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { foreign.Process.Kill(); foreign.Wait() }()
	command := exec.Command(os.Args[0], "-test.run=TestSlowOwnedChild")
	command.Env = append(os.Environ(), "SHADOW_LINUX_CHILD=1")
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 6)
	if _, err := stdout.Read(buf); err != nil {
		command.Process.Kill()
		t.Fatal(err)
	}
	done := make(chan struct{})
	restoring := make(chan struct{})
	allowRestore := make(chan struct{})
	mu.Lock()
	child = command
	childDone = done
	childUID = uid
	stopping = false
	shuttingDown = false
	mu.Unlock()
	go func() {
		command.Wait()
		close(restoring)
		<-allowRestore
		mu.Lock()
		child = nil
		childDone = nil
		stopping = false
		close(done)
		mu.Unlock()
	}()
	defer func() { close(allowRestore); command.Process.Kill(); <-done }()
	request := func(who uint32, method string) string {
		return executeCommand(context.WithValue(context.Background(), peerKey{}, &syscall.Ucred{Uid: who}), method, &helperrpc.Arguments{})
	}
	if response := request(uid+1, "stop"); response != "ERR process-not-owned" {
		t.Fatal(response)
	}
	if response := request(uid, "cleanup"); !strings.HasPrefix(response, "OK stopping ") {
		t.Fatal(response)
	}
	select {
	case <-restoring:
	case <-time.After(3 * time.Second):
		t.Fatal("child did not exit")
	}
	if response := request(uid, "status"); !strings.HasPrefix(response, "OK stopping ") {
		t.Fatal(response)
	}
	if response := request(uid, "start"); response != "ERR stopping" {
		t.Fatal(response)
	}
	if err := syscall.Kill(foreign.Process.Pid, 0); err != nil {
		t.Fatal("foreign process killed", err)
	}
}

func TestConfigFIFORejectedWithoutBlocking(t *testing.T) {
	fifo := filepath.Join(t.TempDir(), "fifo")
	if err := syscall.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	if ok, err := ownedBy(fifo, uint32(os.Getuid())); ok || err == nil {
		t.Fatal("non-regular config allowed", ok, err)
	}
}

func TestFreePortProtectsIndependentSingbox(t *testing.T) {
	directory := t.TempDir()
	// 同 UID、同名的独立进程必须仍是 foreign。
	binary, err := os.ReadFile("/bin/sleep")
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(directory, "sing-box")
	if err := os.WriteFile(executable, binary, 0700); err != nil {
		t.Fatal(err)
	}
	foreign := exec.Command(executable, "30")
	if err := foreign.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { foreign.Process.Kill(); foreign.Wait() }()
	ss := filepath.Join(directory, "ss")
	output := fmt.Sprintf("#!/bin/sh\nprintf 'LISTEN users:((sing-box,pid=%d,fd=7))\\n'\n", foreign.Process.Pid)
	if err := os.WriteFile(ss, []byte(output), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory)
	mu.Lock()
	child = nil
	childDone = nil
	mu.Unlock()
	mu.Lock()
	response := freePort("9090", uint32(os.Getuid()))
	mu.Unlock()
	if !strings.HasPrefix(response, "OK foreign ") {
		t.Fatal(response)
	}
	if err := syscall.Kill(foreign.Process.Pid, 0); err != nil {
		t.Fatal("foreign process killed", err)
	}
	if err := os.WriteFile(ss, []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	response = freePort("9090", uint32(os.Getuid()))
	mu.Unlock()
	if response != "ERR port-probe" {
		t.Fatal("probe failure reported free", response)
	}
}
