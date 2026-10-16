import { WEBSITE_CATALOG } from './website-catalog';
/**
 * 解锁检测 —— main/renderer 共用类型 SoT（单一真值）。
 *
 * 为何在 shared：main 侧检测引擎与 renderer 侧展示共用同一套状态枚举/结果结构，双份定义必漂移
 * （见 shadowvpn-unlock-detection.md §2.2）。renderer 的 `unlock-service-config.ts` re-export 本文件的
 * `UnlockStatus/UnlockResult`，不另定义。
 */

/**
 * 检测状态。
 * - `idle`：初始/未检测态；未连接代理仍可检测普通网络。
 * - `checking`：编排器/hook 置位（检测在飞）。
 * - `ok`：官方网页可达；不代表账号登录、视频播放或完整解锁。
 * - `partial`：旧快照兼容状态，当前检测不产生。
 * - `blocked`：官方明确拒绝当前地区；普通 HTTP 错误码仍表示网络可达。
 * - `timeout`：请求超时；连接或证书错误用 error。
 */
export type UnlockStatus = 'idle' | 'checking' | 'ok' | 'partial' | 'blocked' | 'timeout' | 'error';

/** 单个服务的检测结果。region = 该服务边缘节点判定的地区码（ISO-3166-1 alpha-2，可缺）。 */
export interface UnlockResult {
  status: UnlockStatus;
  region?: string;
  httpStatus?: number;
  reason?: string;
}

/** 检测覆盖的服务 id 全集（顺序即编排/展示顺序）。 */
export type ServiceId = keyof typeof WEBSITE_CATALOG;
export const SERVICE_IDS = Object.keys(WEBSITE_CATALOG) as ServiceId[];

/** 当前代理出口（cdn-cgi/trace 打点得到，兼作缓存 key）。region = countryCode，可缺。 */
export interface UnlockEgress {
  ip: string;
  region?: string;
}

/**
 * gating 短路原因：
 * - `proxy-not-running` / `proxy-not-selected`：兼容旧快照及检测期间的状态变化。
 *   稳定的未连接或直连状态使用普通网络检测，不因这些状态禁用检测入口。
 * - `exit-invalid`：选中 TS 出口 API 直判无效（未选出口设备 / 出口离线 / 未广告）——经无效出口检测必死出口空转，
 *   一律短路（零网络、零就绪门）。所有触发面汇聚 run() 单点收口，翻转对账（reconcileTsExitBlock）恢复后 invalidate 重检。
 */
export type UnlockBlockedReason = 'proxy-not-running' | 'proxy-not-selected' | 'exit-invalid';

/** 一次检测的完整快照（unlock:run / unlock:get 的返回体）。 */
export interface UnlockSnapshot {
  /** Network actually tested; a direct result must never be labelled as a node result. */
  route?: 'direct' | 'proxy' | 'routed';
  /** serviceId → 结果；gating 短路时为空对象。 */
  results: Record<string, UnlockResult>;
  /** 完成时间戳；null = 未检测（gating 短路）。 */
  checkedAt: number | null;
  /** 出口信息；trace 失败为 null。 */
  egress: UnlockEgress | null;
  /** 非空 = 本轮未真正检测（如指定出口无效）。 */
  blockedReason?: UnlockBlockedReason;
  /**
   * true = 核已 running 但 inbound 尚未就绪（就绪门 egress 探测重试耗尽 / 退避期间被 invalidate）→ 本轮未跑 checker、
   * checkedAt=null。**已提交为终态快照**（防 mount/切 tab 反复重扫死出口就绪门，由 run() 的 S-gate 兜住）；解除 =
   * invalidate（一切真状态变化：起停/切节点/G-flip/G-flip2 均清 lastSnapshot）或 force。区别于 blockedReason（gating 短路）。
   */
  notReady?: boolean;
  /**
   * true = 就绪门过了、但所有 checker 全 timeout/error（egress flap 期典型）。低置信瞬态：已提交 lastSnapshot（UI 如实 + mount
   * 水合零网络）但**未写 egressIp 缓存**——避免垃圾快照锁 30min；下一真触发（含 G-flip2 伴测成功）即重检。命中任一
   * marker 的高置信结果不置此标、照常入缓存。
   */
  lowConfidence?: boolean;
}

/** 单个 checker settle 时的增量推送（EVENT_UNLOCK_PROGRESS 载荷）。 */
export interface UnlockProgress {
  serviceId: string;
  result: UnlockResult;
}

/**
 * EVENT_UNLOCK_INVALIDATED 载荷（issue 2 review 修）：由**主进程**在 invalidate 时带上核真态，供渲染端决定
 * 「显示检测中(beginUnlockCheck) vs 复位 idle(resetUnlock)」——不再用渲染端可能陈旧的 connectionStatus/proxyBlocked
 * （invalidate 常先于 EVENT_PROXY_STARTED / IP_INFO_UPDATED 抵达，陈旧视图会误判分支）。
 */
export interface UnlockInvalidatedPayload {
  /** invalidate 时核是否在运行。 */
  running: boolean;
  /** invalidate 时选中出口是否直判无效（R-gate）：true 则不显检测中 spinner。 */
  exitBlocked: boolean;
}
