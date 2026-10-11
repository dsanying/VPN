// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeComputedColor } from '../src/design/tokens.ts';

const colors = new Map([
  ['rgb(17, 34, 51)', '#112233'],
  ['rgb(17 34 51)', '#112233'],
  ['color(srgb 0 1 0)', '#00ff00'],
  ['color(srgb 1 1 1)', '#ffffff'],
  ['rgb(20% 40% 60% / 50%)', 'rgba(51, 102, 153, 0.5)'],
  ['color(srgb 0.2 0.4 0.6 / 0.75)', 'rgba(51, 102, 153, 0.75)'],
  ['rgba(17, 34, 51, 0.125)', 'rgba(17, 34, 51, 0.125)'],
]);
test('public CSS RGB syntax produces chart/editor-compatible color values', () => {
  for (const [css, expected] of colors) assert.equal(normalizeComputedColor(css), expected, css);
});
test('unsupported spaces and malformed numbers never become a usable theme color', () => {
  for (const css of ['oklch(0.6 0.2 120)', 'color(display-p3 0 1 0)', 'rgb(NaN 0 0)', 'rgba(1 2 3 / Infinity)', 'rgb(10oops% 0% 0%)'])
    assert.equal(normalizeComputedColor(css), undefined, css);
});
