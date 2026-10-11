import { applyAndroidConfigPolicy } from '../android-config-policy';
import { createDefaultConfig } from '../config-defaults';
import { validateUserConfig } from '../config-validation';
it('retires desktop-only preferences while preserving portable choices and the common schema', () => {
  const config = createDefaultConfig('fictional-secret');
  Object.assign(config, {
    autoStart: true,
    minimizeToTray: true,
    autoSwitchNode: true,
    autoConnect: true,
    proxyModeType: 'systemProxy',
    windowBounds: { width: 900, height: 700 },
    hardwareAcceleration: false,
    helperUpgradePromptDismissed: true,
    language: 'en-US',
  });
  applyAndroidConfigPolicy(config);
  validateUserConfig(config);
  applyAndroidConfigPolicy(config);
  expect(config).toMatchObject({
    autoStart: false,
    minimizeToTray: false,
    autoSwitchNode: false,
    autoConnect: true,
    proxyModeType: 'tun',
    language: 'en-US',
  });
  expect(config.windowBounds).toBeUndefined();
  expect(config.hardwareAcceleration).toBeUndefined();
  expect(config).not.toHaveProperty('helperUpgradePromptDismissed');
  const before = structuredClone(config);
  applyAndroidConfigPolicy(config);
  expect(config).toEqual(before);
});
