import {
  applicationRuleValues,
  mergeApplicationRuleGroups,
  unifiedUserRules,
  withUnifiedUserRules,
} from '../unified-rules';
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
  expect(rules[0].applications?.[0].iconDataUrl).toBeUndefined();
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

describe('mergeApplicationRuleGroups — 应用规则按多选分组存储', () => {
  const app2: InstalledApplication = {
    ...application,
    id: 'example-2',
    name: 'Example 2',
    path: '/Applications/Example2.app',
    processPathRegex: ['^/Applications/Example2\\.app/'],
    processPaths: [],
  };
  const appRule = (over: Partial<Rule>): Rule => ({
    id: 'app',
    type: 'processPathRegex',
    values: applicationRuleValues(application),
    applications: [{ ...application, iconDataUrl: undefined }],
    action: 'proxy',
    enabled: true,
    ...over,
  });

  it('同去向/开关/目标的单应用存量行（application: 前缀 id）合并为一条多选规则，取首条位置与 id，值去重拼接', () => {
    const merged = mergeApplicationRuleGroups([
      { ...domain, id: 'domain' },
      appRule({ id: 'application:preset-1' }),
      appRule({
        id: 'application:preset-2',
        applications: [{ ...app2, iconDataUrl: undefined }],
        values: applicationRuleValues(app2),
      }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1]!.id).toBe('application:preset-1');
    expect(merged[1]!.applications).toHaveLength(2);
    expect(merged[1]!.values).toEqual([
      ...new Set([...applicationRuleValues(application), ...applicationRuleValues(app2)]),
    ]);
    // 幂等：再合并无变化。
    expect(mergeApplicationRuleGroups(merged)).toEqual(merged);
  });

  it('用户显式创建的规则（uuid id）即使去向/开关/条件完全相同也保持分开，不自动合并', () => {
    const rules = [
      appRule({ id: '0f0e0d0c-1111-4222-8333-444455556666' }),
      appRule({
        id: 'aabbccdd-1111-4222-8333-444455556667',
        applications: [{ ...app2, iconDataUrl: undefined }],
        values: applicationRuleValues(app2),
      }),
      // 存量行与 uuid 规则也不跨类合并：合并仅限存量行之间。
      appRule({ id: 'application:preset-3' }),
    ];
    expect(mergeApplicationRuleGroups(rules)).toEqual(rules);
  });

  it('去向或目标不同不合并；无应用身份的规则不受影响', () => {
    const rules = [
      appRule({ id: 'p1', targetServerId: 'node-a' }),
      appRule({ id: 'p2', targetServerId: 'node-b' }),
      appRule({ id: 'd1', action: 'direct' as const }),
      appRule({ id: 'off', enabled: false }),
    ];
    const merged = mergeApplicationRuleGroups(rules);
    expect(merged.map((r) => r.id)).toEqual(['p1', 'p2', 'd1', 'off']);
  });
});

it('旧版单数字段（application）的存量行归一并按组合并（旧字段本身即合并资格）', () => {
  const legacy = (id: string, name: string, regex: string) =>
    ({
      id,
      type: 'processPathRegex',
      values: [regex],
      application: { ...application, id, name, iconDataUrl: undefined },
      action: 'direct',
      enabled: true,
    }) as unknown as Rule;
  const merged = mergeApplicationRuleGroups([
    legacy('application:a1', 'App One', '^/Applications/AppOne\\.app/'),
    legacy('application:a2', 'App Two', '^/Applications/AppTwo\\.app/'),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.id).toBe('application:a1');
  expect(merged[0]!.applications!.map((a) => a.name)).toEqual(['App One', 'App Two']);
  expect((merged[0] as unknown as { application?: unknown }).application).toBeUndefined();
  expect(mergeApplicationRuleGroups(merged)).toEqual(merged);
});
