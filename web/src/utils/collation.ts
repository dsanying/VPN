const ordering = new Intl.Collator(['zh-CN', 'en-US'], { sensitivity: 'base', numeric: true });
export const compareText = (first: string, second: string): number =>
  ordering.compare(first, second);
export function sortByText<T>(items: readonly T[], label: (item: T) => string): T[] {
  return Array.from(items).sort((a, b) => ordering.compare(label(a), label(b)));
}
