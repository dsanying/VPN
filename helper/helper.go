// 暗影VPN 提权助手：系统服务 + 本机 HTTP JSON-RPC 2.0。
// macOS/Windows 以 Authorization: Bearer 鉴权；Linux 保留 SO_PEERCRED 授权 UID。
// JSON-RPC 由稳定通用库实现；业务方法只启动锁定内核，不向网络开放监听。
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"shadowvpn/helperrpc"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// 助手应用版本；通信标准固定为 JSON-RPC 2.0，功能通过 capabilities 发现。
const helperVersion = helperrpc.Version

var (
	singboxBin string // 安装时锁定的 sing-box 路径
	confDir    string // 允许的配置文件目录
	supportDir string // socket + token 所在目录
	coreDir    string // 安装时锁定的受保护内核目录（install-core 只写此目录，防写任意路径）

	mu        sync.Mutex
	child     *exec.Cmd
	childDone chan struct{} // Wait、运行目录回收完成后关闭
	stopping  bool          // 停止期间保留 child，防止新旧内核重叠
)

// 恢复本会话实际改变过的 forwarding 键；原值已为 1 时不抢其他应用的状态。
func enableForwarding() (func(), error) {
	changed := []string{}
	restore := func() {
		for _, key := range changed {
			current, err := execOutput(execTimeout, "/usr/sbin/sysctl", "-n", key)
			if err == nil && strings.TrimSpace(string(current)) == "1" {
				_ = execRun(execTimeout, "/usr/sbin/sysctl", "-w", key+"=0")
			}
		}
	}
	for _, key := range []string{"net.inet.ip.forwarding", "net.inet6.ip6.forwarding"} {
		previous, err := execOutput(execTimeout, "/usr/sbin/sysctl", "-n", key)
		if err != nil {
			restore()
			return func() {}, err
		}
		value := strings.TrimSpace(string(previous))
		if value != "0" && value != "1" {
			restore()
			return func() {}, fmt.Errorf("invalid forwarding state")
		}
		if value == "0" {
			if err := execRun(execTimeout, "/usr/sbin/sysctl", "-w", key+"=1"); err != nil {
				restore()
				return func() {}, err
			}
			changed = append(changed, key)
		}
	}
	return restore, nil
}

func tokenValue() string {
	b, _ := os.ReadFile(filepath.Join(supportDir, "helper.token"))
	return strings.TrimSpace(string(b))
}

// exec 超时上限：所有阻塞式 root 命令一律经下面三个包装执行，绝不裸调 exec.Command().Run/Output。
// 根因：handle 持全局 mu 同步跑这些命令，任一命令无限挂起（stale NFS 下 lsof、异常 route 等）会持锁不放 →
// 并发 ping/status/start/stop 全阻塞在 mu.Lock() → 整个 helper 冻死。用 CommandContext+超时把「无限挂起」
// 降级为「有界失败」：超时即 kill 子进程、返回非 nil error（各调用方沿用原有「忽略 / 上报」错误路径不变）。
const (
	execTimeout     = 8 * time.Second  // 常规系统命令（route/lsof/ps/sysctl/dscacheutil/killall/pkill/kill/xattr）：够慢盘完成、又防 stale 挂载无限阻塞
	codesignTimeout = 30 * time.Second // codesign --deep 对大二进制签名较慢，给更长窗口
)

// execRun：带超时执行并等待完成（等价 cmd.Run()）。超时 → context 取消 → 子进程被 kill，返回非 nil error。
func execRun(d time.Duration, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).Run()
}

// execOutput：带超时执行并捕获 stdout（等价 cmd.Output()）。
func execOutput(d time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).Output()
}

// execCombined：带超时执行并捕获合并输出（等价 cmd.CombinedOutput()）。
func execCombined(d time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// installCore（proto v5）：把 app 下载+预检的临时内核 src，校验 sha256(实际读到的字节)==wantHash 后，root 写入
// 锁定的受保护目录 coreDir（整个源目录复制 + 主二进制签名 + 清 quarantine）。
//   - 只写锁定的 coreDir（filepath.Join，不接受任意路径）→ 防「持 token 写任意 root 路径」。
//   - 哈希校验主二进制 sing-box（堵 TOCTOU：读全字节进内存，校验+写同一份；攻击者读后替换无效，读前替换则 hash
//     不符被拒）。与 token（通道鉴权）互补两层。libcronet 等配套随目录复制（同一可信源 + token 保护，未逐文件 hash，
//     残余 LOW，可后续补）。
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
	// 整个源目录（sing-box + libcronet 等配套）逐文件 .new + rename 原子就位到受保护目录。
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		data := sbData
		if name != "sing-box" {
			data, err = os.ReadFile(filepath.Join(srcDir, name))
			if err != nil {
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
	// A-m2：清理受保护目录多余文件（非本次 srcDir entries 的旧核残留），防 rollback 后残留陈旧配套。
	srcNames := make(map[string]bool)
	for _, e := range entries {
		if !e.IsDir() {
			srcNames[e.Name()] = true
		}
	}
	if oldEntries, err := os.ReadDir(coreDir); err == nil {
		for _, e := range oldEntries {
			if !e.IsDir() && !srcNames[e.Name()] {
				_ = os.Remove(filepath.Join(coreDir, e.Name()))
			}
		}
	}
	// macOS：清整个受保护目录 quarantine + 对主二进制 adhoc 签名（否则 Gatekeeper 对新放入未签名二进制 SIGKILL）
	sb := filepath.Join(coreDir, "sing-box")
	_ = execRun(execTimeout, "/usr/bin/xattr", "-cr", coreDir)
	_ = execRun(codesignTimeout, "/usr/bin/codesign", "--force", "--deep", "-s", "-", sb)
	return "OK installed"
}

// chownRuntimeDirs（proto v6 行为）：把 sing-box 运行时写入的 userData 子目录（tailscale state /
// singbox-dashboard / external_ui）属主**归还登录用户**。helper 以 root 跑 sing-box，tsnet 等会把这些文件
// 创建成 root 600 → 之后以登录用户（系统代理模式）跑 sing-box 时 open 不了 → endpoint post-start
// `permission denied` 拖垮整个启动（即便没选 tailscale 节点，它在 endpoints[] 里也会被 post-start）。
// 每次 child 退出后调用 → 属主恒为登录用户（confDir=app 数据目录、属主即登录用户），根治跨提权态属主冲突，
// 且**不丢 Tailscale 登录态**（chown 保留 state、非删除）。绝不阻断、单项失败即跳过。
func chownRuntimeDirs() {
	if confDir == "" {
		return
	}
	fi, err := os.Stat(confDir)
	if err != nil {
		return
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return
	}
	uid, gid := int(st.Uid), int(st.Gid)
	if uid == 0 {
		return // confDir 本身属 root（异常）→ 不动，避免把运行时目录误归到 root
	}
	for _, name := range []string{"tailscale", "singbox-dashboard", "ui"} {
		chownTree(filepath.Join(confDir, name), uid, gid)
	}
}

// chownTree：递归把树里**仍属 root**的条目 Lchown 到 (uid,gid)。尽力而为——目录不存在/读不了即跳过，
// 绝不返回错误中断遍历。guard：只动 uid==0 的条目（root 跑 sing-box 留下的），已是登录用户属主的不再 Lchown
// → 避免每次 TUN 起停周期对可能很大的树做无谓全量 Lchown（filepath.Walk 用 Lstat，info 即条目自身属性，不跟随符号链接）。
func chownTree(root string, uid, gid int) {
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info == nil {
			return nil
		}
		// 仅 root 写入的条目才归还属主；非 root（已是登录用户）跳过，省掉无谓 Lchown。
		// 拿不到底层 Stat_t（理论上不该发生）时保守归还，维持原「确保属主稳定」语义。
		if st, ok := info.Sys().(*syscall.Stat_t); !ok || st.Uid == 0 {
			_ = os.Lchown(p, uid, gid)
		}
		return nil
	})
}

// cfg 必须位于 confDir 内（清洗后前缀匹配），防止越权指定任意路径作 root 配置。
// 路径必须是允许目录内的绝对路径，解析软链接后仍在目录内；空 confDir 不放行。
func pathAllowed(name string) bool {
	if confDir == "" || !filepath.IsAbs(name) {
		return false
	}
	base, err := filepath.EvalSymlinks(confDir)
	if err != nil {
		return false
	}
	base, err = filepath.Abs(base)
	if err != nil {
		return false
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(name))
	if err != nil {
		return false
	}
	parent, err = filepath.Abs(parent)
	if err != nil {
		return false
	}
	resolved := filepath.Join(parent, filepath.Base(name))
	rel, err := filepath.Rel(base, resolved)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func cfgAllowed(cfg string) bool {
	if !pathAllowed(cfg) {
		return false
	}
	info, err := os.Lstat(cfg)
	return err == nil && info.Mode().IsRegular()
}

func openLog(name string) (*os.File, error) {
	if !pathAllowed(name) {
		return nil, fmt.Errorf("log-path-denied")
	}
	// O_NOFOLLOW 防最终条目被替换成软链接；Fstat 防向设备/FIFO 写 root 输出。
	fd, err := syscall.Open(name, syscall.O_CREAT|syscall.O_WRONLY|syscall.O_APPEND|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0o600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), name)
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, fmt.Errorf("log-not-regular")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Nlink != 1 {
		file.Close()
		return nil, fmt.Errorf("log-hardlink-denied")
	}
	return file, nil
}

// 必须持 mu；托管进程真正 Wait 完成前保持可观察，不允许新 start 穿过停止窗口。
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

// route-add/route-del 安全约束：仅允许 FlowZ 自己的内核接口名 + macOS 动态 utunN，杜绝任意接口注入。
func ifaceAllowed(s string) bool {
	if s == "flowz-ts" || s == "flowz-wg" {
		return true
	}
	if !strings.HasPrefix(s, "utun") {
		return false
	}
	rest := s[4:]
	if rest == "" || len(rest) > 3 {
		return false
	}
	for _, c := range rest {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// TERM→等≤5s→KILL 收割 child：先给 sing-box 优雅窗口（拆 utun/路由/DNS），超时未退则强杀。
// 必须不持 mu 调用；停止期间仍保留 child，Wait 完成后才清除状态。
// 实际信号只经 c.Process 发出：Wait() 收割后 Signal/Kill 返回 ErrProcessDone 不发信号 → 天然防 PID 复用误杀。
func terminateChild(c *exec.Cmd, done <-chan struct{}) {
	if c == nil || c.Process == nil {
		return
	}
	_ = c.Process.Signal(syscall.SIGTERM)
	select {
	case <-done: // 已被 Wait 收割（优雅退出），免 KILL
	case <-time.After(5 * time.Second):
		_ = c.Process.Kill() // 仅操作自己持有的 Process，避免按名字/PID 扫杀
		select {
		case <-done:
		case <-time.After(time.Second):
		}
	}
}

// startTimeViaSysctl 启动时对自身 PID 探测一次，终身锁定取启动时间的机制（sysctl 或 ps lstart）。
// 机制绝不中途切换：若 sysctl 快照后某次 tick 转用 ps，两种格式必不等 → watchParent 误判「父已死」
// → 错杀存活父进程的 root sing-box。锁定后 sysctl 偶发失败只会返 ""（跳过本轮比对，保守安全）。
var startTimeViaSysctl = sync.OnceValue(func() bool {
	return procStartTimeOS(os.Getpid()) != ""
})

// procStartTime 取 pid 进程的启动时间字符串，用作进程唯一身份：同一 PID 若被复用，新进程的启动时间必不同。
// darwin 用 sysctl kern.proc.pid（微秒精度，见 proc_starttime_darwin.go）——消除 `ps lstart` 秒级精度下
// 「同秒 PID 复用」的假阴性窗口；非 darwin（或 sysctl 不可用的异常环境）用 `ps -o lstart=`（秒级兜底）。
// watchParent 据此识破「父 kill -9 后 PID 被复用 → kill(ppid,0) 返回 nil」的假阴性，避免把 root sing-box 漏成孤儿。
// 取不到（进程已退出/取数失败/超时）返回 ""，调用方按「空则不比对」保守处理，绝不据此误杀真父。exec 已带超时。
func procStartTime(pid int) string {
	if startTimeViaSysctl() {
		return procStartTimeOS(pid)
	}
	out, err := execOutput(execTimeout, "/bin/ps", "-o", "lstart=", "-p", strconv.Itoa(pid))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// 父死看护：托管 child 期间每秒探测父 app 进程，父消失（GUI 崩溃/kill -9/强退 —— socket stop 够不到的场景）
// → TERM→KILL 收割 child。对齐旧 osascript 看护脚本「父进程死亡→不留孤儿」不变量（修复设计根因 B）。
// ppidStart=启动时快照的父进程启动时间（唯一身份），用于识破 PID 复用假阴性（见下 dead 判定）。
// 退出条件（防 goroutine 泄漏）：child 正常退出（done 关闭）/ 被 stop·cleanup·新 start 摘除（child != c）/ 父死收割完成。
func watchParent(ppid int, ppidStart string, c *exec.Cmd, done <-chan struct{}) {
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
		// 父死判定两路：
		//  1) kill(ppid,0)==ESRCH：该 PID 当前无进程 = 父已死。其余错误（root 不应见 EPERM）按存活处理，宁漏勿误。
		//  2) kill(ppid,0)==nil 但启动时间变了：父 kill -9 后 PID 在 tick 间隙被别的进程复用 → kill(ppid,0) 假阴性
		//     （误判父存活 → 永不收割 root sing-box → 孤儿）。比对启动时间与启动快照，不符 = 原父已死。
		//     取不到当前启动时间（ps 失败/超时，cur=="")或未记录快照（ppidStart=="")则不据此判死，保守维持存活，不误杀真父。
		dead := false
		if err := syscall.Kill(ppid, 0); err == syscall.ESRCH {
			dead = true
		} else if err == nil && ppidStart != "" {
			if cur := procStartTime(ppid); cur != "" && cur != ppidStart {
				dead = true
			}
		}
		if dead {
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

// 只回收本服务托管且占用目标端口的 child。其他客户端的 sing-box 也属于 foreign。
func handleFreeport(conn io.Writer, args *helperrpc.Arguments) {
	port, err := strconv.Atoi(strings.TrimSpace(args.Next()))
	if err != nil || port < 1 || port > 65535 {
		fmt.Fprintln(conn, "ERR bad-port")
		return
	}
	out, err := execOutput(execTimeout, "/usr/sbin/lsof", "-ti", "tcp:"+strconv.Itoa(port), "-sTCP:LISTEN")
	if err != nil {
		// lsof 无匹配时退出 1；工具错误不能冒充空闲。
		if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 1 {
			fmt.Fprintln(conn, "ERR port-probe")
			return
		}
	}
	pids := strings.Fields(string(out))
	if len(pids) == 0 {
		fmt.Fprintln(conn, "OK free")
		return
	}
	mu.Lock()
	defer mu.Unlock()
	for _, p := range pids {
		pid, err := strconv.Atoi(p)
		if err != nil || child == nil || child.Process == nil || child.Process.Pid != pid {
			fmt.Fprintf(conn, "OK foreign pid:%s\n", p)
			return
		}
	}
	pid := beginStopLocked()
	fmt.Fprintf(conn, "OK stopping %d\n", pid)
}

func executeCommand(_ context.Context, cmd string, args *helperrpc.Arguments) (response string) {
	var output strings.Builder
	conn := &output
	defer func() { response = strings.TrimSpace(output.String()) }()

	// freeport 只做 lsof/ps 只读探测 + kill 端口占用者，完全不碰 child/childDone（mu 只护这两者）→ 先于加锁
	// 独立处理、移出临界区，避免其 exec（stale 挂载下 lsof 可能阻塞到超时上限）在临界区内拖住并发的
	// ping/status/start/stop（参照 stop 后台化的去饿死思路）。自身各 exec 已带超时兜底。
	if cmd == "freeport" {
		handleFreeport(conn, args)
		return
	}

	mu.Lock()
	defer mu.Unlock()

	switch cmd {
	case "ping":
		fmt.Fprintf(conn, "OK pong uid=%d v%s\n", os.Getuid(), helperVersion)
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
		// 不再 pkill：父死看护与退出收割负责托管进程，外部进程不属于本服务。
		if pid := beginStopLocked(); pid != 0 {
			fmt.Fprintf(conn, "OK stopping %d\n", pid)
		} else {
			fmt.Fprintln(conn, "OK notrunning")
		}
	case "route-add", "route-del":
		// proto v7：出口托管在 System 内核接口上装/清 ifscope 拆半默认路由（sing-box 不为 TS exit_node 装、
		// 真机实证）。约束：iface 白名单（flowz-ts/flowz-wg/utunN）+ net.ParseCIDR 校验，杜绝注入。
		// ifscope 作用域到该接口 → 只服务绑该接口的 dialer，不抢主表默认路由（与主 TUN 共存）。幂等 best-effort，
		// add 忽略 file-exists、delete 忽略 not-in-table；最终由 app 侧 netstat 校验。
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
				continue // 非法 CIDR 跳过（防注入）
			}
			args := []string{"-n", op}
			if strings.Contains(c, ":") {
				args = append(args, "-inet6")
			}
			args = append(args, "-ifscope", iface, "-net", c, "-interface", iface)
			_ = execRun(execTimeout, "/sbin/route", args...)
		}
		fmt.Fprintln(conn, "OK route")
	case "default-restore":
		// proto v8：补回被 sing-tun setRoutes EEXIST 善后误删的 en0 全局默认路由（system WG 全隧道场景，停核后断网）。
		// 行3=网关 IPv4（app 起核前快照 `route -n get default` 得到）。约束：net.ParseIP+To4 校验，杜绝注入任意参数。
		// best-effort：app 仅在检测到全局 default 缺失时才调本命令；若 default 已存在则 `route add` 无害失败、忽略。
		gw := strings.TrimSpace(args.Next())
		if ip := net.ParseIP(gw); ip == nil || ip.To4() == nil {
			fmt.Fprintln(conn, "ERR bad-gateway")
			break
		}
		_ = execRun(execTimeout, "/sbin/route", "-n", "add", "-inet", "default", gw)
		fmt.Fprintln(conn, "OK default-restore")
	case "flush-dns":
		// proto v9：root 刷系统 DNS 缓存——dscacheutil 清 Directory Services 缓存 + HUP mDNSResponder 清 unicast
		// resolver 缓存（用户级 dscacheutil 无权 HUP，清不到后者）。app 在核 start/stop 后 best-effort 调用，
		// 清掉「系统解析器受控/还原」边界另一侧的陈旧记录（如 TUN+FakeIP 会话缓存的假 IP 骑跨到直连态）。
		// 两命令均瞬时完成、无参数注入面。dscacheutil 失败回 ERR（app 降级用户级 dscacheutil 有意义）；
		// dscacheutil 成功而 HUP 失败回 OK flushed-partial（app 不降级——用户级同样无权 HUP，重复无益）。
		if out, err := execCombined(execTimeout, "/usr/bin/dscacheutil", "-flushcache"); err != nil {
			fmt.Fprintf(conn, "ERR dscacheutil %v %s\n", err, strings.TrimSpace(string(out)))
			break
		}
		if out, err := execCombined(execTimeout, "/usr/bin/killall", "-HUP", "mDNSResponder"); err != nil {
			fmt.Fprintf(conn, "OK flushed-partial killall-hup %v %s\n", err, strings.TrimSpace(string(out)))
			break
		}
		fmt.Fprintln(conn, "OK flushed")
	case "start":
		cfg := args.Next()
		logPath := args.Next()
		fwd := args.Next()
		// 行6（可选）：父 app PID。旧客户端只发 5 行后即 FIN，此处读到 ""（EOF 不阻塞）→ ppid=0 → 不启看护。
		// 恶意 ppid 无安全增量：看护只会提前杀自家 child，与持 token 者本就有的 stop 权能等价。
		ppid, _ := strconv.Atoi(args.Next())
		// 启动时快照父进程启动时间（唯一身份）：watchParent 每轮除 kill(ppid,0) 存活探测外再比对它，
		// 识破「父 kill -9 后 PID 被复用 → kill(ppid,0) 假阴性」→ 防 root sing-box 漏成孤儿（修复 2）。
		// 取不到（快照失败）为空 → watchParent 退化为仅 kill(ppid,0) 探测（原语义），不误杀真父。
		var ppidStart string
		if ppid > 0 {
			ppidStart = procStartTime(ppid)
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

		c := exec.Command(singboxBin, "run", "-c", cfg)
		// sing-box 早期 stdout/stderr 重定向到 app 日志文件（与 osascript 看护脚本一致），便于诊断启动问题。
		var logFile *os.File
		if logPath != "" {
			lf, err := openLog(logPath)
			if err != nil {
				fmt.Fprintf(conn, "ERR log %v\n", err)
				return
			}
			logFile = lf
			c.Stdout = lf
			c.Stderr = lf
		}
		restoreForward := func() {}
		if fwd == "1" {
			var err error
			restoreForward, err = enableForwarding()
			if err != nil {
				if logFile != nil {
					logFile.Close()
				}
				fmt.Fprintf(conn, "ERR forwarding %v\n", err)
				return
			}
		}
		if err := c.Start(); err != nil {
			restoreForward()
			if logFile != nil {
				logFile.Close()
			}
			fmt.Fprintf(conn, "ERR start %v\n", err)
			return
		}
		// 子进程已在 Start 时 dup 该 fd；父进程（常驻 daemon）立即关副本，避免每次启停泄漏 fd。
		if logFile != nil {
			logFile.Close()
		}
		child = c
		done := make(chan struct{})
		childDone = done
		go func() {
			_ = c.Wait()
			restoreForward()
			// proto v6：root 跑的 sing-box 退出后，把运行时目录（tailscale state / dashboard / ui）属主归还
			// 登录用户 → 下次以登录用户（系统代理模式）跑能直接读、不再 FATAL，且不丢 Tailscale 登录态。
			// 放 Wait() 之后确保文件已不被 sing-box 占用、属主稳定。
			chownRuntimeDirs()
			mu.Lock()
			if child == c {
				child, childDone = nil, nil
				stopping = false
			}
			close(done)
			mu.Unlock()
		}()
		// 父死看护（proto v2）：覆盖 GUI 崩溃/kill -9 后 stopCore 够不到的孤儿场景。
		if ppid > 0 {
			go watchParent(ppid, ppidStart, c, done)
		}
		fmt.Fprintf(conn, "OK started %d\n", c.Process.Pid)
	case "install-core":
		// 行3=临时内核源路径（app 下载+预检后，用户可写区）；行4=期望 sha256（hex）。helper 校验哈希后 root 写锁定
		// 的受保护目录。与 child/TUN 进程无关，仅文件写入。
		src := args.Next()
		wantHash := strings.TrimSpace(args.Next())
		fmt.Fprintln(conn, installCore(src, wantHash))
	default:
		fmt.Fprintln(conn, "ERR unknown")
	}
	return
}

func main() {
	flag.StringVar(&singboxBin, "singbox", "", "path to sing-box binary (locked at install time)")
	flag.StringVar(&confDir, "confdir", "", "allowed config directory")
	flag.StringVar(&supportDir, "support", "/Library/Application Support/ShadowVPN", "dir holding helper.sock + helper.token")
	flag.StringVar(&coreDir, "coredir", "", "locked protected core dir for install-core (proto v5)")
	flag.Parse()

	if err := os.MkdirAll(supportDir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// 纵深防御：MkdirAll 对已存在目录不改权限；确保 supportDir 可被普通用户穿越（否则 app 连 socket EACCES）。
	_ = os.Chmod(supportDir, 0o755)
	sockPath := filepath.Join(supportDir, "helper.sock")
	_ = os.Remove(sockPath)
	l, err := net.Listen("unix", sockPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	_ = os.Chmod(sockPath, 0o666) // token 为安全边界

	// SIGTERM/SIGINT 收割器（proto v3）：卸载 / launchctl bootout 时 launchd 先发 SIGTERM（默认 ~20s 后才 SIGKILL），
	// 此处在退出前先收割 child sing-box（TERM→等≤5s→KILL），杜绝 helper 死后 child 变 root 孤儿继续占 9090/utun
	// （修 root 孤儿根因——原 main 无信号处理，bootout 直接退出留下 child）。5s 收割窗口 < launchd 20s 宽限，安全。
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigCh
		mu.Lock()
		c, done := child, childDone
		mu.Unlock()
		if c != nil && c.Process != nil {
			terminateChild(c, done)
		}
		os.Exit(0)
	}()

	methods := []string{"ping", "version", "status", "start", "stop", "cleanup", "freeport", "install-core", "route-add", "route-del", "default-restore", "flush-dns"}
	if err := helperrpc.Serve(l, helperrpc.NewHandler(methods, helperrpc.Bearer(tokenValue), executeCommand), nil); err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
}
