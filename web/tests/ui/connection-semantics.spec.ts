import { test, expect } from './console-guard';
import { installDesktopMock } from './desktop-mock';

for (const mode of ['light', 'dark']) {
  test(`${mode} 连接与等待为绿色，断开与等待为红色`, async ({ page }) => {
    await page.addInitScript(mode => {
      localStorage.setItem('shadowvpn-lang', 'zh-CN');
      localStorage.setItem('shadowvpn-theme', mode);
    }, mode);
    const mock = await installDesktopMock(page, { deferProxy: true });
    await page.goto('/#/');
    const connect = page.getByRole('button', { name: '连接代理', exact: true });
    await expect(connect).toHaveClass(/ant-btn-color-green/);
    const semanticColor = (variable: string) => page.evaluate(variable => {
      const probe = document.createElement('span');
      probe.style.color = `var(${variable})`; document.body.append(probe);
      const color = getComputedStyle(probe).color; probe.remove(); return color;
    }, variable);
    await expect(connect).toHaveCSS('color', await semanticColor('--ds-color-success'));
    await connect.click();
    const starting = page.getByRole('button', { name: /连接代理中$/ });
    await expect(starting).toHaveClass(/ant-btn-color-green/);
    await expect(starting).toHaveCSS('color', await semanticColor('--ds-color-success'));
    await page.evaluate(() => (window as any).finishProxy());
    const disconnect = page.getByRole('button', { name: '断开', exact: true });
    await expect(disconnect).toHaveClass(/ant-btn-color-danger/);
    await expect(disconnect).toHaveCSS('color', await semanticColor('--ds-color-error'));
    await disconnect.click();
    const stopping = page.getByRole('button', { name: /断开中$/ });
    await expect(stopping).toHaveClass(/ant-btn-color-danger/);
    await page.evaluate(() => (window as any).finishProxy());
    await expect(connect).toHaveCSS('color', await semanticColor('--ds-color-success'));
    await mock.expectNoUnexpectedRequests();
  });
}
