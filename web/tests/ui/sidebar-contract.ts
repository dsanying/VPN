// SPDX-License-Identifier: MIT
import type { Page } from '@playwright/test';

/** All navigation rows share the same rendered typography and hit-target geometry. */
export async function inspectSidebarRegions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    for (const navigation of document.querySelectorAll<HTMLElement>('.ds-basic-layout__sider, .ds-basic-layout__navigation')) {
      if (!navigation.getBoundingClientRect().width) continue;
      const footer = navigation.querySelector('.ds-basic-layout__sider-footer');
      if (!footer) continue;
      // footer 底部的偏好按钮组（主题/语言）与更新入口是有意设计的紧凑动作按钮，
      // 不属于导航项几何一致性约束；其余位置仍禁止出现 .ant-btn。
      const prefs = footer.querySelectorAll('.ds-basic-layout__sider-prefs .ant-btn, .ds-basic-layout__sider-update .ant-btn');
      if (footer.querySelectorAll('.ant-btn').length > prefs.length) issues.push('Footer actions must remain navigation items');
      const rows = [...navigation.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .filter(row => row.getBoundingClientRect().height > 0);
      if (!rows.length) { issues.push('Visible navigation has no menu items'); continue; }
      const reference = rows[0];
      const expected = getComputedStyle(reference);
      for (const row of rows) {
        const actual = getComputedStyle(row);
        const matches = Math.abs(row.getBoundingClientRect().height - reference.getBoundingClientRect().height) < 0.5
          && actual.font === expected.font
          && actual.paddingBlock === expected.paddingBlock
          && actual.paddingInlineStart === expected.paddingInlineStart
          && actual.borderRadius === expected.borderRadius;
        if (!matches) issues.push(`Navigation geometry differs: ${row.textContent}`);
        if (!row.closest('.ds-sidebar-menu')) issues.push('Navigation row lacks shared menu styling');
      }
    }
    return issues;
  });
}
