import type { UserConfig } from './types';
/** Retire desktop-only state at the host boundary, including imported backups. */
export function applyAndroidConfigPolicy(config: UserConfig): void {
  config.proxyModeType = 'tun';
  // Required fields remain explicit disabled facts in the common schema, never selectable preferences.
  config.autoStart = false;
  config.minimizeToTray = false;
  config.autoSwitchNode = false;
  for (const key of [
    'windowBounds',
    'rememberWindowSize',
    'hardwareAcceleration',
    'windowEffects',
    'desktopNotifications',
    'helperUpgradePromptDismissed',
    'autoPrivacyMode',
    'privacyPassword',
  ])
    delete (config as unknown as Record<string, unknown>)[key];
}
