import type { SubscriptionConfig } from './types';
type Usage = NonNullable<SubscriptionConfig['userInfo']>;
const nonnegative = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
export function parseSubscriptionUserInfo(header: string | null): Usage | undefined {
  const result: Usage = {};
  for (const part of (header ?? '').split(';')) {
    const match = /^\s*(upload|download|total|expire)\s*=\s*(\d+(?:\.\d+)?)\s*$/i.exec(part);
    if (match) {
      const value = nonnegative(match[2]);
      if (value !== undefined)
        result[match[1].toLowerCase() as 'upload' | 'download' | 'total' | 'expire'] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
}
function bytes(value: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(B|[KMGT]i?B)\s*$/i.exec(value);
  if (!match) return undefined;
  const power = ['B', 'K', 'M', 'G', 'T'].indexOf(match[2][0].toUpperCase());
  // Explicit SI units use decimal bytes; IEC units use binary bytes.
  const number = Number(match[1]) * (/i/i.test(match[2]) ? 1024 : 1000) ** power;
  return Number.isFinite(number) ? number : undefined;
}
export function parseSubscriptionUsage(
  header: Usage | undefined,
  notices: string[],
  structured?: unknown
): Usage | undefined {
  const body: Usage = {};
  // Only explicit account metadata containers are inspected; node fields are never interpreted as quota.
  if (structured && typeof structured === 'object') {
    const root = structured as Record<string, unknown>;
    for (const [key, item] of Object.entries(root)) {
      if (
        !['userinfo', 'usage', 'traffic', 'subscription'].includes(
          key.replace(/[-_]/g, '').toLowerCase()
        )
      )
        continue;
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      for (const [fieldName, rawValue] of Object.entries(item)) {
        const field = fieldName.toLowerCase();
        if (['upload', 'download', 'total', 'used', 'remaining'].includes(field)) {
          const value =
            nonnegative(rawValue) ?? (typeof rawValue === 'string' ? bytes(rawValue) : undefined);
          if (value !== undefined)
            body[field as 'upload' | 'download' | 'total' | 'used' | 'remaining'] = value;
        } else if (field === 'expire' || field === 'balance') {
          const value = nonnegative(rawValue);
          if (value !== undefined) body[field] = value;
        } else if (
          field === 'currency' &&
          typeof rawValue === 'string' &&
          /^[a-z]{3}$/i.test(rawValue)
        ) {
          body.currency = rawValue.toUpperCase();
        }
      }
    }
  }
  for (const name of notices) {
    const match =
      /^\s*(剩余流量|剩餘流量|已用流量|已使用流量|总流量|總流量|流量总额|traffic remaining|remaining traffic|used traffic|total traffic|套餐到期|订阅到期|訂閱到期|到期时间|到期時間|expires?|expiry|账户余额|帳戶餘額|余额|餘額|balance)\s*[:：]\s*(.+?)\s*$/i.exec(
        name
      );
    if (!match) continue;
    const [, label, value] = match;
    if (/到期|expire|expiry/i.test(label)) {
      // A date-only expiry is midnight in the device timezone, never an inferred UTC date.
      const date = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(value);
      if (date) {
        const d = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
        if (
          d.getFullYear() === Number(date[1]) &&
          d.getMonth() === Number(date[2]) - 1 &&
          d.getDate() === Number(date[3])
        )
          body.expire = d.valueOf() / 1000;
      } else {
        const epoch = nonnegative(value);
        if (epoch !== undefined && epoch >= 1e9 && epoch < 1e11) body.expire = epoch;
      }
    } else if (/余额|餘額|balance/i.test(label)) {
      const money =
        /^(?:(CNY|USD|EUR|HKD|JPY)\s*|([¥￥$€])\s*)?(\d+(?:\.\d+)?)\s*(元|CNY|USD|EUR|HKD|JPY)?$/i.exec(
          value
        );
      if (money && nonnegative(money[3]) !== undefined) {
        body.balance = Number(money[3]);
        body.currency = (
          money[1] ??
          (money[4] === '元' ? 'CNY' : money[4]) ??
          money[2]
        )?.toUpperCase();
      }
    } else {
      const amount = bytes(value);
      if (amount !== undefined)
        body[
          /剩|remaining/i.test(label) ? 'remaining' : /已|used/i.test(label) ? 'used' : 'total'
        ] = amount;
    }
  }
  return normalizeSubscriptionUsage({ ...body, ...header });
}

/** Reconcile known quantities without inventing zero or unlimited quotas. */
export function normalizeSubscriptionUsage(info: Usage): Usage | undefined {
  const result: Usage = {};
  for (const field of [
    'upload',
    'download',
    'total',
    'used',
    'remaining',
    'expire',
    'balance',
  ] as const) {
    const value = nonnegative(info[field]);
    if (value !== undefined) result[field] = value;
  }
  if (info.currency !== undefined) result.currency = info.currency;
  if (result.upload !== undefined && result.download !== undefined) {
    const used = result.upload + result.download;
    if (Number.isFinite(used)) result.used = used;
    else {
      delete result.used;
      delete result.remaining;
    }
  }
  if (result.total === undefined && result.used !== undefined && result.remaining !== undefined) {
    const total = result.used + result.remaining;
    if (Number.isFinite(total)) result.total = total;
  }
  if (result.total !== undefined && result.used !== undefined)
    result.remaining = Math.max(0, result.total - result.used);
  else if (
    result.total !== undefined &&
    result.remaining !== undefined &&
    result.remaining <= result.total
  )
    result.used = result.total - result.remaining;
  return Object.keys(result).length ? result : undefined;
}
