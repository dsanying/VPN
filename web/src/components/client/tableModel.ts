/** Stable natural ordering of the whole collection, before pagination. */
export function orderRows<T>(
  rows: readonly T[],
  value: (row: T) => unknown,
  identity: (row: T) => string,
  direction: 'ascend' | 'descend' = 'ascend',
  locale?: string
): T[] {
  const compare = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare;
  return [...rows].sort((a, b) => {
    const av = String(value(a) ?? '').trim(),
      bv = String(value(b) ?? '').trim();
    if (!av || !bv) return av ? -1 : bv ? 1 : compare(identity(a), identity(b));
    return (direction === 'ascend' ? 1 : -1) * compare(av, bv) || compare(identity(a), identity(b));
  });
}
export function fittedColumnWidth(title: number, content: number, primary = false): number {
  const padding = 24;
  const floor = Math.ceil((title + padding) / 20) * 20;
  const short = content <= 296 ? Math.ceil((content + padding) / 20) * 20 : primary ? 200 : 320;
  return Math.max(40, floor, short);
}
