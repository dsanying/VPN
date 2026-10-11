import { applicationRuleValues, unifiedUserRules, withUnifiedUserRules } from '../unified-rules';
import type { InstalledApplication, Rule, UserConfig } from '../types';

const application: InstalledApplication = {
  id: 'example',
  name: 'Example',
  path: '/Applications/Example.app',
  processPaths: ['/opt/example/main'],
  processPathRegex: ['^/Applications/Example\\.app/'],
  coverage: 'bundle',
  iconDataUrl: 'runtime-only',
};
const domain: Rule = {
  id: 'domain',
  type: 'domainSuffix',
  values: ['example.com'],
  action: 'proxy',
  enabled: true,
};
const config = (
  enabled = true
): Pick<
  UserConfig,
  'customRules' | 'appRules' | 'appRoutingEnabled' | 'customAppPresets' | 'proxyMode'
> => ({
  customRules: [domain],
  appRules: [{ appId: 'example', action: 'direct', enabled: true }],
  appRoutingEnabled: enabled,
  customAppPresets: [
    {
      id: 'example',
      name: 'Example',
      emoji: '',
      geositeTags: [],
      installedApplication: application,
    },
  ],
  proxyMode: 'direct',
});

it('preserves legacy application-first order and disabled state without storing runtime icons', () => {
  const rules = unifiedUserRules(config(false));
  expect(rules.map((r) => r.id)).toEqual(['application:example', 'domain']);
  expect(rules[0].enabled).toBe(false);
  expect(rules[0].application?.iconDataUrl).toBeUndefined();
});
it('one reordered list persists domain before application without a duplicate legacy route or mode change', () => {
  const current = config();
  const rules = unifiedUserRules(current);
  const saved = withUnifiedUserRules(current, [rules[1], rules[0]]);
  expect(saved.proxyMode).toBe('direct');
  expect(saved.appRules).toEqual([]);
  expect(unifiedUserRules(saved).map((r) => r.id)).toEqual(['domain', 'application:example']);
  expect(withUnifiedUserRules(saved, unifiedUserRules(saved))).toEqual(saved);
  expect(current.appRules).toHaveLength(1);
});
it('escapes exact executable paths, including Windows, and includes app helpers', () => {
  const values = applicationRuleValues({
    ...application,
    processPaths: ['C:\\Apps\\Example (1).exe'],
  });
  expect(values.some((v) => new RegExp(v).test('C:\\Apps\\Example (1).exe'))).toBe(true);
  expect(values.some((v) => new RegExp(v).test('C:\\Apps\\Example 1.exe'))).toBe(false);
  expect(
    values.some((v) => new RegExp(v).test('/Applications/Example.app/Contents/Frameworks/Helper'))
  ).toBe(true);
  expect(
    values.some((v) => new RegExp(v).test('/Applications/ExampleXapp/Contents/MacOS/Main'))
  ).toBe(false);
});
it('avoids ID collision and retains unrelated legacy records', () => {
  const current = {
    ...config(),
    customRules: [{ ...domain, id: 'application:example' }],
    appRules: [...config().appRules!, { appId: 'other', action: 'block' as const, enabled: false }],
  };
  const rules = unifiedUserRules(current);
  expect(new Set(rules.map((r) => r.id)).size).toBe(2);
  expect(withUnifiedUserRules(current, rules).appRules).toEqual([
    { appId: 'other', action: 'block', enabled: false },
  ]);
});
