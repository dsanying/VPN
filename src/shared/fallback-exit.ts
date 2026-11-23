/**
 * 删「当前选中」节点后的兜底出口候选选择（renderer 删节点 reselect 与 main 订阅 reselect 共用单一真值）。
 *
 * 关键：候选必须过可用性谓词，否则会静默选中不承载公网流量的节点（subnet-only 组网节点：WG allowInternet:false
 * 带网段 / TS 无 exitNode）→ 重启后公网流量静默走 direct = VPN 客户端语义下的泄漏（#291）。
 * pickFallbackExit 无正延迟时回退列表首个候选，故过滤必须在其之前完成。
 */
import type { ServerConfig } from './types';
import { isServerComplete } from './server-completeness';
import { meshNodeCarriesFullTunnel } from './endpoint-routes';
import { rankExitCandidates, type ExitRankingContext } from './exit-selection';

/**
 * 兜底出口候选可用性谓词：配置齐备（isServerComplete，内含 !isMeshNodeUnroutable）+ 承载全出网流量
 * （meshNodeCarriesFullTunnel：非组网节点恒真；WG allowInternet / TS exitNode 才真）。
 */
export function isViableFallbackExit(server: ServerConfig): boolean {
  return isServerComplete(server) && meshNodeCarriesFullTunnel(server);
}

/**
 * 从 servers（按列表序传入）选可用兜底出口 id：先过 isViableFallbackExit，再按
 * rankExitCandidates 排序取首（同订阅 > 同地区 > 最低延迟 > 列表序）。空候选 → null
 * （调用方置 DIRECT 哨兵 = 显式可见直连，非静默泄漏）。context 见 exit-selection.ts。
 */
export function pickViableFallbackExit(
  servers: ServerConfig[],
  context: ExitRankingContext = {}
): string | null {
  return rankExitCandidates(servers.filter(isViableFallbackExit), context)[0]?.id ?? null;
}
