import {
  BACKGROUND_REFRESH_MS,
  OBSERVATION_CLOCK_SKEW_MS,
  observationIsFresh,
} from '../background-refresh';
import { measurementExpired } from '../node-availability';
import { dueMeasurementScope } from '../measurement-refresh-scope';
import { createDefaultConfig } from '../config-defaults';
const now = 2_000_000_000_000;
test.each([undefined, null, NaN, Infinity, -1, 'invalid', now - BACKGROUND_REFRESH_MS])(
  'invalid or expired timestamp %p cannot suppress refresh',
  (time) => {
    expect(observationIsFresh(time, now)).toBe(false);
  }
);
test.each([0, OBSERVATION_CLOCK_SKEW_MS - 1, OBSERVATION_CLOCK_SKEW_MS])(
  'filesystem timestamps %p ms ahead of the clock still count as fresh',
  (skew) => {
    expect(observationIsFresh(now + skew, now)).toBe(true);
  }
);
test.each([OBSERVATION_CLOCK_SKEW_MS + 1, BACKGROUND_REFRESH_MS])(
  'timestamps %p ms beyond clock skew cannot suppress refresh',
  (skew) => {
    expect(observationIsFresh(now + skew, now)).toBe(false);
  }
);
test('numeric and ISO observations use the identical six-hour boundary', () => {
  for (const age of [
    0,
    BACKGROUND_REFRESH_MS - 1,
    BACKGROUND_REFRESH_MS,
    BACKGROUND_REFRESH_MS + 1,
  ]) {
    const timestamp = now - age;
    expect(observationIsFresh(timestamp, now)).toBe(age < BACKGROUND_REFRESH_MS);
    expect(observationIsFresh(new Date(timestamp).toISOString(), now)).toBe(
      age < BACKGROUND_REFRESH_MS
    );
    expect(measurementExpired(timestamp, now)).toBe(age >= BACKGROUND_REFRESH_MS);
  }
});
test('startup scope refreshes missing, expired and invalidated observations without repeating fresh ones', () => {
  const config = createDefaultConfig('0123456789abcdef0123456789abcdef');
  config.servers = ['fresh', 'expired', 'missing', 'invalidated'].map((id) => ({
    id,
    name: id,
    protocol: 'vmess',
    address: 'example.com',
    port: 443,
  }));
  config.subscriptions = ['fresh', 'expired', 'missing'].map((id) => ({
    id,
    name: id,
    url: 'https://example.com',
    autoUpdate: true,
    createdAt: new Date(now).toISOString(),
  }));
  expect(
    dueMeasurementScope(
      config,
      {
        fresh: { testedAt: now },
        expired: { testedAt: now - BACKGROUND_REFRESH_MS },
        invalidated: { testedAt: now, detail: { entry: { reason: 'ENTRY_RECHECK_REQUIRED' } } },
      },
      {
        fresh: { checkedAt: new Date(now).toISOString() },
        expired: { checkedAt: new Date(now - BACKGROUND_REFRESH_MS).toISOString() },
      },
      now
    )
  ).toEqual({
    nodeIds: ['expired', 'missing', 'invalidated'],
    subscriptionIds: ['expired', 'missing'],
  });
});
