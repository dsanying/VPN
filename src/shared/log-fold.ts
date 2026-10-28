/**
 * 日志折叠（关键信息视图）：同键日志在内存尾与实时流中合并为一条并累计次数，磁盘 JSONL 逐条落盘不减
 * （「显示阈值不得抹掉磁盘诊断证据」的既有哲学在折叠上的延续——折叠只作用于 UI 消费面）。
 */

import type { LogEntry } from './types';

/** 折叠窗口（滑动，按同键最近一次出现计）：窗口内同键合并；超过窗口视为新的一条重新计数。 */
export const LOG_FOLD_WINDOW_MS = 120_000;

/**
 * 归一化单条文本（事件参数或未编目原文）：
 *  - 剥离 sing-box DNS 查询 id 与耗时标记（如 `[4243907428 1.50s]`）——每次查询都不同，纯噪音；
 *  - 同一次解析失败核心会打 dns/router 两行（`dns: lookup failed for X` / `router: lookup X`），归因包裹
 *    后仍不同文；把两种外观归一到 `lookup X` 使这一对合并为一条关键信息。
 */
function normalizeFoldText(text: string): string {
  return text
    .replace(/\[\d{6,} \d+(?:\.\d+)?s\]/g, '')
    .replace(/\bdns: lookup failed for /g, 'lookup ')
    .replace(/\brouter: lookup /g, 'lookup ');
}

/**
 * 折叠键：事件目录命中用 eventId + 归一化参数（同一事件的不同表述天然同键）；未编目用归一化原文
 * （保留域名/目标差异，不掩盖不同事件）。键不含 traceId/operation——调用方另行保证操作上下文不互折。
 */
export function logFoldKey(entry: Pick<LogEntry, 'eventId' | 'eventArgs' | 'message'>): string {
  if (entry.eventId) {
    return `id:${entry.eventId}|${(entry.eventArgs ?? []).map(normalizeFoldText).join('\u0001')}`;
  }
  return `raw:${normalizeFoldText(entry.message)}`;
}
