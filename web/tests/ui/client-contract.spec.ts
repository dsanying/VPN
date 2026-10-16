import { registerFirefoxPopupPositioningDiagnostic } from './console-guard';
import { expect, test } from './console-guard';

for (const theme of ['light', 'dark']) {
  test(`${theme} shared pagination reaches all records and preserves full-set reorder indices`, async ({
    page,
  }) => {
    await page.goto(`/tests/ui/client-contract-fixture.html?theme=${theme}`);
    registerFirefoxPopupPositioningDiagnostic(page);
    const rows = page.locator('.ant-table-tbody tr[data-row-key]');
    await expect(rows).toHaveCount(10);
    await expect(page.getByText('共 31 条数据')).toBeVisible();
    await page.locator('.ant-pagination-item-2').click();
    const row = rows.first();
    await expect(row).toContainText('record-11');
    await row.focus();
    await row.press('Space');
    await row.press('ArrowDown');
    await row.press('Space');
    await expect(page.getByLabel('move indices')).toHaveText('11:10:11');
    await page.locator('.ant-pagination-item-1').click();
    await expect(rows.first()).toContainText('record-1');
    await page.locator('.ant-pagination-options .ant-select').click();
    await expect(page.getByText('10 条/页', { exact: true }).last()).toBeVisible();
    for (const size of [20, 50, 100])
      await expect(page.getByText(`${size} 条/页`, { exact: true })).toBeVisible();
    await page.getByText('50 条/页', { exact: true }).click();
    await expect(rows).toHaveCount(31);
  });
  test(`${theme} failed save preserves input; cancellation restores and successful save closes`, async ({
    page,
  }) => {
    await page.goto(`/tests/ui/client-contract-fixture.html?theme=${theme}`);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('textbox', { name: '名称', exact: true }).fill('changed');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('textbox', { name: '名称', exact: true })).toHaveValue('changed');
    await expect(page.getByLabel('saved value')).toHaveText('original');
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor).toBeHidden();
    await page.getByRole('button', { name: '允许保存', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(editor.getByRole('textbox', { name: '名称', exact: true })).toHaveValue(
      'original'
    );
    await editor.getByRole('textbox', { name: '名称', exact: true }).fill('committed');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByLabel('saved value')).toHaveText('committed');
  });
  test(`${theme} narrow touch-size form keeps help and immediate multi-selection accessible`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await page.goto(`/tests/ui/client-contract-fixture.html?theme=${theme}`);
  registerFirefoxPopupPositioningDiagnostic(page);
    await page.getByRole('combobox', { name: 'filters', exact: true }).click();
    await page.getByText('警告', { exact: true }).click();
    await page.getByText('错误', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('selected filters')).toHaveText('a,b');
    await page.locator('.ant-select').getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByLabel('selected filters')).toHaveText('');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('dialog').locator('.client-help').focus();
    await expect(page.getByRole('tooltip')).toHaveText('此名称会保存在当前记录中。');
    await expect(page.getByRole('dialog').locator('.ant-drawer-footer').getByRole('button', { name: '关闭', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill('modified');
    await expect(page.getByRole('dialog').getByRole('button', { name: '保存', exact: true })).toBeVisible();
    await expect.poll(async () => page.getByRole('dialog').evaluate(node=>node.getBoundingClientRect().right)).toBeLessThanOrEqual(320);
    const overflow = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('*')].map(node=>({tag:node.tagName,cls:node.className,rect:node.getBoundingClientRect()})).filter(node=>node.rect.right>innerWidth+1).map(node=>({tag:node.tag,cls:node.cls,right:node.rect.right})).slice(0,12)}));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  });
}
