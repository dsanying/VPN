/** Last defense shared by storage, IPC display and diagnostic export. Never interpolate real credentials into fixtures. */
export function redactLogText(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*(?:PRIVATE KEY|PRIVATE)-----[\s\S]*?-----END [^-]+-----/g,
      '<redacted-private-key>'
    )
    .replace(
      /\b(?:vmess|vless|trojan|ssr?|hysteria2?|hy2|tuic):\/\/[^\s<>"']+/gi,
      '<redacted-link>'
    )
    .replace(/https?:\/\/[^\s<>"'）)]+/gi, (value) => {
      try {
        const url = new URL(value);
        if (url.pathname !== '/') url.pathname = '/<redacted-path>';
        if (url.username || url.password) {
          url.username = '<redacted>';
          url.password = '';
        }
        for (const key of new Set(url.searchParams.keys())) url.searchParams.set(key, '<redacted>');
        if (url.hash) url.hash = '<redacted>';
        return url.toString();
      } catch {
        return '<redacted-url>';
      }
    })
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<redacted-uuid>'
    )
    .replace(/\b(authorization\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;]+/gi, '$1<redacted>')
    .replace(/\b(cookie|set-cookie)\s*:\s*[^\r\n]+/gi, '$1: <redacted>')
    .replace(
      /(["']?(?:(?:privacy|obfs|tls[_-]?)?password|passwd|uuid|private[_-]?key(?:passphrase)?|preshared[_-]?key|psk|(?:clashApi)?secret|(?:access[_-]?|refresh[_-]?)?token|auth[_-]?key|api[_-]?key)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}&]+)/gi,
      '$1<redacted>'
    );
}
