import { nodeAvailability, NODE_MEASUREMENT_FRESH_MS } from '../node-availability';
test('only a fresh actual proxy result proves availability', () => {
  const now = 1_900_000_000_000;
  expect(nodeAvailability(42, now, now)).toBe('available');
  expect(nodeAvailability(-1, now, now)).toBe('failed');
  expect(nodeAvailability(42, now - NODE_MEASUREMENT_FRESH_MS - 1, now)).toBe('stale');
  expect(nodeAvailability(42, undefined, now)).toBe('untested');
  expect(nodeAvailability(42, now, now, true)).toBe('untested');
  expect(nodeAvailability(NaN, now, now)).toBe('untested');
  expect(nodeAvailability(42, now + 1, now)).toBe('stale');
});

it('local probe failures cannot label the remote node unavailable', () => {
  for (const reason of ['core-not-ready', 'select-failed', 'exception', 'unusable'])
    expect(nodeAvailability(-1, 1000, 1000, false, reason)).toBe('unknown');
  expect(nodeAvailability(-1, 1000, 1000, false, 'tunnel-ECONNRESET')).toBe('failed');
});
