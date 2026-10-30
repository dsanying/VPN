import { useMemo } from 'react';

/**
 * useStable —— 按签名的引用稳定化：签名不变时返回上一次的引用，签名变化才取新值。
 *
 * 实现是「签名作 key 的 memo 缓存」。React 允许提前丢弃 memo 缓存——那只是退回
 * 逐帧新引用（内容仍正确），不破坏语义。
 *
 * 约束：签名字符串必须由 value 的全部相关内容拼出（值变了签名必变），漏拼等于展示旧值。
 *
 * 用途：每帧重算但结果几乎不变的派生值（连接页筛选选项、应用合并表、表格列定义），
 * 锁住引用让下游 memo 化的 antd Select / Table 不随实时帧逐秒 reconcile。
 */
export function useStable<T>(value: T, signature: string): T {
  // 刻意只依赖签名：value 变化而签名未变时，按契约返回旧引用（调用方负责签名的完备性）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [signature]);
}
