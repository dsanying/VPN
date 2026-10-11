import catalog from './diagnostic-text.json';
export function diagnosticText(id: number, args: unknown[], language: string): string {
  const item = catalog[id];
  return (language.startsWith('en') ? item.en : item.zh).replace(/\{(\d+)\}/g, (_, n: string) =>
    String(args[Number(n)] ?? '')
  );
}
