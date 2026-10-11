/** Host-independent encoding: identical UTF-8/Base64 semantics in Node and Android WebView. */
export function decodeBase64Utf8(value: string): string {
  const normalized = value
    .split('=')[0]
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/]/g, '');
  const usable = normalized.length % 4 === 1 ? normalized.slice(0, -1) : normalized;
  const bytes = Uint8Array.from(atob(usable), (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}
export function encodeBase64Utf8(value: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded;
}
/** URL's IPv6 grammar, with Node-compatible scoped literals. No network lookup. */
export function isIpv6Literal(value: string): boolean {
  if (!value.includes(':') || value.includes('[') || value.includes(']')) return false;
  const [address, zone, ...rest] = value.split('%');
  if (rest.length || (zone !== undefined && !/^[0-9A-Za-z.:-]+$/.test(zone))) return false;
  try {
    return new URL(`http://[${address}]/`).hostname.startsWith('[');
  } catch {
    return false;
  }
}
