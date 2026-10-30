import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';
import {
  collectOffHeightCharts,
  expectEfficientSummaryStrips,
  expectNoForcedWraps,
  expectNoCellOverflows,
  expectNoStuckOverflows,
} from './client-geometry';

for (const language of ['zh-CN', 'en-US']) {
  for (const width of [540, 900, 1440]) {
    test(`客户端状态与指标按内容并排 ${width}px ${language}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.addInitScript((lang) => localStorage.setItem('shadowvpn-lang', lang), language);
      const mock = await installDesktopMock(page, { running: true });
      await page.goto('/#/connections');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => {
        const ids = [
          'google',
          'youtube',
          'instagram',
          'facebook',
          'twitter',
          'telegram',
          'tiktok',
          'github',
          'wikipedia',
          'reddit',
          'chatgpt',
          'claude',
          'gemini',
          'netflix',
          'disney',
          'spotify',
        ];
        (window as any).desktopTest.emit('event:unlockUpdated', {
          results: Object.fromEntries(
            ids.map((id) => [
              id,
              {
                status: id === 'netflix' ? 'blocked' : 'ok',
                httpStatus: id === 'netflix' ? 451 : 200,
                latencyMs: id === 'netflix' ? 451 : 120,
              },
            ])
          ),
          checkedAt: Date.now(),
          egress: { ip: '203.0.113.2' },
        });
      });
      const websites = page
        .locator('[data-layout="desktop-section"]')
        .filter({
          has: page.getByRole('heading', {
            name: language === 'zh-CN' ? '网站连通性' : 'Website connectivity',
            exact: true,
          }),
        });
      await expect(websites.locator('.service-availability-item')).toHaveCount(16);
      await expect(websites.getByText('120 ms', { exact: true })).toHaveCount(15);
      const geometry = await websites.evaluate((section) => {
        const heading = section.querySelector('h2, h3, h4')!.getBoundingClientRect();
        const button = section.querySelector('button')!.getBoundingClientRect();
        const cells = [...section.querySelectorAll<HTMLElement>('.service-availability-item')].map(
          (cell) => {
            const tag = cell.querySelector('.ant-tag')!.getBoundingClientRect();
            const icon = cell.querySelector('svg')!.getBoundingClientRect();
            return {
              top: Math.round(cell.getBoundingClientRect().top),
              left: Math.round(cell.getBoundingClientRect().left),
              leftName: Math.round(icon.left),
              tag,
              cell: cell.getBoundingClientRect(),
            };
          }
        );
        // 表格感：按栅格列分组（同行内从左到右），同列的「图标/词条起点」跨行必须竖直对齐（±1px）。
        const rows = new Map<number, typeof cells>();
        for (const c of cells) rows.set(c.top, [...(rows.get(c.top) ?? []), c]);
        const columns = [...rows.values()].sort((a, b) => a[0].left - b[0].left);
        const columnCount = columns[0]?.length ?? 0;
        const columnLefts: number[] = [];
        for (const col of Array.from({ length: columnCount }, (_, i) =>
          columns.map((row) => row[i]).filter(Boolean)
        )) {
          columnLefts.push(col[0].left);
          if (
            col.some(
              (c) =>
                Math.abs(c.left - col[0].left) > 1 || Math.abs(c.leftName - col[0].leftName) > 1
            )
          )
            return { headerOffset: 0, misaligned: true, cells: [] };
        }
        return {
          headerOffset: Math.abs(heading.y + heading.height / 2 - button.y - button.height / 2),
          misaligned: false,
          cells: cells.map((c) => ({
            height: c.cell.height,
            centers: Math.abs(c.tag.y + c.tag.height / 2 - c.cell.y - c.cell.height / 2),
          })),
        };
      });
      expect(geometry.headerOffset).toBeLessThan(8);
      expect(geometry.misaligned).toBe(false);
      for (const cell of geometry.cells) {
        expect(cell.height).toBeLessThan(60);
        expect(cell.centers).toBeLessThan(4);
      }
      await expectEfficientSummaryStrips(page);
      await expect.poll(() => collectOffHeightCharts(page)).toEqual([]);
      await expectNoForcedWraps(page);
      await expectNoCellOverflows(page);
      await expectNoStuckOverflows(page);
      await page.goto('/#/nodes');
      await expect(
        page.getByRole('list', { name: /^(节点|nodes)$/i }).getByRole('listitem')
      ).toHaveCount(1);
      await mock.expectNoUnexpectedRequests();
    });
  }
}
