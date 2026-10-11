import { expect, test } from './console-guard';
import { installDesktopMock } from './desktop-mock';
for (const width of [320, 960, 1440])
  for (const language of ['zh-CN', 'en-US']) {
    test(`元数据提示按内容宽度 ${width}px ${language}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.addInitScript((lang) => localStorage.setItem('shadowvpn-lang', lang), language);
      const mock = await installDesktopMock(page, {
        fixtures: {
          measurements: {
            n1: {
              latency: 42,
              testedAt: Date.now(),
              detail: {
                entry: { status: 'ok', latencyMs: 12 },
                exit: {
                  ip: '192.0.2.1',
                  countryCode: 'US',
                  measuredAt: Date.now(),
                  provider: 'Cloudflare',
                },
              },
            },
          },
        },
      });
      await page.goto('/#/nodes');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const trigger = page.locator('.ds-application-icon[role="img"][tabindex="0"]').first();
      await trigger.focus();
      const popup = page.locator('.client-help-popup:visible');
      await expect(popup).toBeVisible();
      const measure = () =>
        popup.evaluate((root) => {
          const rect = root.getBoundingClientRect();
          const text = root.querySelector('.ant-tooltip-container')!;
          const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
          const tops = new Set<number>();
          let node;
          while ((node = walker.nextNode()))
            if (node.textContent?.trim()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const r of range.getClientRects()) if (r.width) tops.add(Math.round(r.top));
            }
          return { x: rect.x, right: rect.right, lines: tops.size, viewport: innerWidth };
        });
      // Ant Design animates the popup after mounting; measure its settled text
      // rather than a frame where the container exists but text has no boxes.
      await expect.poll(async () => {
        const value = await measure();
        return value.lines > 0 && value.x >= 0 && value.right <= value.viewport + 1
          && (width >= 960 ? value.lines === 1 : value.lines > 1);
      }).toBe(true);
      await popup.evaluate(async (root) => {
        await Promise.all(root.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
      });
      const geometry = await measure();
      expect(geometry.x).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
      if (width >= 960) expect(geometry.lines).toBe(1);
      else expect(geometry.lines).toBeGreaterThan(1);
      await mock.expectNoUnexpectedRequests();
    });
  }
