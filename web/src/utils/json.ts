export const parseJsonText = (input: string): unknown => JSON.parse(input);
export const formatJson = (input: unknown): string | undefined =>
  JSON.stringify(input, undefined, 2);
export function formatUnknownJson(input: unknown, missing = '—'): string {
  if (input == null || input === '') return missing;
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return input;
    }
  }
  try {
    return JSON.stringify(value, undefined, 2) ?? missing;
  } catch {
    return String(input);
  }
}
