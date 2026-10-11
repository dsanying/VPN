import {
  normalizeSubscriptionUsage,
  parseSubscriptionUsage,
  parseSubscriptionUserInfo,
} from '../subscription-usage';
import { isSubscriptionNotice } from '../subscription-notice';
describe('subscription quota metadata', () => {
  test('standard headers are strict and case insensitive', () => {
    expect(
      parseSubscriptionUserInfo(
        'Upload=0; DOWNLOAD=12; total=100; expire=0;total=-1;upload=2garbage'
      )
    ).toEqual({ upload: 0, download: 12, total: 100, expire: 0 });
  });
  test('provider notice entries preserve missing quantities and parse dates and money', () => {
    expect(
      parseSubscriptionUsage(undefined, [
        '剩余流量: 2.5 GB',
        '總流量：10 GiB',
        '账户余额: CNY 12.50',
        '套餐到期: 2027-02-01',
      ])
    ).toMatchObject({
      remaining: 2.5 * 1000 ** 3,
      total: 10 * 1024 ** 3,
      used: 10 * 1024 ** 3 - 2.5 * 1000 ** 3,
      balance: 12.5,
      currency: 'CNY',
    });
    expect(parseSubscriptionUsage(undefined, ['Remaining traffic: 20 GB'])).toEqual({
      remaining: 20 * 1000 ** 3,
    });
    expect(isSubscriptionNotice('remaining traffic: 20 GB')).toBe(true);
    expect(isSubscriptionNotice('香港总流量优化')).toBe(false);
  });
  test('explicit structured metadata supports zero, header wins over notices', () => {
    expect(
      parseSubscriptionUsage({ upload: 1, download: 2, total: 20 }, ['总流量: 8 GB'], {
        usage: { remaining: 0, balance: 0, currency: 'USD' },
      })
    ).toEqual({
      remaining: 17,
      balance: 0,
      currency: 'USD',
      upload: 1,
      download: 2,
      total: 20,
      used: 3,
    });
    expect(
      parseSubscriptionUsage(undefined, [], { proxies: [{ name: 'total', total: 100 }] })
    ).toBeUndefined();
  });
  test('reject malformed dates and numeric values, never infer unlimited from zero', () => {
    expect(
      parseSubscriptionUsage(undefined, ['套餐到期: 2027-02-30', '剩余流量: -3 GB', '余额: NaN'], {
        usage: { total: 0, used: Infinity },
      })
    ).toEqual({ total: 0 });
  });
});

it('uses the same metadata parser across JSON/YAML field casing and explicit byte units', () => {
  expect(
    parseSubscriptionUsage(undefined, [], {
      USER_INFO: {
        Upload: '1 GiB',
        DOWNLOAD: '500 MB',
        TOTAL: '2 GiB',
        BALANCE: '0',
        CURRENCY: 'eur',
      },
      proxies: [{ total: 999 }],
    })
  ).toEqual({
    upload: 1024 ** 3,
    download: 500 * 1000 ** 2,
    total: 2 * 1024 ** 3,
    used: 1024 ** 3 + 500 * 1000 ** 2,
    remaining: 1024 ** 3 - 500 * 1000 ** 2,
    balance: 0,
    currency: 'EUR',
  });
  expect(
    parseSubscriptionUsage(undefined, [], {
      traffic: { total: 'unlimited', used: '1 GB trailing' },
    })
  ).toBeUndefined();
});

it('reconciles incomplete, exhausted and over-limit quotas without fabricating values', () => {
  expect(normalizeSubscriptionUsage({ remaining: 5 })).toEqual({ remaining: 5 });
  expect(normalizeSubscriptionUsage({ used: 3, remaining: 7 })).toEqual({
    used: 3,
    remaining: 7,
    total: 10,
  });
  expect(normalizeSubscriptionUsage({ total: 10, used: 12, remaining: 7 })).toEqual({
    total: 10,
    used: 12,
    remaining: 0,
  });
  expect(normalizeSubscriptionUsage({ total: 0 })).toEqual({ total: 0 });
  expect(normalizeSubscriptionUsage({ total: 10, remaining: 12 })).toEqual({
    total: 10,
    remaining: 12,
  });
  expect(normalizeSubscriptionUsage({ total: NaN, used: -1, remaining: Infinity })).toBeUndefined();
});

it('overflowing upload/download sums never become infinite quota', () => {
  const usage = parseSubscriptionUsage({ upload: 1e308, download: 1e308 }, []);
  expect(usage?.used).toBeUndefined();
  expect(usage?.remaining).toBeUndefined();
});
