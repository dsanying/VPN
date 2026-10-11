import { isIP } from 'node:net';
import type { Rule, UserConfig } from './types';
import { validateRuleValue } from './rules';
import { DEFAULT_BYPASS_LAN } from './system-proxy-bypass';

/** Move explicit non-local OS proxy exceptions into the single editable rule collection. */
export function migrateBypassRules(config: UserConfig): UserConfig {
  if (
    !Array.isArray(config.bypassLANList) ||
    config.bypassLANList.some((value) => typeof value !== 'string')
  )
    return config;
  const keep: string[] = [];
  const rules: Rule[] = [];
  const ids = new Set((config.customRules ?? []).map((rule) => rule.id));
  let index = 0;
  for (const entry of new Set(config.bypassLANList.map((value) => value.trim()).filter(Boolean))) {
    if (DEFAULT_BYPASS_LAN.includes(entry)) {
      keep.push(entry);
      continue;
    }
    if (entry.includes('*') && !/^[a-zA-Z0-9.*_-]+$/.test(entry)) {
      keep.push(entry);
      continue;
    }
    const ip = isIP(entry);
    const type =
      ip || entry.includes('/') ? 'ipCidr' : entry.includes('*') ? 'domainRegex' : 'domain';
    const value = ip
      ? `${entry}/${ip === 4 ? 32 : 128}`
      : type === 'domainRegex'
        ? `^${entry
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*')}$`
        : entry;
    if (!validateRuleValue(type, value)) {
      // Unknown syntax stays intact for recovery; never silently broaden or drop it.
      keep.push(entry);
      continue;
    }
    let id: string;
    do {
      id = `migrated-bypass-${index++}`;
    } while (ids.has(id));
    ids.add(id);
    rules.push({
      id,
      type,
      values: [value],
      action: 'direct',
      enabled: config.bypassLAN !== false,
    });
  }
  if (!rules.length) return config;
  // OS exceptions formerly preceded all routing rules; preserve this precedence on migration.
  return { ...config, bypassLANList: keep, customRules: [...rules, ...(config.customRules ?? [])] };
}
