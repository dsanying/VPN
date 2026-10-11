import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatNumber } from '../src/utils/number.ts';

test('presentation rounds finite decimals without changing editable identities', () => {
  const decimals = [2.7182818, -2.7182818, 0.0001, '12.345678'];
  assert.deepEqual(decimals.map(formatNumber), ['2.718', '-2.718', '0', '12.346']);
  for (const id of ['00123', '00123.40', 'node-42', ' 42 ', '1e3']) assert.equal(formatNumber(id), id);
});

test('nulls, integer values and special numeric values have deterministic representations', () => {
  assert.deepEqual([null, undefined, 0, -7, Infinity, NaN].map(formatNumber), ['', '', '0', '-7', 'Infinity', 'NaN']);
});
