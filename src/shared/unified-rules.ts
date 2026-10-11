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
      application: identity,
      action: rule.action,
      targetServerId: rule.targetServerId,
      enabled: config.appRoutingEnabled === true && rule.enabled,
    });
  }
  return [...legacy, ...(config.customRules ?? [])];
}

/** Save one ordered list; retain unrelated legacy records, without duplicate active routing. */
export function withUnifiedUserRules<T extends UserRuleConfig>(config: T, rules: Rule[]): T {
  const installed = new Set(
    (config.customAppPresets ?? []).filter((p) => p.installedApplication).map((p) => p.id)
  );
  return {
    ...config,
    customRules: rules,
    appRules: (config.appRules ?? []).filter((rule) => !installed.has(rule.appId)),
  };
}
