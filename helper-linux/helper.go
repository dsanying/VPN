// 暗影VPN 提权助手：系统服务 + 本机 HTTP JSON-RPC 2.0。
// macOS/Windows 以 Authorization: Bearer 鉴权；Linux 保留 SO_PEERCRED 授权 UID。
// JSON-RPC 由稳定通用库实现；业务方法只启动锁定内核，不向网络开放监听。
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"shadowvpn/helperrpc"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// 助手应用版本；通信标准固定为 JSON-RPC 2.0，功能通过 capabilities 发现。
const helperVersion = helperrpc.Version

// Linux capability 数值（<linux/capability.h>；纯标准库不引 x/sys/unix）。授权集与现役 setcap 一致（不推测削减）。
const (
	capNetBindService = 10
	capNetAdmin       = 12
	capNetRaw         = 13
)

var (
	sockPath string // 监听的 unix socket 路径
	authFile string // 授权 uid 列表文件（root 写；每行一个十进制 uid）
	coreDir  string // root-owned 受管核目录（只跑/只写此目录内的 sing-box，锁定）

	mu           sync.Mutex
	child        *exec.Cmd
	childDone    chan struct{}
	stopping     bool
	shuttingDown bool
	childUID     uint32
)

// coreBin：锁定的受管核路径。start 只跑它，绝不跑客户端指定的任意二进制。
func coreBin() string { return filepath.Join(coreDir, "sing-box") }

// peerCred 取对端进程凭据（SO_PEERCRED）。uid/gid 内核在 connect 时锁定、不可伪造，作鉴权与 setuid 的唯一依据。
func peerCred(conn net.Conn) (*syscall.Ucred, error) {
	uc, ok := conn.(*net.UnixConn)
	if !ok {
		return nil, fmt.Errorf("not a unix conn")
	}
	raw, err := uc.SyscallConn()
	if err != nil {
		return nil, err
	}
	var cred *syscall.Ucred
	var cerr error
	if err := raw.Control(func(fd uintptr) {
		cred, cerr = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	}); err != nil {
		return nil, err
	}
	return cred, cerr
}

// isAuthorized：uid 是否在授权列表。root(0) 恒授权。
func isAuthorized(uid uint32) bool {
	if uid == 0 {
		return true
	}
	data, err := os.ReadFile(authFile)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if n, err := strconv.Atoi(line); err == nil && n >= 0 && uint32(n) == uid {
			return true
		}
	}
	return false
}

// ownedBy：path 存在且属主 == uid（open 后对 fd fstat，杜绝 stat(path) 后被换的 TOCTOU；symlink 跟随到目标）。
func ownedBy(path string, uid uint32) (bool, error) {
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return false, err
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, fmt.Errorf("config-not-regular")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false, fmt.Errorf("no stat_t")
	}
	return stat.Uid == uid, nil
}

// supplementaryGroups：登录用户 uid 的补充组 gid 列表（纯 Go 解析 /etc/group，CGO 关不含 NSS/SSSD）。
// 用于 setuid 拉核时保留补充组——否则 Credential{Uid,Gid} 默认 setgroups(0) 会清掉补充组，使核读不到 group-only
// 资源（如 ssl-cert 组证书 / 组共享规则文件），而直起路径（保留补充组）能读，造成 mode-specific 破坏。查不到→nil
// （退化为默认 setgroups(0)，不比修前差）。
func supplementaryGroups(uid uint32) []uint32 {
	u, err := user.LookupId(strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		return nil
	}
	gidStrs, err := u.GroupIds()
	if err != nil {
		return nil
	}
	gids := make([]uint32, 0, len(gidStrs))
	for _, s := range gidStrs {
		if n, e := strconv.ParseUint(s, 10, 32); e == nil {
			gids = append(gids, uint32(n))
		}
	}
	return gids
}

// installCore：把 app 下载+预检的临时核 srcDir，校验 sha256(srcDir/sing-box)==wantHash 后，root 写入锁定的 coreDir
// （整目录 sing-box + libcronet.so 等配套，逐文件 .new+rename 原子就位 + 清陈旧残留）。只写 coreDir、不接受任意路径。
func installCore(srcDir, wantHash string) string {
	if coreDir == "" {
		return "ERR coredir-unset"
	}
	if srcDir == "" || len(wantHash) != 64 {
		return "ERR bad-args"
	}
	sbData, err := os.ReadFile(filepath.Join(srcDir, "sing-box"))
	if err != nil {
		return "ERR read-singbox " + err.Error()
	}
	sum := sha256.Sum256(sbData)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), wantHash) {
		return "ERR hash-mismatch"
	}
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return "ERR readdir " + err.Error()
	}
	if err := os.MkdirAll(coreDir, 0o755); err != nil {
		return "ERR mkdir " + err.Error()
	}
	srcNames := map[string]bool{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		srcNames[name] = true
		data := sbData
		if name != "sing-box" {
			if data, err = os.ReadFile(filepath.Join(srcDir, name)); err != nil {
				return "ERR read " + name + " " + err.Error()
			}
		}
		dst := filepath.Join(coreDir, name)
		tmp := dst + ".new"
		if err := os.WriteFile(tmp, data, 0o755); err != nil {
			return "ERR write " + name + " " + err.Error()
		}
		if err := os.Rename(tmp, dst); err != nil {
			_ = os.Remove(tmp)
			return "ERR rename " + name + " " + err.Error()
		}
		_ = os.Chmod(dst, 0o755)
	}
	// 清 coreDir 里非本次 srcDir 的旧残留（rollback 后陈旧配套），但保留 helper 自身二进制与非核文件不误删——
	// 仅删曾由 install-core 放入的核配套：保守起见只清 .new 临时件 + 与 sing-box 同类的库残留由 srcNames 判定。
	if old, err := os.ReadDir(coreDir); err == nil {
		for _, e := range old {
			n := e.Name()
			if e.IsDir() || srcNames[n] || strings.HasSuffix(n, ".new") {
				continue
			}
			// 只清核配套（sing-box / lib*.so*），不碰其它（防误删同目录 helper 二进制等）。
			if n == "sing-box" || strings.HasPrefix(n, "lib") {
				_ = os.Remove(filepath.Join(coreDir, n))
			}
		}
	}
	return "OK installed"
}

// 必须持 mu；Wait 和状态恢复完成前保留 child，禁止重叠 start。
func beginStopLocked() int {
	if child == nil || child.Process == nil {
		return 0
	}
	pid := child.Process.Pid
	if !stopping {
		stopping = true
		go terminateChild(child, childDone)
	}
	return pid
}

func terminateChild(c *exec.Cmd, done <-chan struct{}) {
	if c == nil || c.Process == nil {
		return
	}
	_ = c.Process.Signal(syscall.SIGTERM)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = c.Process.Kill()
		select {
		case <-done:
		case <-time.After(time.Second):
		}
	}
}

func watchParent(ppid int, c *exec.Cmd, done <-chan struct{}) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-done:
			return
		case <-t.C:
		}
		mu.Lock()
		current := child == c
		mu.Unlock()
		if !current {
			return
		}
		if err := syscall.Kill(ppid, 0); err == syscall.ESRCH {
			mu.Lock()
			if child != c {
				mu.Unlock()
				return
			}
			beginStopLocked()
			mu.Unlock()
			return
		}
	}
}

var ssPidRe = regexp.MustCompile(`pid=(\d+)`)

// freePort 只回收本服务托管进程；名字和 UID 都不是进程归属凭据。
// 调用方持 mu。
func freePort(port string, callerUID uint32) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ss", "-H", "-ltnp", "sport = :"+port).Output()
	if err != nil {
		return "ERR port-probe"
	}
	matches := ssPidRe.FindAllStringSubmatch(string(out), -1)
	if len(matches) == 0 {
		if strings.TrimSpace(string(out)) != "" {
			return "ERR port-owner-unavailable"
		}
		return "OK free"
	}
	for _, match := range matches {
		pid, err := strconv.Atoi(match[1])
		if err != nil || child == nil || child.Process == nil || child.Process.Pid != pid || (callerUID != 0 && callerUID != childUID) {
			return "OK foreign pid:" + match[1]
		}
	}
	return fmt.Sprintf("OK stopping %d", beginStopLocked())
}

type peerKey struct{}

func executeCommand(ctx context.Context, cmd string, args *helperrpc.Arguments) (response string) {
	var output strings.Builder
	conn := &output
	defer func() { response = strings.TrimSpace(output.String()) }()
	cred, _ := ctx.Value(peerKey{}).(*syscall.Ucred)
	if cred == nil {
		fmt.Fprintln(conn, "ERR peercred")
		return
	}

	switch cmd {
	case "ping":
		fmt.Fprintf(conn, "OK pong uid=%d v%s\n", os.Getuid(), helperVersion)
		return
	case "version":
		fmt.Fprintf(conn, "OK %s\n", helperVersion)
		return
	}

	if !isAuthorized(cred.Uid) {
		fmt.Fprintln(conn, "ERR unauthorized")
		return
	}

	mu.Lock()
	defer mu.Unlock()

	switch cmd {
	case "status":
		if child != nil && child.Process != nil {
			state := "running"
			if stopping {
				state = "stopping"
			}
			fmt.Fprintf(conn, "OK %s %d\n", state, child.Process.Pid)
		} else {
			fmt.Fprintln(conn, "OK stopped")
		}
	case "stop", "cleanup":
		if child != nil && cred.Uid != 0 && cred.Uid != childUID {
			fmt.Fprintln(conn, "ERR process-not-owned")
			return
		}
		if pid := beginStopLocked(); pid != 0 {
			fmt.Fprintf(conn, "OK stopping %d\n", pid)
		} else {
			fmt.Fprintln(conn, "OK notrunning")
		}
	case "freeport":
		port := strings.TrimSpace(args.Next())
		if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
			fmt.Fprintln(conn, "ERR bad-port")
			return
		}
		fmt.Fprintln(conn, freePort(port, cred.Uid))
	case "install-core":
		src := args.Next()
		wantHash := strings.TrimSpace(args.Next())
		fmt.Fprintln(conn, installCore(src, wantHash))
	case "start":
		singbox := strings.TrimSpace(args.Next())
		cfg := args.Next()
		logPath := args.Next()
		fwd := args.Next()
		ppid, _ := strconv.Atoi(args.Next())

		if shuttingDown {
			fmt.Fprintln(conn, "ERR shutting-down")
			return
		}
		if child != nil && child.Process != nil {
			if cred.Uid != 0 && cred.Uid != childUID {
				fmt.Fprintln(conn, "ERR process-not-owned")
				return
			}
			if stopping {
				fmt.Fprintln(conn, "ERR stopping")
				return
			}
			fmt.Fprintf(conn, "OK already %d\n", child.Process.Pid)
			return
		}
		if cfg == "" {
			fmt.Fprintln(conn, "ERR bad-args")
			return
		}
		// 核路径锁：只跑锁定的 root-owned coreDir/sing-box。客户端传的 singbox 必须与之一致（否则拒绝，杜绝
		// 「让 helper 以特权跑任意自有二进制」）。config 必须属于对端 uid（防读别人配置）。
		if filepath.Clean(singbox) != coreBin() {
			fmt.Fprintf(conn, "ERR core-path-denied (want %s)\n", coreBin())
			return
		}
		if _, err := os.Stat(coreBin()); err != nil {
			fmt.Fprintf(conn, "ERR core-missing %v\n", err)
			return
		}
		if ok, e := ownedBy(cfg, cred.Uid); !ok {
			fmt.Fprintf(conn, "ERR config-not-owned %v\n", e)
			return
		}

		c := exec.Command(coreBin(), "run", "-c", cfg)
		// 降权拉核：setuid/setgid 回对端登录用户 + AmbientCaps 保留 CAP_NET_ADMIN/RAW/BIND_SERVICE 建 TUN/改路由。
		// Go runtime 在 fork 后、execve 前编排 keep-caps→setuid→raise ambient（Go≥1.19；真机验证 ambient 继承，见设计 §13）。
		c.SysProcAttr = &syscall.SysProcAttr{
			// Groups 显式填登录用户补充组：否则默认 setgroups(0) 清掉补充组，核读不到 group-only 资源（见 supplementaryGroups）。
			Credential: &syscall.Credential{
				Uid:    cred.Uid,
				Gid:    cred.Gid,
				Groups: supplementaryGroups(cred.Uid),
			},
			AmbientCaps: []uintptr{capNetAdmin, capNetRaw, capNetBindService},
		}
		var logFile *os.File
		if logPath != "" {
			lf, err := openUserLog(logPath, cred.Uid, cred.Gid)
			if err != nil {
				fmt.Fprintf(conn, "ERR log %v\n", err)
				return
			}
			logFile = lf
			c.Stdout = lf
			c.Stderr = lf
		}
		restoreForward := func() error { return nil }
		if fwd == "1" {
			var err error
			restoreForward, err = enableForwarding(forwardingFiles, os.ReadFile, func(name string, value []byte) error { return os.WriteFile(name, value, 0o644) })
			if err != nil {
				if logFile != nil {
					logFile.Close()
				}
				fmt.Fprintf(conn, "ERR forwarding %v\n", err)
				return
			}
		}
		if err := c.Start(); err != nil {
			if logFile != nil {
				logFile.Close()
			}
			if err := restoreForward(); err != nil {
				fmt.Fprintln(os.Stderr, "restore forwarding:", err)
			}
			fmt.Fprintf(conn, "ERR start %v\n", err)
			return
		}
		if logFile != nil {
			logFile.Close()
		}
		child = c
		childUID = cred.Uid
		done := make(chan struct{})
		childDone = done
		go func() {
			_ = c.Wait()
			if err := restoreForward(); err != nil {
				fmt.Fprintln(os.Stderr, "restore forwarding:", err)
			}
			mu.Lock()
			if child == c {
				child, childDone = nil, nil
				stopping = false
			}
			close(done)
			mu.Unlock()
		}()
		if ppid > 0 {
			go watchParent(ppid, c, done)
		}
		fmt.Fprintf(conn, "OK started %d\n", c.Process.Pid)
	default:
		fmt.Fprintln(conn, "ERR unknown")
	}
	return
}
