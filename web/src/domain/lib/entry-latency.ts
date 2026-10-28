// SPDX-License-Identifier: MIT
import type { EntryProbeResult } from '@shared/speed-test';

/**
 * 入口探测结果的文字摘要。
 * 节点卡片不再常驻入口延迟（两个延时并排信息冗余）：入口探测只在代理延迟单元格的 tooltip
 * 里以一句话出现；其他需要入口结论文案的场景直接复用本函数，避免分支散落。
 */
export function entryLatencySummary(
  entry: EntryProbeResult | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!entry) return t('vpn.untested');
  if (entry.status === 'ok') return t('vpn.milliseconds', { value: entry.latencyMs });
  if (entry.status === 'timeout') return t('errors.connectionTimeout');
  if (entry.status === 'unavailable') return t('vpn.entryIntercepted');
  if (entry.status === 'unsupported')
    return entry.reason === 'NO_TCP_ENTRY'
      ? t('vpn.entryNoTcp')
      : entry.reason
        ? t('vpn.entryUnsupported')
        : t('vpn.untested');
  return t('vpn.networkFailure');
}
