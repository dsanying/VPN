import { isIP } from 'net';
export interface GatewayResources {
  domains: string[];
  suffixes?: string[];
  cidrs: string[];
}
/** Bound untrusted gateway data and reject full-tunnel routes, wildcard catchalls and IPv6. */
export function parseGatewayResources(value: unknown): GatewayResources {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const cleanDomains = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.slice(0, 1024).flatMap((d) => {
          if (typeof d !== 'string') return [];
          const name = d.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
          return name.length <= 253 &&
            name.includes('.') &&
            !isIP(name) &&
            name.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
            ? [name]
            : [];
        })
      : [];
  // Gateways may push near-full-tunnel lists (e.g. 1.0.0.0/8 plus reserved space).
  // Keep private/internal ranges and narrow public routes; reject reserved space
  // and public prefixes wider than /16 — those are filler, not intranet resources.
  const ipv4Number = (ip: string) =>
    ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
  const isInternalRange = (ip: number) =>
    ip >>> 24 === 10 || // RFC1918 10/8
    ip >>> 20 === 0xac1 || // 172.16/12
    ip >>> 16 === 0xc0a8 || // 192.168/16
    ip >>> 22 === 0x191; // CGNAT 100.64/10
  const isReservedRange = (ip: number) =>
    ip >>> 24 === 0 || // 0.0.0.0/8
    ip >>> 24 === 127 || // loopback
    ip >>> 16 === 0xa9fe || // link-local
    ip >>> 24 >= 224; // multicast and reserved
  const cidrs = Array.isArray(data.cidrs)
    ? data.cidrs.slice(0, 1024).filter((v): v is string => {
        if (typeof v !== 'string') return false;
        const parts = v.split('/');
        if (
          parts.length !== 2 ||
          isIP(parts[0]) !== 4 ||
          !/^\d{1,2}$/.test(parts[1]) ||
          Number(parts[1]) < 8 ||
          Number(parts[1]) > 32
        )
          return false;
        const ip = ipv4Number(parts[0]);
        const bits = Number(parts[1]);
        if (isReservedRange(ip)) return false;
        return isInternalRange(ip) || bits >= 16;
      })
    : [];
  return {
    domains: [...new Set(cleanDomains(data.domains))],
    ...(Array.isArray(data.suffixes)
      ? { suffixes: [...new Set(cleanDomains(data.suffixes))] }
      : {}),
    cidrs: [...new Set(cidrs)],
  };
}
