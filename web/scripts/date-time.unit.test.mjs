import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

const moduleUrl = new URL('../src/utils/dateTime.ts', import.meta.url).href;
function evaluate(zone, expression) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import * as dates from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(${expression}));`],
    { encoding: 'utf8', env: { ...process.env, TZ: zone } });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

for (const [zone, expected, suffix] of [
  ['UTC', '2026/01/01 00:30:00', '+00:00'],
  ['America/New_York', '2025/12/31 19:30:00', '-05:00'],
  ['Asia/Kolkata', '2026/01/01 06:00:00', '+05:30'],
  ['Europe/Berlin', '2026/01/01 01:30:00', '+01:00'],
  ['Pacific/Auckland', '2026/01/01 13:30:00', '+13:00'],
]) {
  test(`timestamp presentation and millisecond round trip in ${zone}`, () => {
    const value = evaluate(zone, `(() => {
      const event = dates.parseServerTime('2026-01-01T00:30:00.456Z');
      const offset = dates.toOffsetDateTime(event);
      return { display: dates.formatDateTime(event), offset,
        restored: dates.parseServerTime(offset).valueOf(), zone: dates.getDeviceTimeZone(),
        clock: Math.abs(dates.now().valueOf() - Date.now()) };
    })()`);
    assert.equal(value.display, expected);
    assert.ok(value.offset.endsWith(suffix));
    assert.equal(value.restored, Date.UTC(2026, 0, 1, 0, 30, 0, 456));
    assert.ok(value.zone.length > 0);
    assert.ok(value.clock < 1000);
  });
}

test('calendar days stay local and explicit source time zones change instants', () => {
  assert.deepEqual(evaluate('UTC', `[
    dates.formatDate('2026-08-12'), dates.formatDateLabel('2026-08'),
    dates.formatDateTimeMinute('2026-08-12 10:09:08'), dates.formatMonthDay('2026-08-12'),
    dates.formatMonthDayTime('2026-08-12T10:09:08Z'),
    dates.formatDateTime(dates.parseServerTime('2026-08-12 10:09:08', 'America/New_York')),
    dates.formatRelativeTime(dates.now().subtract(2, 'hour')),
    dates.formatDateLabel('model-2026-08-12'), dates.formatDateLabel('10:09')
  ]`), ['2026/08/12', '2026/08', '2026/08/12 10:09', '08/12', '08/12 10:09',
    '2026/08/12 14:09:08', '2 hours ago', 'model-2026-08-12', '10:09']);
});

test('DST gaps reject impossible wall clocks; ambiguous clocks retain supplied offsets', () => {
  const actual = evaluate('America/New_York', `(() => {
    const first = dates.parseServerTime('2026-11-01T01:15:00-04:00');
    const second = dates.parseServerTime('2026-11-01T01:15:00-05:00');
    return { gap: dates.parseServerTime('2026-03-08 02:15:00').isValid(),
      delta: second.valueOf() - first.valueOf(),
      first: dates.toOffsetDateTime(first), second: dates.toOffsetDateTime(second),
      summer: dates.toOffsetDateTime(dates.parseServerTime('2026-06-20T12:00:00Z')),
      range: dates.rangeOfRecentDays(2, '2026-03-08T18:00:00Z') };
  })()`);
  assert.equal(actual.gap, false);
  assert.equal(actual.delta, 3600000);
  assert.ok(actual.first.endsWith('-04:00'));
  assert.ok(actual.second.endsWith('-05:00'));
  assert.ok(actual.summer.endsWith('-04:00'));
  assert.equal(actual.range.startTime, '2026-03-07T00:00:00-05:00');
  assert.equal(actual.range.endTime, '2026-03-08T23:59:59.999-04:00');
});

test('invalid values never turn into the current date, while epoch zero remains valid', () => {
  assert.deepEqual(evaluate('UTC', `[
    ...[null, undefined, '', 'not-a-date', '2026-02-31', '2026-02-31T00:00:00Z',
      '2026-08-12T26:00:00Z', '2026-08-12T10:00:00+88:00', NaN, Infinity, new Date(NaN)]
      .map(value => dates.formatDateTime(value)),
    dates.formatDateTime(0), dates.formatDateTime(new Date('2026-08-12T10:09:08Z'))
  ]`), [...Array(11).fill('—'), '1970/01/01 00:00:00', '2026/08/12 10:09:08']);
});

test('a running process observes time zone changes at the next formatting call', () => {
  const actual = evaluate('UTC', `(() => {
    process.env.TZ = 'Europe/Berlin'; const a = dates.formatDateTime('2026-01-10T12:00:00Z');
    process.env.TZ = 'Asia/Kolkata'; const b = dates.formatDateTime('2026-01-10T12:00:00Z');
    return [a, b];
  })()`);
  assert.deepEqual(actual, ['2026/01/10 13:00:00', '2026/01/10 17:30:00']);
});
