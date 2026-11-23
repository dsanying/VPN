/**
 * 出口重选排序（单一真值）：订阅更新下架兜底 / 故障自动切换 / 渲染端删节点兜底共用。
 *
 * 排名键（越小越优）：
 * 1. 同订阅 —— 被换掉的出口属于某个订阅，跳去无关自建/其他订阅节点是跨信任域漂移
 *    （真机事故：下架重选把出口静默换成 CUHK 校园网自建节点）。
 * 2. 同国家/地区 —— 以测量记录里探测到的出口地区为准（name 猜地区明确禁用，见客户端规范）。
 * 3. 最低延迟 —— 主进程读 measurements.sqlite，渲染端传会话 latencyMap；
 *    无正延迟（未测/超时）一律视为并列最差，靠列表序兜底。
 * 4. 候选传入顺序（数组稳定序）—— 与既有「无数据回退第一个」语义一致。
 *
 * 上下文字段全可选：缺订阅归属视为不合拍；缺地区视为不冲突（不惩罚未测地区的候选，
 * 否则旧节点地区缺失会恒把候选挤下）。
 */
import type { NodeProbeDetails } from './speed-test';
import { nodeRegionCode } from './node-identity';
import type { ServerConfig } from './types';

export interface ExitRankingContext {
  /** 上一出口所属订阅 id（手动节点 = undefined）。 */
  previousSubscriptionId?: string;
  /** 上一出口探测到的 ISO 地区码（exit 优先，gateway 次之）。 */
  previousRegionCode?: string;
  /** 各候选延迟（ms，>0 有效）。 */
  latencyMap?: Record<string, number>;
  /** 各候选探测记录（取 exit/gateway 地区）。 */
  regionMap?: Record<string, Pick<NodeProbeDetails, 'exit' | 'gateway'>>;
}

export function rankExitCandidates(
  candidates: ServerConfig[],
  context: ExitRankingContext = {}
): ServerConfig[] {
  const { previousSubscriptionId, previousRegionCode, latencyMap = {}, regionMap = {} } = context;
  const prevRegion = previousRegionCode?.toLowerCase();
  const scored = candidates.map((server, index) => {
    const sameSubscription =
      previousSubscriptionId !== undefined && server.subscriptionId === previousSubscriptionId;
    const region = nodeRegionCode(regionMap[server.id]);
    const sameRegion = prevRegion !== undefined && region === prevRegion;
    const latency = latencyMap[server.id];
    const positiveLatency = typeof latency === 'number' && latency > 0;
    return {
      server,
      index,
      // 0 优于 1；延迟并列时正延迟优先于无延迟。
      key: [
        sameSubscription ? 0 : 1,
        sameRegion ? 0 : 1,
        positiveLatency ? 0 : 1,
        positiveLatency ? latency : Number.POSITIVE_INFINITY,
      ] as const,
    };
  });
  scored.sort(
    (a, b) =>
      a.key[0] - b.key[0] ||
      a.key[1] - b.key[1] ||
      a.key[2] - b.key[2] ||
      a.key[3] - b.key[3] ||
      a.index - b.index
  );
  return scored.map((entry) => entry.server);
}
