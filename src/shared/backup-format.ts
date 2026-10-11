import type { UserConfig } from './types';
import { isEndpointProtocol } from './endpoint-routes';
import { ruleHasProcessCondition } from './config-portability';
/** 备份文件的元数据格式。选择性导出后 config 可能只含部分类别字段 → Partial。 */
export interface BackupFileFormat {
  version: string;
  appVersion: string;
  // 导出平台（process.platform）。跨平台导入据此 sanitize 进程规则；旧备份无此字段 → 视为同平台、不处理。
  platform?: string;
  exportedAt: string;
  config: Partial<UserConfig>;
}

export interface BackupInfo {
  serverCount: number;
  manualServerCount: number;
  meshServerCount: number;
  subscriptionCount: number;
  ruleCount: number;
  ruleSetCount: number;
  appRuleCount: number;
  // 跨平台导入时被禁用的进程规则数（processName/processPath 平台特定 → enabled=false 保留供重映射）。0/同平台时不返回。
  crossPlatformDisabledRules?: number;
}

/** 解析备份文件内容（兼容新格式 {version,config} 与旧版直接 UserConfig）。返回 config(Partial) + 导出平台，或错误码。 */
export function parseBackupContent(
  raw: string
): { config: Partial<UserConfig>; platform?: string } | { error: string } {
  let parsed: { version?: string; platform?: unknown; config?: unknown; servers?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { error: 'invalid_format' };
  const content = parsed.version && parsed.config ? parsed.config : parsed;
  if (!content || typeof content !== 'object' || Array.isArray(content))
    return { error: 'invalid_format' };
  const data = content as Record<string, unknown>;
  for (const key of [
    'servers',
    'subscriptions',
    'customRules',
    'customRuleSets',
    'appRules',
    'customAppPresets',
  ]) {
    if (
      data[key] !== undefined &&
      (!Array.isArray(data[key]) ||
        (data[key] as unknown[]).some(
          (item) => !item || typeof item !== 'object' || Array.isArray(item)
        ))
    )
      return { error: 'invalid_format' };
  }
  if (parsed.version && parsed.config) {
    return {
      config: parsed.config as Partial<UserConfig>,
      platform: typeof parsed.platform === 'string' ? parsed.platform : undefined,
    };
  }
  if (parsed.servers !== undefined) {
    return { config: parsed as Partial<UserConfig> }; // 旧版直接导出的 UserConfig
  }
  return { error: 'invalid_format' };
}

/**
 * 跨平台 sanitize：进程规则（processName/processPath）平台特定（chrome.exe / Google Chrome / chrome），跨平台会
 * 静默失效 → 禁用而非移除（enabled=false，保留供用户重映射）。原地改 config.customRules，返回被禁用条数。
 * 详见 docs/design/config-portability.md §3。
 */
export function sanitizeCrossPlatformRules(
  config: UserConfig,
  backupPlatform: string | undefined,
  targetPlatform: string
): number {
  if (!backupPlatform || backupPlatform === targetPlatform || !Array.isArray(config.customRules)) {
    return 0;
  }
  let n = 0;
  for (const rule of config.customRules) {
    if (rule.enabled !== false && ruleHasProcessCondition(rule)) {
      rule.enabled = false;
      n++;
    }
  }
  return n;
}

export function buildBackupInfo(
  config: Partial<UserConfig>,
  crossPlatformDisabledRules?: number
): BackupInfo {
  const servers = config.servers ?? [];
  return {
    serverCount: servers.length,
    manualServerCount: servers.filter((s) => !s.subscriptionId && !isEndpointProtocol(s.protocol))
      .length,
    meshServerCount: servers.filter((s) => !s.subscriptionId && isEndpointProtocol(s.protocol))
      .length,
    subscriptionCount: config.subscriptions?.length ?? 0,
    ruleCount: config.customRules?.length ?? 0,
    ruleSetCount: config.customRuleSets?.length ?? 0,
    appRuleCount: config.appRules?.length ?? 0,
    crossPlatformDisabledRules: crossPlatformDisabledRules || undefined,
  };
}
