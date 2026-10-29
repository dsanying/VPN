/**
 * 内核进程身份校验（纯函数）：PID 复用识破。
 *
 * 为什么「PID 存在」不够：sing-box/mihomo 死后，其 PID 可能被系统快速复用给别的进程——
 * 只验 PID 存在会把复用者误判成存活内核，健康检查从此永久失明：核死了无人发现、UI 假连接、
 * 系统 DNS 接管无人还原（真实事故 2026-10-28：核 22:45 静默死亡，`ps -p` 恒真或检查失明，
 * DNS 8.8.8.8 残留过夜直到用户手动发现）。故探活在验 PID 之外必须核对进程镜像名。
 *
 * 主核只有两种镜像：sing-box 与 mihomo（双内核，见 HelperManager.startCore 的 engine 参数）。
 * 兼容性测速临时核也在这两个名字里，但它不经健康检查跟踪，不构成误判源。
 */

/** 匹配 ps/tasklist 输出中的内核镜像名：行内出现独立的 sing-box 或 mihomo（可带 .exe）。 */
const CORE_IMAGE_RE = /(?:^|[/\\\s])(sing-box|mihomo)(\.exe)?(?:\s|$)/m;

/**
 * 判定探活命令输出里的进程是否为本应用内核。
 * 输入是 `ps -p <pid> -o pid= -o comm=`（macOS/Linux）或 `tasklist /FI "PID eq <pid>" /NH`（Windows）的 stdout。
 */
export function isCoreProcessOutput(output: string): boolean {
  return CORE_IMAGE_RE.test(output);
}
