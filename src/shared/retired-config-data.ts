import { ruleConditions } from './rules';
import type { UserConfig } from './types';

/** Remove obsolete runtime controls at every configuration boundary. */
export function clearRetiredRuntimeSettings(config: UserConfig): boolean {
  let changed = false;
  const raw = config as unknown as Record<string, unknown>;
  for (const key of [
    'autoCheckUpdate',
    'autoUpdateCore',
    'mainSessionViaProxy',
    'autoUpdateSubscriptionOnStart',
    'subscriptionUpdateIntervalHours',
    'blockQuic',
    'speedTestUrl',
    'logLevel',
    'diagnosticCapture',
    'helperPromptDismissed',
    'helperDisabledPromptDismissed',
    'helperUpgradePromptDismissed',
  ]) {
    if (key in raw) {
      delete raw[key];
      changed = true;
    }
  }
  const dns = config.dnsConfig as unknown as Record<string, unknown> | undefined;
  for (const key of ['enableFakeIp', 'fakeIpToggleMigrated', 'fakeIpTunAutoEnable']) {
    if (dns && key in dns) {
      delete dns[key];
      changed = true;
    }
  }
  return changed;
}

/** Explicit removal, not compatibility: obsolete resources and dependent rules are discarded. */
export function clearRetiredConfigData(config: UserConfig): boolean {
  let changed = clearRetiredRuntimeSettings(config);
  const raw = config as unknown as Record<string, unknown>;
  for (const key of [
    'ruleResources',
    'ruleResourceAutoUpdate',
    'ruleResourceUpdateIntervalHours',
    'builtinGeoMeta',
    'subscriptionProxyPolicy',
    'subscriptionUpdateViaProxy',
    'subscriptionUserAgent',
  ]) {
    if (key in raw) {
      delete raw[key];
      changed = true;
    }
  }
  for (const subscription of config.subscriptions ?? []) {
    const source = subscription as unknown as Record<string, unknown>;
    for (const key of ['updateViaProxy', 'userAgent', 'protocolPreference']) {
      if (key in source) {
        delete source[key];
        changed = true;
      }
    }
  }
  const rules = (config.customRules ?? []).filter(
    (rule) =>
      !ruleConditions(rule).some((condition) =>
        ['geosite', 'geoip', 'ruleSet'].includes(condition.type)
      )
  );
  if (rules.length !== (config.customRules ?? []).length) {
    config.customRules = rules;
    changed = true;
  }
  if (config.customRuleSets?.length) {
    config.customRuleSets = [];
    changed = true;
  }
  const presets = (config.customAppPresets ?? [])
    .filter((preset) => preset.installedApplication)
    .map((preset) => {
      if ((preset.geositeTags ?? []).length || preset.geoipTags?.length) {
        changed = true;
        return { ...preset, geositeTags: [], geoipTags: undefined };
      }
      return preset;
    });
  if (presets.length !== (config.customAppPresets ?? []).length) changed = true;
  if (changed && config.customAppPresets) config.customAppPresets = presets;
  const installedIds = new Set(presets.map((preset) => preset.id));
  const apps = (config.appRules ?? []).filter((rule) => installedIds.has(rule.appId));
  if (apps.length !== (config.appRules ?? []).length) {
    config.appRules = apps;
    changed = true;
  }
  return changed;
}
