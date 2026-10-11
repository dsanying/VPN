import type { ServerConfig } from './types';

/**
 * 节点稳定指纹：协议 + 地址 + 端口 + 凭据（uuid/password/username）。
 * 刻意排除显示名 name 与本地自定义 detour —— 订阅方常改名/调顺序，用 name 做键会把
 * 同一物理节点误判为「删旧增新」，导致 id 抖动、selectedServerId 丢失、本地编辑被清。
 * 凭据可区分同 host:port 的并列节点，几乎不随更新变化。
 */
export function serverFingerprint(s: ServerConfig): string {
  // 凭据按协议落点取：vless/vmess/tuic→uuid；trojan/hy2/anytls→password；ss→shadowsocksSettings.password；
  // naive/socks/http→username；ssh→sshSettings.password。覆盖嵌套落点，避免 SS 等凭据落空致同 host:port 误并。
  const cred =
    s.uuid ||
    s.password ||
    s.shadowsocksSettings?.password ||
    s.username ||
    s.sshSettings?.password ||
    s.wireguardSettings?.peerPublicKey ||
    '';
  // Native fields preserve identity when tuning transport options or renaming a node.
  const native = s.compatibilitySettings?.outbound as Record<string, any> | undefined;
  const nativeCred = native
    ? native.password ||
      native.uuid ||
      native.settings?.vnext?.[0]?.users?.[0]?.id ||
      native.settings?.servers?.[0]?.password ||
      ''
    : '';
  const protocol = native
    ? `${s.compatibilitySettings!.engine}:${native.type || native.protocol}`
    : s.protocol;
  const network = native?.streamSettings?.network || s.network || 'tcp';
  // network 维度：同 host:port:cred 但传输不同（tcp vs ws vs grpc）是不同节点，缺此维度会被误并静默吞节点。
  // 指纹不持久化——reconcile 对新旧两侧用同一函数现算，归一化（h2→http/raw→tcp）对两侧等价，
  // 存量节点 id / selectedServerId 不受本次加维度影响。
  return `${(protocol || '').toLowerCase()}|${s.address}|${s.port}|${nativeCred || cred}|${network.toLowerCase()}`;
}

/**
 * 订阅节点对账：按稳定指纹匹配新旧节点。
 * - 命中：原地更新（保留旧 id/createdAt），其余字段（含 name、detour）以订阅最新值为准
 *   —— 订阅节点不保留本地 detour，需长期自定义请用「克隆到自建」。
 * - 仅新订阅有：新增。
 * - 仅旧配置有：删除（id 收入 deletedIds 供清理 selectedServerId）。
 * 用桶（数组）承接同指纹的多个节点，按出现顺序成对匹配，避免 Map 覆盖丢 id。
 */
export function reconcileServers(
  oldServers: ServerConfig[],
  fetchedServers: ServerConfig[],
  now: string
): {
  servers: ServerConfig[];
  added: number;
  updated: number;
  deleted: number;
  deletedIds: Set<string>;
  /** §16.3.4b：节点集是否真变化（added>0 ‖ deleted>0 ‖ 任一命中节点内容变）——手动订阅刷新据此决定是否 force-restart
   *  入池、渲染层据此决定是否全量刷新。顺序重排/时间戳刷新等无实质变化恒 false（与 configGenerationNorm 双保险）。 */
  contentChanged: boolean;
} {
  // 内容键（忽略 id/时间戳/归属元数据）：判「无变化更新」保 updatedAt 不投毒 + 聚合 contentChanged。
  const contentKey = (s: ServerConfig) => {
    const copy: Record<string, unknown> = { ...s };
    delete copy.id;
    delete copy.createdAt;
    delete copy.updatedAt;
    delete copy.providerName; // 归属元数据非节点连接内容，不计入比较（否则加该字段会让存量节点首次升级误刷 updatedAt）
    return JSON.stringify(copy);
  };
  const oldBuckets = new Map<string, ServerConfig[]>();
  for (const s of oldServers) {
    const key = serverFingerprint(s);
    const bucket = oldBuckets.get(key);
    if (bucket) bucket.push(s);
    else oldBuckets.set(key, [s]);
  }

  const kept: ServerConfig[] = [];
  let added = 0;
  let updated = 0;
  let anyContentChanged = false;
  for (const ns of fetchedServers) {
    const key = serverFingerprint(ns);
    const bucket = oldBuckets.get(key);
    const old = bucket && bucket.length > 0 ? bucket.shift() : undefined;
    if (old) {
      // 内容相同（忽略 id/时间戳）则保留 old.updatedAt，避免无变化也刷新 updatedAt「投毒」纯切节点热切换
      const same = contentKey(ns) === contentKey(old);
      if (!same) anyContentChanged = true;
      kept.push({
        ...ns,
        id: old.id,
        createdAt: old.createdAt,
        updatedAt: same ? old.updatedAt : now,
      });
      updated++;
    } else {
      kept.push(ns);
      added++;
    }
  }

  const leftover: ServerConfig[] = [];
  for (const bucket of oldBuckets.values()) leftover.push(...bucket);
  const deletedIds = new Set(leftover.map((s) => s.id));
  const contentChanged = added > 0 || leftover.length > 0 || anyContentChanged;
  return { servers: kept, added, updated, deleted: leftover.length, deletedIds, contentChanged };
}

/**
 * partial 失败时的 merge-only leftover（provider 级精确）。被删旧节点中只保留「失败 provider 名下」的
 * （防该 provider 临时故障穿仓），成功 provider 的真下架节点不在此列、正常删除。providerName=undefined 的
 * 旧节点（迁移前存量 / 内联 proxies / 非 Clash 订阅）无归属信息 → 保守保留，不冒误删风险。failedProviders
 * 缺失/空（rejected 兜底等 partial 但失败名未知）→ 全部保守保留，退回旧的整订阅级 merge-only。
 */
export function leftoverToKeep(
  oldServers: ServerConfig[],
  deletedIds: Set<string>,
  failedProviders?: string[]
): ServerConfig[] {
  const failed = failedProviders && failedProviders.length > 0 ? new Set(failedProviders) : null;
  return oldServers.filter(
    (s) =>
      deletedIds.has(s.id) &&
      (failed === null || s.providerName === undefined || failed.has(s.providerName))
  );
}
