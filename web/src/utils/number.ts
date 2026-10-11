/** Numeric presentation is separate from stored values and editable configuration. */
const displayNumber = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 3 });
export function formatNumber(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? displayNumber.format(value) : String(value);
  if (typeof value === 'string') {
    // Only round decimal displays; identifiers and original non-numeric strings stay intact.
    if (/^-?\d+\.\d{4,}$/.test(value.trim()) && Number.isFinite(Number(value))) return displayNumber.format(Number(value));
    return value;
  }
  return value == null ? '' : String(value);
}
