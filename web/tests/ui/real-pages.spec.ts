// SPDX-License-Identifier: MIT
import { expect, test } from './console-guard';
import * as checks from './client-geometry';
import { installDesktopMock } from './desktop-mock';

const measurements = [
  checks.expectNoForcedWraps, checks.expectReadableText,
  checks.expectConsistentActionButtons, checks.expectAlignedActionGroups,
  checks.expectCenteredIcons, checks.expectNoCellOverflows, checks.expectNoColumnWaste,
  checks.expectNoTruncatedQueryControls, checks.expectNoLongDecimals,
  checks.expectNoUnsolicitedNotifications, checks.expectNoEllipsis, checks.expectNoStuckOverflows,
];
const destinations = ['nodes', 'connections', 'rules', 'apps', 'logs', 'settings'];
const environments = [320, 768, 1440].flatMap(width =>
  (['light', 'dark'] as const).flatMap(theme =>
    ['zh-CN', 'en-US'].map(language => ({width, theme, language}))));

for (const environment of environments) {
  test.describe(`${environment.width}px ${environment.theme} ${environment.language}`, () => {
    test.use({viewport: {width: environment.width, height: 900}});
    for (const destination of destinations) {
      test(`${destination}: visible content and actual client geometry`, async ({page}) => {
        await page.addInitScript(({theme, language}) => {
          localStorage.setItem('shadowvpn-theme', theme);
          localStorage.setItem('shadowvpn-lang', language);
        }, environment);
        const requests = await installDesktopMock(page);
        await page.goto(`/#/${destination}`);
        await expect(page.getByRole('heading', {level: 1})).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', environment.theme);
        for (const measure of measurements) await measure(page);
        await requests.expectNoUnexpectedRequests();
      });
    }
  });
}
