import type { InstalledApplication, Rule, UserConfig } from './types';

type UserRuleConfig = Pick<
  UserConfig,
  'customRules' | 'appRules' | 'appRoutingEnabled' | 'customAppPresets'
>;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Application-directory and exact executable paths share one OR matcher. */
export function applicationRuleValues(application: InstalledApplication): string[] {
  return [
    ...new Set([
      ...(application.processPathRegex ?? []),
      ...(application.processPaths ?? []).map((value) => `^${escapeRegex(value)}$`),
    ]),
  ];
}

/** Legacy application rules ran first. Preserve that order until the user changes it. */
export function unifiedUserRules(config: UserRuleConfig): Rule[] {
  const used = new Set((config.customRules ?? []).map((rule) => rule.id));
  const legacy: Rule[] = [];
  for (const rule of config.appRules ?? []) {
    const application = config.customAppPresets?.find(
      (preset) => preset.id === rule.appId
    )?.installedApplication;
    if (!application) continue;
    let id = `application:${rule.appId}`;
    while (used.has(id)) id += ':';
    used.add(id);
    const { iconDataUrl: _icon, ...identity } = application;
    legacy.push({
      id,
      type: 'processPathRegex',
      values: applicationRuleValues(identity),
      applications: [identity],
      action: rule.action,
      targetServerId: rule.targetServerId,
      enabled: config.appRoutingEnabled === true && rule.enabled,
    });
  }
  return [...legacy, ...(config.customRules ?? []).map(normalizeApplicationRule)];
}

/** Save one ordered list; retain unrelated legacy records, without duplicate active routing. */
export function withUnifiedUserRules<T extends UserRuleConfig>(config: T, rules: Rule[]): T {
  const installed = new Set(
    (config.customAppPresets ?? []).filter((p) => p.installedApplication).map((p) => p.id)
  );
  return {
    ...config,
    customRules: mergeApplicationRuleGroups(rules),
    appRules: (config.appRules ?? []).filter((rule) => !installed.has(rule.appId)),
  };
}

/**
 * 旧版单应用字段（application）归一为 applications 数组（存量配置/备份迁移读取；新写入一律 applications）。
 */
export function normalizeApplicationRule(rule: Rule): Rule {
  if (rule.applications) return rule;
  const legacy = (rule as { application?: InstalledApplication }).application;
  if (!legacy) return rule;
  const { application: _legacy, ...rest } = rule as Rule & { application?: InstalledApplication };
  return { ...rest, applications: [legacy] };
}

/**
 * 应用规则分组存储（单一真值）：多选 N 个应用 = 一条规则（applications 数组 + 单一 processPathRegex
 * 条件承载全部进程匹配值），不再拆成每应用一行——拆行让多选失去意义（用户要求）。
 * 合并边界（用户要求）：只合并「旧版逐应用落盘的存量行」——id 以 `application:` 前缀（appRules 迁移投影，
 * 见 unifiedUserRules）或旧单数 `application` 字段的行。用户在规则页/应用选择器显式创建的规则（uuid id，
 * 见 ApplicationPicker）即使去向/开关/条件完全相同也保持分开——两条同 action 的规则是两次独立意图，
 * 保存不得合并。同键存量行合并取首条位置与 id、拼接 applications 与匹配值（去重），顺序 = 首现顺序。
 * 无应用身份或同键仅一条的规则原样保留，幂等。返回同一数组引用表示无变化。
 */
export function mergeApplicationRuleGroups(rules: Rule[]): Rule[] {
  // 旧版单应用字段（application，仅存量配置/备份里出现）就地归一为 applications 数组（normalizeApplicationRule）。
  const normalized = rules.map(normalizeApplicationRule);
  const normalizedChanged = normalized.some((rule, index) => rule !== rules[index]);
  // 合并资格在归一前判定：`application` 单数字段归一后会消失，须先记录。
  const mergeable = rules.map(
    (rule) =>
      (typeof rule.id === 'string' && rule.id.startsWith('application:')) ||
      'application' in (rule as { application?: unknown })
  );
  const groups = new Map<
    string,
    { first: number; applications: InstalledApplication[]; values: string[] }
  >();
  const merged = new Set<number>();
  for (const [index, rule] of normalized.entries()) {
    if (!rule.applications?.length || !mergeable[index]) continue;
    const key = JSON.stringify([
      rule.action,
      rule.enabled,
      rule.targetServerId ?? null,
      rule.conditions ?? null,
    ]);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        first: index,
        applications: [...rule.applications],
        values: [...rule.values],
      });
      continue;
    }
    merged.add(index);
    const known = new Set(group.applications.map((app) => app.id));
    for (const app of rule.applications) {
      if (!known.has(app.id)) {
        known.add(app.id);
        group.applications.push(app);
      }
    }
    for (const value of rule.values) if (!group.values.includes(value)) group.values.push(value);
  }
  if (merged.size === 0) return normalizedChanged ? normalized : rules;
  const result: Rule[] = [];
  for (const [index, rule] of normalized.entries()) {
    if (merged.has(index)) continue;
    const key = JSON.stringify([
      rule.action,
      rule.enabled,
      rule.targetServerId ?? null,
      rule.conditions ?? null,
    ]);
    const group = groups.get(key);
    if (group && group.first === index) {
      result.push({ ...rule, applications: group.applications, values: group.values });
      continue;
    }
    result.push(rule);
  }
  return result;
}
