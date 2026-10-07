//go:build windows

// Windows 进程/网络/注册表原语：被 helper.go 的协议骨架调用，承载 macOS→Windows 的全部机制 delta。
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// startSingbox：以 CREATE_NEW_PROCESS_GROUP 启动锁定的 sing-box（exec.Command(singboxBin,"run","-c",cfg)）。
// 新进程组是 stop 走 GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid) 优雅停的前提（CTRL_BREAK 按进程组投递）。
// 早期 stdout/stderr 重定向到 app 日志文件（镜像 macOS start），便于诊断启动问题。
func startSingbox(singboxBin, cfg, logPath string) (*exec.Cmd, *os.File, *os.File, error) {
	configFile, actualConfig, err := openConfinedFile(cfg, false)
	if err != nil {
		return nil, nil, nil, err
	}
	c := exec.Command(singboxBin, "run", "-c", actualConfig)
	// CREATE_NEW_PROCESS_GROUP：使 child 成为独立进程组组长，可被定向投递 CTRL_BREAK_EVENT。
	// 注意：CREATE_NEW_PROCESS_GROUP 会令 child 默认忽略 CTRL_C（仅 CTRL_BREAK 可达），故 stop 用 CTRL_BREAK。
	c.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP,
	}
	var logFile *os.File
	if logPath != "" {
		logFile, _, err = openConfinedFile(logPath, true)
		if err != nil {
			configFile.Close()
			return nil, nil, nil, err
		}
		c.Stdout = logFile
		c.Stderr = logFile
	}
	if err := c.Start(); err != nil {
		configFile.Close()
		return nil, logFile, nil, err
	}
	// 防孤儿安全网（H1）：确保常驻 job 存在，并把刚起的 child assign 进去。
	// 必须在 Start 成功后（此刻 child 必活、pid 必指向本 child，无复用窗口）；best-effort 不阻断 start。
	if err := ensureJob(); err != nil {
		// 防孤儿安全网建失败：child 不在 Job 内，helper 崩溃时仅 watchParent 兜底（覆盖面窄）。
		// best-effort 不阻断 start；记 stderr 便于真机诊断（SCM 服务日志可见，持续失败=孤儿风险升高）。
		fmt.Fprintf(os.Stderr, "ensureJob failed: %v (child pid=%d not under job)\n", err, c.Process.Pid)
	} else if c.Process != nil {
		assignToJob(c.Process.Pid)
	}
	return c, logFile, configFile, nil
}

// sendCtrlBreak：向指定进程组（pid 为组长，见 CREATE_NEW_PROCESS_GROUP）投递 CTRL_BREAK_EVENT，尝试触发
// sing-box 优雅退出（拆 wintun/路由/DNS）。镜像 macOS SIGTERM 的「优雅信号」语义。
// 重要限制：GenerateConsoleCtrlEvent 只路由给与调用者**共享 console** 的进程。本 helper 作为 session 0 的
// LocalSystem 服务**无 console**，且 child 以 CREATE_NEW_PROCESS_GROUP 启动（不分配新 console）→ 服务模式下
// 此调用是 no-op，CTRL_BREAK 永远投递不到。仅在 --console dev 模式（有 console）下有效。
// 失败（进程已退出/非组长/服务模式无 console）返回 err，由 terminateChild 的超时 + TerminateProcess 硬杀兜底。
func sendCtrlBreak(pid int) error {
	return windows.GenerateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(pid))
}

// ---- Job Object：防孤儿安全网（H1）----
//
// 服务模式 CTRL_BREAK 失效（见 sendCtrlBreak），且若 helper 进程异常死亡（崩溃 / SCM 未净收割就杀），
// 那些 watchParent 不及覆盖的路径会留下 LocalSystem 孤儿 sing-box 继续占 9090/TUN（无普通用户能清）。
// Windows Job Object + JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 提供内核级安全网：所有 child 都 assign 进一个随
// helper 生命周期常驻的 job，helper 进程一死 → job 句柄被内核关闭 → 内核自动连坐杀光 job 内所有进程。
//
// 职责分工：
//   - watchParent 管「GUI app 死、helper 还活」（父死看护，主动收割）。
//   - Job Object 管「helper 自己死」（被动安全网，内核连坐）。二者互补，覆盖各自的孤儿场景。
var hJob windows.Handle

// ensureJob：惰性创建常驻 job 并设 KILL_ON_JOB_CLOSE。幂等（已建则直接返回成功）。
// 只在持 mu 的 start 路径调用（与 child 摘挂同临界区，无需额外锁保护 hJob）。
func ensureJob() error {
	if hJob != 0 {
		return nil
	}
	h, err := windows.CreateJobObject(nil, nil) // 匿名 job（无名、默认安全描述符）
	if err != nil {
		return err
	}
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		h,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		windows.CloseHandle(h)
		return err
	}
	hJob = h
	return nil
}

// assignToJob：把 child 进程 assign 进常驻 job，使其受 KILL_ON_JOB_CLOSE 连坐保护。
// AssignProcessToJobObject 要 child 的进程 **HANDLE**（非 pid）且需 PROCESS_SET_QUOTA|PROCESS_TERMINATE 权限。
// Go 1.24 的 os.Process 不再暴露公开的 Handle 字段（内部 handle 私有），故就地 OpenProcess(pid) 取一个有足够
// 权限的句柄；用完即关。
// PID 复用安全：调用点在 c.Start() 成功后立即执行，此刻 c.Process 仍持有 child（尚未 Wait 收割）→ child 必活、
// 该 pid 必指向本 child，不存在「pid 被复用到别的进程」的窗口。
// best-effort：OpenProcess/assign 失败不阻断 start（watchParent + 收割仍是孤儿防护主路径，job 是额外安全网）。
func assignToJob(pid int) {
	if hJob == 0 || pid <= 0 {
		return
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	_ = windows.AssignProcessToJobObject(hJob, h)
}

// processAlive：判 ppid 是否存活。OpenProcess(SYNCHRONIZE|QUERY_LIMITED_INFORMATION) 成功且
// GetExitCodeProcess==STILL_ACTIVE → 存活。
// 宁漏勿误（对齐 macOS kill(ppid,0) 的「其余错误按存活处理」）：
//   - OpenProcess 失败且为 ERROR_INVALID_PARAMETER（pid 已不存在）→ 确定已死，返回 false。
//   - 其余打开失败（如 ACCESS_DENIED——SYSTEM 一般不会见，但保守）→ 不确定，按存活返回 true。
//   - GetExitCodeProcess 失败 → 不确定，按存活返回 true。
func processAlive(ppid int) bool {
	if ppid <= 0 {
		return false
	}
	const access = windows.SYNCHRONIZE | windows.PROCESS_QUERY_LIMITED_INFORMATION
	h, err := windows.OpenProcess(access, false, uint32(ppid))
	if err != nil {
		// 仅在「确定不存在」时判死；其余不确定情形宁可按存活（宁漏勿误）。
		if errno, ok := err.(syscall.Errno); ok && errno == windows.ERROR_INVALID_PARAMETER {
			return false
		}
		return true
	}
	defer windows.CloseHandle(h)
	var code uint32
	if err := windows.GetExitCodeProcess(h, &code); err != nil {
		return true // 查询失败 → 不确定 → 按存活
	}
	const stillActive = 259 // STILL_ACTIVE
	return code == stillActive
}

// spawnSelfUninstall：派生一个脱离本进程生命周期的 SYSTEM 旁路 cmd，完成 helper 自身无法自完成的卸载收尾：
// 停并删 SCM 服务（serviceName）、删 supportDir（含外置的 com.dsanying.shadowvpn.helper.exe 自身 + helper.token）。
//
// 为何必须借旁路进程：
//   - 正在运行的 helper.exe 被自身锁定，无法自删 → 由「等 helper 退出解锁后」的旁路删；
//   - sc delete 要服务先停，而本进程正是服务主进程 → 由旁路在 helper os.Exit 后执行。
//
// 关键安全/生命周期点：
//   - DETACHED_PROCESS：cmd 无 console、不随 helper 退出被收（不是 helper 的 console 子进程）。
//   - 不 assignToJob：故不受 hJob 的 KILL_ON_JOB_CLOSE 连坐（helper 一死即被杀就前功尽弃）。
//   - 继承 helper 的 SYSTEM token（子进程默认继承父 token）→ 有权 sc delete / 删 ProgramData。
//   - ping 作延迟（非 timeout —— timeout 需 console，DETACHED 下会失败）；删两次兜 exe 解锁竞态。
//   - 命令行经 SysProcAttr.CmdLine **原样下发**（绕过 Go syscall.EscapeArg）：否则 EscapeArg 会把 rmdir 路径的内层
//     `"` 转义成 `\"`，而 cmd.exe 不识别 `\"` 反转义 → strip-first-last 后 rmdir 收到非法路径 `\C:\...\` → 目录删不掉
//     （外置 helper.exe + token 残留）。命令行拼装与该引号推理详见 selfUninstallCmdLine（含纯函数单测）。
//
// best-effort：失败也只是残留服务/目录，由 app 侧 NSIS 卸载钩子 / APP_UNINSTALL_ALL 兜底（纵深）。
func spawnSelfUninstall() {
	// lpApplicationName 用绝对 cmd.exe 路径（不依赖 SYSTEM 服务的 %PATH%）；CmdLine 的 argv[0] 仍写 cmd（cmd 自身忽略）。
	cmdExe := os.Getenv("ComSpec")
	if cmdExe == "" {
		cmdExe = os.Getenv("SystemRoot") + `\System32\cmd.exe`
	}
	c := exec.Command(cmdExe)
	c.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP,
		CmdLine:       selfUninstallCmdLine(serviceName, supportDir),
	}
	_ = c.Start() // 不 assignToJob、不 Wait —— 旁路须比 helper 活得久
}

// ---- freeport：GetExtendedTcpTable 枚举 IPv4 + IPv6 的 LISTEN 持有者 pid ----

// MIB_TCPROW_OWNER_PID（IPv4）：与 Windows API 内存布局逐字段对齐。
type mibTCPRowOwnerPID struct {
	State      uint32
	LocalAddr  uint32
	LocalPort  uint32 // 网络字节序，仅低 16 位有效
	RemoteAddr uint32
	RemotePort uint32
	OwningPID  uint32
}

// MIB_TCP6ROW_OWNER_PID（IPv6）。
type mibTCP6RowOwnerPID struct {
	LocalAddr     [16]byte
	LocalScopeID  uint32
	LocalPort     uint32
	RemoteAddr    [16]byte
	RemoteScopeID uint32
	RemotePort    uint32
	State         uint32
	OwningPID     uint32
}

const (
	tcpTableOwnerPIDListener = 3  // TCP_TABLE_OWNER_PID_LISTENER
	afINET                   = 2  // AF_INET
	afINET6                  = 23 // AF_INET6
	mibTCPStateListen        = 2  // MIB_TCP_STATE_LISTEN
)

var (
	modiphlpapi             = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcpTable = modiphlpapi.NewProc("GetExtendedTcpTable")
)

// localPortFromNetOrder：GetExtendedTcpTable 的 LocalPort 为「主机内存中按网络序排布的 32 位」，低 16 位是端口。
// 端口 = 高字节<<8 | 次高字节（取低 16 位的两个字节做 ntohs）。
func localPortFromNetOrder(p uint32) uint16 {
	b0 := byte(p)      // 低字节（网络序高位）
	b1 := byte(p >> 8) // 次低字节（网络序低位）
	return uint16(b0)<<8 | uint16(b1)
}

// listenPidsForPort：返回在 port 上处于 LISTEN 的所有 owning pid（去重，IPv4+IPv6 合并）。
// 镜像 macOS `lsof -ti tcp:<port> -sTCP:LISTEN`：仅 LISTEN 持有者，不含 ESTABLISHED 连接方。
func listenPidsForPort(port uint16) ([]uint32, error) {
	seen := map[uint32]bool{}
	var out []uint32

	collect := func(family uint32, parse func(table []byte) []struct {
		pid  uint32
		port uint16
	}) error {
		var size uint32
		// 首次调用拿所需缓冲大小（返回 ERROR_INSUFFICIENT_BUFFER）。
		r1, _, _ := procGetExtendedTcpTable.Call(
			0, uintptr(unsafe.Pointer(&size)), 1, // sorted=TRUE
			uintptr(family), uintptr(tcpTableOwnerPIDListener), 0,
		)
		if r1 != uintptr(windows.ERROR_INSUFFICIENT_BUFFER) && r1 != 0 {
			return syscall.Errno(r1)
		}
		if size == 0 {
			return nil
		}
		buf := make([]byte, size)
		r1, _, _ = procGetExtendedTcpTable.Call(
			uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 1,
			uintptr(family), uintptr(tcpTableOwnerPIDListener), 0,
		)
		if r1 != 0 {
			return syscall.Errno(r1)
		}
		for _, e := range parse(buf) {
			if e.port == port && !seen[e.pid] {
				seen[e.pid] = true
				out = append(out, e.pid)
			}
		}
		return nil
	}

	// IPv4
	if err := collect(afINET, func(table []byte) []struct {
		pid  uint32
		port uint16
	} {
		// 空表防越界：Windows 在「无 LISTEN」时返回 size=4（仅 dwNumEntries=0 这 4 字节头，无行数组）。
		// 必须先校验 len>=4 再读行数 n；n==0 时直接返回，绝不在空表上求值 &table[4]（越界 panic）。
		// freeport 任何持 token 的本地用户可触发，绝不能 panic。
		if len(table) < 4 {
			return nil
		}
		n := *(*uint32)(unsafe.Pointer(&table[0]))
		if n == 0 {
			return nil
		}
		rows := unsafe.Slice((*mibTCPRowOwnerPID)(unsafe.Pointer(&table[4])), int(n))
		res := make([]struct {
			pid  uint32
			port uint16
		}, 0, n)
		for i := range rows {
			if rows[i].State != mibTCPStateListen {
				continue
			}
			res = append(res, struct {
				pid  uint32
				port uint16
			}{rows[i].OwningPID, localPortFromNetOrder(rows[i].LocalPort)})
		}
		return res
	}); err != nil {
		return nil, err
	}

	// IPv6
	if err := collect(afINET6, func(table []byte) []struct {
		pid  uint32
		port uint16
	} {
		// 空表防越界：同 IPv4 路径——size=4（仅 dwNumEntries=0 头）时 &table[4] 越界 panic，先校验 len/n。
		if len(table) < 4 {
			return nil
		}
		n := *(*uint32)(unsafe.Pointer(&table[0]))
		if n == 0 {
			return nil
		}
		rows := unsafe.Slice((*mibTCP6RowOwnerPID)(unsafe.Pointer(&table[4])), int(n))
		res := make([]struct {
			pid  uint32
			port uint16
		}, 0, n)
		for i := range rows {
			if rows[i].State != mibTCPStateListen {
				continue
			}
			res = append(res, struct {
				pid  uint32
				port uint16
			}{rows[i].OwningPID, localPortFromNetOrder(rows[i].LocalPort)})
		}
		return res
	}); err != nil {
		return nil, err
	}

	return out, nil
}

// 使用 ActiveStore 修改运行时接口转发，不写入持久 IPEnableRouter 注册表。
func forwardingPowerShell(script string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ps := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	return exec.CommandContext(ctx, ps, "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; "+script).Output()
}

func readInterfaceForwarding() ([]forwardingInterface, error) {
	output, err := forwardingPowerShell("$items=@(Get-NetIPInterface -PolicyStore ActiveStore | ForEach-Object { [pscustomobject]@{Index=[int]$_.InterfaceIndex; Family=[string]$_.AddressFamily; Enabled=([string]$_.Forwarding -eq 'Enabled')} }); ConvertTo-Json -InputObject $items -Compress")
	if err != nil {
		return nil, err
	}
	var values []forwardingInterface
	if err := json.Unmarshal(output, &values); err != nil {
		return nil, err
	}
	return values, nil
}

func writeInterfaceForwarding(values []forwardingInterface, enabled bool) error {
	if len(values) == 0 {
		return nil
	}
	state := "Disabled"
	if enabled {
		state = "Enabled"
	}
	var script strings.Builder
	for _, value := range values {
		if value.Index <= 0 || (value.Family != "IPv4" && value.Family != "IPv6") {
			return fmt.Errorf("invalid forwarding interface")
		}
		// 再读运行值，避免对已被其他操作关闭的接口重复写入。
		fmt.Fprintf(&script, "$i=Get-NetIPInterface -InterfaceIndex %d -AddressFamily %s -PolicyStore ActiveStore -ErrorAction SilentlyContinue; if ($i -and ([string]$i.Forwarding -ne '%s')) { $i | Set-NetIPInterface -Forwarding %s -PolicyStore ActiveStore -ErrorAction Stop }; ", value.Index, value.Family, state, state)
	}
	_, err := forwardingPowerShell(script.String())
	return err
}

func enableIPForwarding() (func() error, error) {
	return enableForwarding(readInterfaceForwarding, writeInterfaceForwarding)
}
