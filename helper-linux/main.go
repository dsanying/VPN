//go:build linux

package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"shadowvpn/helperrpc"
	"syscall"
)

func main() {
	var console bool
	flag.StringVar(&sockPath, "socket", "/run/shadowvpn/helper.sock", "unix socket path")
	flag.StringVar(&authFile, "authfile", "/var/lib/shadowvpn/authorized-uids", "authorized uid list file (one decimal uid per line)")
	flag.StringVar(&coreDir, "coredir", "/usr/local/lib/shadowvpn/core", "locked root-owned managed core dir (only sing-box here is run; install-core writes only here)")
	flag.BoolVar(&console, "console", false, "run in foreground for dev/test (systemd not required)")
	flag.Parse()

	// socket 目录必须 0755 可被任意登录用户穿越 → app 才能连；socket 本身 0666 + SO_PEERCRED + 授权列表把关。
	sockDir := filepath.Dir(sockPath)
	if err := os.MkdirAll(sockDir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	_ = os.Chmod(sockDir, 0o755)
	_ = os.Remove(sockPath)

	l, err := net.Listen("unix", sockPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	_ = os.Chmod(sockPath, 0o666)

	// SIGTERM/SIGINT 收割器：systemctl stop / 卸载时先发 SIGTERM，退出前先收割 child sing-box 并**等待在途后台收割**
	// （stop 的 terminateChild 跑在 goroutine，若此处直接 os.Exit 会杀掉它、留下带 CAP_NET_ADMIN 的孤儿核）。
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigCh
		mu.Lock()
		shuttingDown = true
		c, done := child, childDone
		mu.Unlock()
		if c != nil && c.Process != nil {
			terminateChild(c, done) // 同步收割当前 child（TERM→≤5s→KILL）
		}
		_ = l.Close()
		os.Exit(0)
	}()

	if console {
		fmt.Printf("FlowZ linux helper (console) listening on %s, coredir=%s, proto v%s\n", sockPath, coreDir, helperVersion)
	}
	methods := []string{"ping", "version", "status", "start", "stop", "cleanup", "freeport", "install-core"}
	authorize := func(r *http.Request) bool {
		cred, _ := r.Context().Value(peerKey{}).(*syscall.Ucred)
		return cred != nil && isAuthorized(cred.Uid)
	}
	connContext := func(ctx context.Context, conn net.Conn) context.Context {
		cred, _ := peerCred(conn)
		return context.WithValue(ctx, peerKey{}, cred)
	}
	if err := helperrpc.Serve(l, helperrpc.NewHandler(methods, authorize, executeCommand), connContext); err != nil {
		fmt.Fprintln(os.Stderr, err)
	}

}
