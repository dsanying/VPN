// 暗影VPN 提权助手：系统服务 + 本机 HTTP JSON-RPC 2.0。
// macOS/Windows 以 Authorization: Bearer 鉴权；Linux 保留 SO_PEERCRED 授权 UID。
// JSON-RPC 由稳定通用库实现；业务方法只启动锁定内核，不向网络开放监听。
package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"shadowvpn/helperrpc"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 助手应用版本；通信标准固定为 JSON-RPC 2.0，功能通过 capabilities 发现。
const helperVersion = helperrpc.Version

// route-add/route-del 安全约束：仅允许 FlowZ 自己的内核接口名（flowz-ts/flowz-wg/flowz-tun0…），杜绝任意接口注入。
func ifaceAllowed(s string) bool {
	if !strings.HasPrefix(s, "flowz-") || len(s) > 24 {
		return false
	}
	for _, c := range s[len("flowz-"):] {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return true
}

var (
	singboxBin string // 安装时锁定的 sing-box 路径
	confDir    string // 允许的配置文件目录
	supportDir string // 命名管道 token 所在目录（SYSTEM 侧）
	// coreDir：Windows 上接受并忽略（镜像 macOS flag 形态，便于 TS 侧统一安装脚本；Windows 无 install-core）。
	coreDir string

	mu           sync.Mutex
	child        *exec.Cmd
	childDone    chan struct{} // Wait 和转发恢复完成后关闭
	stopping     bool
	shuttingDown bool
)

func tokenValue() string {
	b, _ := os.ReadFile(filepath.Join(supportDir, "helper.token"))
	return strings.TrimSpace(string(b))
}

// 配置和日志都以 Windows 实际打开的句柄校验受限目录，拒绝重解析点逃逸。
func cfgAllowed(cfg string) bool {
	file, _, err := openConfinedFile(cfg, false)
	if err != nil {
		return false
	}
	file.Close()
	return true
}

// 必须持 mu；退出完成前保留当前 child，阻止重叠 start。
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

// Windows 服务无控制台，CTRL_BREAK 可能不可达；超时后仅 Kill 自己持有的 Process。
func terminateChild(c *exec.Cmd, done <-chan struct{}) {
	if c == nil || c.Process == nil {
		return
	}
	// 优雅信号：向 child 进程组发 CTRL_BREAK（仅 --console dev 模式有效；服务模式 no-op，由下方硬杀兜底）。
	// 失败（进程已退出/服务模式无 console）无害，由后续超时/done 兜底。
	_ = sendCtrlBreak(c.Process.Pid)
	select {
	case <-done: // 已被 Wait 收割（dev 模式优雅退出），免硬杀
	case <-time.After(2 * time.Second):
		_ = c.Process.Kill()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
		}
	}
}

// 父死看护：托管 child 期间每秒探测父 app 进程，父消失（GUI 崩溃/taskkill/强退 —— 管道 stop 够不到的场景）
// → CTRL_BREAK→硬杀收割 child。对齐 macOS watchParent「父进程死亡→不留孤儿」不变量。
// 退出条件（防 goroutine 泄漏）：child 正常退出（done 关闭）/ 被 stop·cleanup·新 start 摘除（child != c）/ 父死收割完成。
//
// Windows delta：用 OpenProcess + GetExitCodeProcess==STILL_ACTIVE 判父存活，替代 macOS kill(ppid,0)。
// 宁漏勿误：探测出错（句柄打不开等非「确定已死」情形）按存活处理。
func watchParent(ppid int, c *exec.Cmd, done <-chan struct{}) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-done:
			return // child 已退出，看护使命结束
		case <-t.C:
		}
		mu.Lock()
		current := child == c
		mu.Unlock()
		if !current {
			return // 已被 stop/cleanup 摘除或被新 start 替换，收割责任已转移
		}
		// processAlive：仅在「确定父已死」时返回 false；句柄打开失败/查询失败等不确定情形宁可按存活处理（宁漏勿误）。
		if !processAlive(ppid) {
			mu.Lock()
			if child != c { // 与 stop 竞态：他人已摘除则由他收割
				mu.Unlock()
				return
			}
			beginStopLocked()
			mu.Unlock()
			return
		}
	}
}

func executeCommand(_ context.Context, cmd string, args *helperrpc.Arguments) (response string) {
	var output strings.Builder
	conn := &output
	defer func() { response = strings.TrimSpace(output.String()) }()

	mu.Lock()
	defer mu.Unlock()

	switch cmd {
	case "ping":
		// Windows os.Getuid() 返回 -1 会破坏客户端 `uid=\d+` 正则 —— 固定发非负整数 0。
		fmt.Fprintf(conn, "OK pong uid=0 v%s\n", helperVersion)
	case "version":
		fmt.Fprintf(conn, "OK %s\n", helperVersion)
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
		if pid := beginStopLocked(); pid != 0 {
			fmt.Fprintf(conn, "OK stopping %d\n", pid)
		} else {
			fmt.Fprintln(conn, "OK notrunning")
		}
	case "route-add", "route-del":
		// proto v2：出口托管在 System 内核接口装/清拆半默认路由（netsh，store=active 非持久、重启自清）。
		// 约束：iface 白名单（flowz-*）+ net.ParseCIDR 校验。幂等 best-effort，最终由 app 侧校验。
		// Windows 无 ifscope；靠 per-interface 路由 + 内核 metric 选路（与主 TUN 的冲突属真机验证项 #3858）。
		iface := strings.TrimSpace(args.Next())
		cidrsLine := strings.TrimSpace(args.Next())
		if !ifaceAllowed(iface) {
			fmt.Fprintln(conn, "ERR iface-denied")
			break
		}
		op := "add"
		if cmd == "route-del" {
			op = "delete"
		}
		for _, c := range strings.Split(cidrsLine, ",") {
			c = strings.TrimSpace(c)
			if c == "" {
				continue
			}
			if _, _, err := net.ParseCIDR(c); err != nil {
				continue
			}
			fam := "ipv4"
			if strings.Contains(c, ":") {
				fam = "ipv6"
			}
			_ = exec.Command("netsh", "interface", fam, op, "route",
				"prefix="+c, "interface="+iface, "store=active").Run()
		}
		fmt.Fprintln(conn, "OK route")
	case "iface-metric":
		// 退役：自 Windows 禁 System（强制 gVisor）起，客户端不再调用本命令；保留仅为兼容已部署的 proto≥3 helper
		// （删它需强制用户重装）。新客户端 EXPECTED_PROTO 已降回 v1，不再因缺本能力提示升级。
		// proto v3：把 FlowZ 内核接口的接口 metric 设高 —— Windows 根治 System TS 出口劫持。
		// 根因（真机实证）：tsnet 给 flowz-ts 装的 exit 0/0 metric=0，抢过物理网卡 → 把直连/bootstrap DNS
		// （1.12.12.12/223.5.5.5）灌进 TS 出口、源 IP 变 tailnet → SERVFAIL → 解析不出代理节点 → 全网瘫。
		// Windows 无 macOS 的 ifscope 作用域，等价手段是降权该接口：metric 设高 → 其 0/0 输给以太网、直连回物理；
		// tailnet /32 仍按最长前缀命中、出口经 sing-box selector 内部转发给 TS outbound 不依赖这条 OS 0/0。
		// store=active：非持久（接口每次起核重建、app 侧重新下发），不污染持久配置。约束：iface 白名单 + metric∈[0,65535]。
		iface := strings.TrimSpace(args.Next())
		metricLine := strings.TrimSpace(args.Next())
		if !ifaceAllowed(iface) {
			fmt.Fprintln(conn, "ERR iface-denied")
			break
		}
		metric, err := strconv.Atoi(metricLine)
		if err != nil || metric < 0 || metric > 65535 {
			fmt.Fprintln(conn, "ERR bad-metric")
			break
		}
		// 真机实证：`netsh ... set interface metric=N store=active` 不可靠（AutomaticMetric 未关→设了不生效）。改用
		// PowerShell `Set-NetIPInterface`（用户实证有效，自动关 AutomaticMetric 并持久）。两处加固：
		//   ① 全路径调 powershell —— SYSTEM 服务 PATH 可能找不到 `powershell`（exec 直接报 not found→设不上）。
		//   ② 不带 -AddressFamily —— 同时设 IPv4 + IPv6 两族（flowz-ts 若有 ::/0 全隧道出口，IPv6 也会被抢，必须一并降权）。
		// iface 已过 ifaceAllowed 白名单（flowz- + [a-z0-9-]）→ 单引号字符串无注入；metric 为整数。
		psExe := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
		psCmd := fmt.Sprintf(
			"Set-NetIPInterface -InterfaceAlias '%s' -InterfaceMetric %d -ErrorAction Stop",
			iface, metric)
		if err := exec.Command(psExe, "-NoProfile", "-NonInteractive", "-Command", psCmd).Run(); err != nil {
			fmt.Fprintln(conn, "ERR set-metric "+err.Error())
			break
		}
		fmt.Fprintln(conn, "OK iface-metric")
	case "uninstall":
		shuttingDown = true
		c, done := child, childDone
		beginStopLocked()
		fmt.Fprintln(conn, "OK uninstalling")
		go func() {
			if c != nil && c.Process != nil {
				terminateChild(c, done)
			}
			spawnSelfUninstall()
			time.Sleep(800 * time.Millisecond)
			os.Exit(0)
		}()
	case "freeport":
		// TCP表中的所有持有者必须都是当前托管 child，其他实例均为 foreign。
		port := strings.TrimSpace(args.Next())
		if port == "" || strings.IndexFunc(port, func(c rune) bool { return c < '0' || c > '9' }) >= 0 {
			fmt.Fprintln(conn, "ERR bad-port")
			return
		}
		pnum, _ := strconv.Atoi(port)
		if pnum <= 0 || pnum > 65535 {
			fmt.Fprintln(conn, "ERR bad-port")
			return
		}
		pids, err := listenPidsForPort(uint16(pnum))
		if err != nil {
			fmt.Fprintf(conn, "ERR enum %v\n", err)
			return
		}
		if len(pids) == 0 {
			fmt.Fprintln(conn, "OK free")
			return
		}
		for _, pid := range pids {
			if child == nil || child.Process == nil || uint32(child.Process.Pid) != pid {
				fmt.Fprintf(conn, "OK foreign pid:%d\n", pid)
				return
			}
		}
		fmt.Fprintf(conn, "OK stopping %d\n", beginStopLocked())
	case "start":
		cfg := args.Next()
		logPath := args.Next()
		fwd := args.Next()
		// 行6（可选）：父 app PID。旧客户端只发 5 行后即 FIN，此处读到 ""（EOF 不阻塞）→ ppid=0 → 不启看护。
		// 恶意 ppid 无安全增量：看护只会提前杀自家 child，与持 token 者本就有的 stop 权能等价。
		ppid, _ := strconv.Atoi(args.Next())
		if shuttingDown {
			fmt.Fprintln(conn, "ERR shutting-down")
			return
		}
		if child != nil && child.Process != nil {
			if stopping {
				fmt.Fprintln(conn, "ERR stopping")
				return
			}
			fmt.Fprintf(conn, "OK already %d\n", child.Process.Pid)
			return
		}
		if cfg == "" {
			fmt.Fprintln(conn, "ERR no-config")
			return
		}
		if !cfgAllowed(cfg) {
			fmt.Fprintln(conn, "ERR config-path-denied")
			return
		}
		restoreForward := func() error { return nil }
		if fwd == "1" {
			var err error
			restoreForward, err = enableIPForwarding()
			if err != nil {
				fmt.Fprintf(conn, "ERR forwarding %v\n", err)
				return
			}
		}
		c, logFile, configFile, err := startSingbox(singboxBin, cfg, logPath)
		if err != nil {
			if err := restoreForward(); err != nil {
				fmt.Fprintln(os.Stderr, "restore forwarding:", err)
			}
			if logFile != nil {
				logFile.Close()
			}
			fmt.Fprintf(conn, "ERR start %v\n", err)
			return
		}
		// 子进程已在 Start 时继承该句柄；父进程（常驻服务）立即关副本，避免每次启停泄漏句柄。
		if logFile != nil {
			logFile.Close()
		}
		child = c
		done := make(chan struct{})
		childDone = done
		go func() {
			_ = c.Wait()
			configFile.Close()
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
		// 父死看护：覆盖 GUI 崩溃/taskkill 后管道 stop 够不到的孤儿场景。
		if ppid > 0 {
			go watchParent(ppid, c, done)
		}
		fmt.Fprintf(conn, "OK started %d\n", c.Process.Pid)
	default:
		fmt.Fprintln(conn, "ERR unknown")
	}
	return
}

// 服务退出期间禁止 start，并等待当前托管进程及其转发恢复，不枚举其他实例。
func reapChildOnExit() {
	mu.Lock()
	shuttingDown = true
	c, done := child, childDone
	mu.Unlock()
	if c != nil && c.Process != nil {
		terminateChild(c, done)
	}
}
