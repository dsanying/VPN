import { now } from '@/utils/dateTime';
import type { ServerConfig } from '@shared/types';
function mergeFields(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const previous = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const result: Record<string, unknown> = structuredClone(previous) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid configuration field');
    result[key] = mergeFields(result[key], value);
  }
  return result;
}
/** 未显示的嵌套协议字段保持原样；只覆盖实际编辑的字段，不修改源节点。 */
export function mergeNodeDraft(original: ServerConfig | undefined, values: Partial<ServerConfig>, extra: unknown): ServerConfig {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('Invalid node configuration');
  const result = mergeFields(mergeFields(original, extra), values) as ServerConfig;
  result.id = original?.id ?? crypto.randomUUID();
  result.subscriptionId = original?.subscriptionId;
  result.createdAt = original?.createdAt ?? now().toISOString();
  result.updatedAt = now().toISOString();
  return result;
}
