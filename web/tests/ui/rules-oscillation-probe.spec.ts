import { test, expect } from './console-guard';
import { installDesktopMock } from './desktop-mock';

// 复现规则页整页抖动的探针：共享 Table 的列宽自测量曾是反馈环（换行态量得窄 → 列宽收窄 →
// 维持换行），在应用规则多标签行形成双稳态，行高 73↔105px 约 4Hz 翻转并带动整页左右跳动。
// 探针在应用规则行注入 5 个应用标签（同 action 的 appRules 会被 mergeApplicationRuleGroups
// 合并为一行），然后高频采样行高与匹配值列宽，断言状态唯一（不再翻转）。
const APPS = ['Google Chrome', 'ZCode', 'WeChat', 'OpenChamber', 'Firefox'].map((name, index) => ({
  id: `probe-app-${index + 1}`,
  name,
  path: `/Applications/${name}.app`,
  processPaths: [`/Applications/${name}.app/Contents/MacOS/main`],
  processPathRegex: [`^/Applications/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.app/`],
  coverage: 'bundle',
}));

test('规则页应用规则行布局稳定（列宽测量反馈环回归探针）', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  await installDesktopMock(page, { extraApps: APPS });
  await page.goto('/#/rules');
  await expect(page.getByRole('heading', { level: 1, name: '规则', exact: true })).toBeVisible();
  await page.evaluate((apps) => {
    const store = (window as unknown as { desktopTest: { getConfig: () => Record<string, unknown> } }).desktopTest;
    const config = structuredClone(store.getConfig()) as Record<string, unknown>;
    config.customAppPresets = apps.map((app: (typeof apps)[number]) => ({ id: app.id, name: app.name, installedApplication: app }));
    config.appRules = apps.map((app: (typeof apps)[number]) => ({ appId: app.id, action: 'direct', enabled: true }));
    void (window as unknown as { electron: { ipcRenderer: { invoke: (channel: string, args: unknown) => Promise<unknown> } } })
      .electron.ipcRenderer.invoke('config:save', { config });
  }, APPS);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.locator('.ds-application-icon').first()).toBeVisible();
  await page.waitForTimeout(400);

  const samples: string[] = [];
  for (let index = 0; index < 40; index += 1) {
    const state = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.ant-table-tbody tr')]
        .find((node) => node.querySelectorAll('.ds-application-icon').length >= 5);
      if (!row) return 'no-app-row';
      const cells = [...row.querySelectorAll('td')].map((cell) => Math.round(cell.getBoundingClientRect().width));
      return `rowH=${Math.round(row.getBoundingClientRect().height)} tds=${cells.join(',')}`;
    });
    samples.push(state);
    await page.waitForTimeout(120);
  }
  const states = [...new Set(samples)];
  expect(states, `应用规则行在 ${states.length} 种布局间翻转：\n${states.join('\n')}`).toHaveLength(1);
});
