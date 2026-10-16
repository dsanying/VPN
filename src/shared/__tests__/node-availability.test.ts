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

it('shares the six-hour boundary with maintenance for successes and failures', () => {
  const now = 1_900_000_000_000;
  expect(NODE_MEASUREMENT_FRESH_MS).toBe(6 * 60 * 60_000);
  for (const latency of [42, -1]) {
    expect(nodeAvailability(latency, now - NODE_MEASUREMENT_FRESH_MS + 1, now)).toBe(
      latency >= 0 ? 'available' : 'failed'
    );
    expect(nodeAvailability(latency, now - NODE_MEASUREMENT_FRESH_MS, now)).toBe('stale');
  }
});

test('enterprise forwarding evidence has the same six-hour freshness, without inventing latency', () => {
  expect(
    nodeAvailability(-1, 1000, 1000, false, 'enterprise-target-unsupported', 'available')
  ).toBe('available');
  expect(nodeAvailability(-1, 1000, 1000, false, 'enterprise-target-unsupported', 'unknown')).toBe(
    'unknown'
  );
  expect(
    nodeAvailability(-1, 1000, 1000 + NODE_MEASUREMENT_FRESH_MS, false, undefined, 'available')
  ).toBe('stale');
  expect(nodeAvailability(-1, 1000, 1000, true, undefined, 'available')).toBe('untested');
});
