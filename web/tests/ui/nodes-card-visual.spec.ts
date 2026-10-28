import { test } from './console-guard';
import { installDesktopMock } from './desktop-mock';

// 截图门禁：节点卡片视觉（名字主位 + 来源标签 + 统一行高纯色卡片），供人工确认。
test('节点卡片截图', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shadowvpn-lang', 'zh-CN'));
  await installDesktopMock(page, {
    fixtures: {
      node: { name: '日本-优化-GPT 直美家宽 01' },
      measurements: {
        n1: { latency: 58, testedAt: Date.now(), detail: { exit: { countryCode: 'JP', ip: '192.0.2.1', provider: 'Cloudflare', measuredAt: Date.now() } } },
        n2: { latency: 141, testedAt: Date.now(), detail: { exit: { countryCode: 'US', ip: '192.0.2.2', provider: 'Cloudflare', measuredAt: Date.now() } } },
      },
    },
  });
  await page.goto('/#/nodes');
  await page.setViewportSize({ width: 960, height: 720 });
  await page.getByRole('region', { name: '节点列表' }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/nodes-card-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/nodes-card-dark.png' });
});
