/** Last defense shared by storage, IPC display and diagnostic export. Never interpolate real credentials into fixtures. */
import { SUPPORTED_URL_SCHEMES } from './protocol-url-schemes';

// 节点分享链接 scheme 面：与 protocol-url-schemes#SUPPORTED_URL_SCHEMES 对齐（SecAudit L1——名单漂移会让
// wireguard://<privateKey>@、snell://<psk>@、anytls://<password>@ 等整段落日志）。手工同步两处没有机制约束，
// 这里改为运行时由 SUPPORTED_URL_SCHEMES 构造，彻底消漂移；排除 http/https（它们走下方参数级 URL 脱敏）。
const LINK_SCHEME_PATTERN = SUPPORTED_URL_SCHEMES.filter(
  (scheme) => scheme !== 'http' && scheme !== 'https'
)
  .map((scheme) => scheme.replace(/[+]/g, '\\+'))
  .join('|');

export function redactLogText(text: string): string {
  return text
    .replace(/(?:\/Users\/|\/home\/)[^/\s]+/g, '<home>')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '<home>')
    .replace(
      /-----BEGIN [^-]*(?:PRIVATE KEY|PRIVATE)-----[\s\S]*?-----END [^-]+-----/g,
      '<redacted-private-key>'
    )
    .replace(new RegExp(`\\b(?:${LINK_SCHEME_PATTERN}):\\/\\/[^\\s<>"']+`, 'gi'), '<redacted-link>')
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
      /(["']?(?:(?:privacy|obfs|tls[_-]?)?password|passwd|username|otp|passcode|verification[_-]?code|samlresponse|prelogin[_-]?cookie|portal[_-]?userauthcookie|uuid|private[_-]?key(?:passphrase)?|preshared[_-]?key|psk|(?:clashApi)?secret|(?:access[_-]?|refresh[_-]?)?token|auth[_-]?key|auth[_-]?str|license|api[_-]?key)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}&"']+)/gi,
      '$1<redacted>'
    );
}

/** Preserve structured JSON while applying text redaction to every string leaf. */
export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 30) return '<diagnostic-depth-limit>';
  if (typeof value === 'string') return redactLogText(value);
  if (Array.isArray(value)) return value.map((child) => redactLogValue(child, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactLogValue(child, depth + 1)])
    );
  return value;
}
