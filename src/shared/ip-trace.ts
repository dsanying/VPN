import type { IpInfo } from './types';

/** Literal-only validation usable in browsers and native business engines. */
export function isIpLiteral(value: string): boolean {
  const ipv4 = (ip: string) => {
    const parts = ip.split('.');
    return (
      parts.length === 4 &&
      parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
    );
  };
  if (ipv4(value)) return true;
  let address = value;
  // Node's isIP also accepts scoped IPv6. Never accept a URL, CIDR or bracketed authority.
  const zone = address.indexOf('%');
  if (zone >= 0) {
    if (!/^[a-zA-Z0-9_.:-]+$/.test(address.slice(zone + 1))) return false;
    address = address.slice(0, zone);
  }
  if (address.includes('.')) {
    const colon = address.lastIndexOf(':');
    if (colon < 0 || !ipv4(address.slice(colon + 1))) return false;
    address = address.slice(0, colon + 1) + '0:0';
  }
  if (!/^[\da-f:]+$/i.test(address)) return false;
  const compressed = address.split('::');
  if (compressed.length > 2) return false;
  const groups = compressed.flatMap((part) => (part ? part.split(':') : []));
  if (!groups.every((part) => /^[\da-f]{1,4}$/i.test(part))) return false;
  return compressed.length === 2 ? groups.length < 8 : groups.length === 8;
}

/** Parse only verified trace facts; portal HTML and malformed addresses cannot become results. */
export function parseIpTrace(body: string): IpInfo | null {
  if (body.length > 64 * 1024) return null;
  const fields = new Map<string, string>();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const separator = line.indexOf('=');
    if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  const ip = fields.get('ip');
  if (!ip || !isIpLiteral(ip)) return null;
  const loc = fields.get('loc')?.toUpperCase();
  return { ip, countryCode: loc && /^[A-Z]{2}$/.test(loc) && loc !== 'XX' ? loc : undefined };
}
