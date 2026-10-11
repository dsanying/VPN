/** Network values arrive in bytes. Display decimal units (1000 B = 1 KB). */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'] as const;
const numberFormat = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  maximumFractionDigits: 2,
});

export function formatDataSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // Rounding near a boundary must not produce "1000 KB".
  if (Number(numberFormat.format(value)) >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${numberFormat.format(value)} ${UNITS[unit]}`;
}

export function formatDataRate(bytesPerSecond: number | null | undefined): string {
  const size = formatDataSize(bytesPerSecond);
  return size === '—' ? size : `${size}/s`;
}
