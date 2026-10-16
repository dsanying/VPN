/** Enterprise protocol adapters share ordinary node IDs and routing. */
export const ENTERPRISE_PROTOCOLS = [
  'anyconnect',
  'nc',
  'pulse',
  'gp',
  'f5',
  'fortinet',
  'array',
  'atrust',
  'easyconnect',
] as const;
export type EnterpriseProtocol = (typeof ENTERPRISE_PROTOCOLS)[number];
/** Explicit registration: a new protocol cannot silently inherit another engine's support. */
const openConnectAdapter = {
  engine: 'openconnect' as const,
  source: 'https://gitlab.com/openconnect/openconnect',
};
const sangforAdapter = {
  engine: 'zju-connect' as const,
  source: 'https://github.com/Mythologyli/zju-connect',
};
export const ENTERPRISE_ADAPTERS: Record<
  EnterpriseProtocol,
  { engine: 'openconnect' | 'zju-connect'; source: string }
> = {
  anyconnect: openConnectAdapter,
  nc: openConnectAdapter,
  pulse: openConnectAdapter,
  gp: openConnectAdapter,
  f5: openConnectAdapter,
  fortinet: openConnectAdapter,
  array: openConnectAdapter,
  atrust: sangforAdapter,
  easyconnect: sangforAdapter,
};
export const ENTERPRISE_NAMES: Record<EnterpriseProtocol, string> = {
  anyconnect: 'AnyConnect',
  nc: 'Juniper',
  pulse: 'Pulse / Ivanti',
  gp: 'GlobalProtect',
  f5: 'F5 BIG-IP',
  fortinet: 'Fortinet',
  array: 'Array',
  atrust: 'aTrust',
  easyconnect: 'EasyConnect',
};
export interface EnterpriseDetection {
  gateway: string;
  protocol?: EnterpriseProtocol;
  authentication: 'password' | 'interactive' | 'unknown';
  reason?: string;
  fields?: EnterpriseAuthField[];
}
export interface EnterpriseProfile {
  id: string;
  name: string;
  gateway: string;
  protocol: EnterpriseProtocol;
  username: string;
  hasPassword: boolean;
  selections?: Record<string, string>;
  updatedAt: string;
}
export interface EnterpriseProfileInput {
  id?: string;
  name?: string;
  gateway: string;
  username?: string;
  password?: string;
  clearPassword?: boolean;
  selections?: Record<string, string>;
}
export interface EnterpriseAuthField {
  name: string;
  label: string;
  secret: boolean;
  choices?: { value: string; label: string }[];
}
export interface EnterpriseChallenge {
  id: string;
  kind: 'code' | 'text-captcha' | 'click-captcha' | 'external' | 'form';
  message?: string;
  fields?: EnterpriseAuthField[];
  image?: string;
  url?: string;
}
export interface EnterpriseSession {
  profileId?: string;
  state: 'idle' | 'connecting' | 'authenticating' | 'connected' | 'failed';
  challenge?: EnterpriseChallenge;
  error?: string;
  phase?: string;
}
export interface EnterpriseSnapshot {
  profiles: EnterpriseProfile[];
  session: EnterpriseSession;
  sessions?: EnterpriseSession[];
  supported: boolean;
}
export function normalizeEnterpriseGateway(value: string): string {
  if (typeof value !== 'string' || value.length > 2048)
    throw new Error('请输入有效的 VPN 网关地址');
  const url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`);
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error('VPN 网关须使用 HTTPS，且不能包含账密、查询参数或片段');
  return url.href;
}
/** Strong vendor markers only; hostname guesses never authorize credential submission. */
export function identifyEnterpriseGateway(
  gateway: string,
  body: string,
  headers: Record<string, string> = {}
): EnterpriseDetection {
  const signals: [EnterpriseProtocol, boolean][] = [
    [
      'atrust',
      /(?:aTrust|x-sdp-|authServerInfoList|sangfor_sdp)/i.test(body) ||
        Object.keys(headers).some((k) => /^x-sdp-/i.test(k)),
    ],
    ['easyconnect', /(?:EasyConnect|Sangfor SSL VPN|\/por\/login|twfid)/i.test(body)],
    [
      'anyconnect',
      /(?:<config-auth\b|webvpnlogin|Cisco (?:AnyConnect|Secure Client)|\+CSCOE\+)/i.test(body) ||
        !!headers['x-transcend-version'],
    ],
    ['pulse', /(?:Pulse Secure|Ivanti Connect Secure)/i.test(body)],
    ['nc', /(?:Juniper Networks|Network Connect|DanaInfo|DSID)/i.test(body)],
    ['gp', /(?:GlobalProtect|global-protect\/|PanGP)/i.test(body)],
    ['f5', /(?:BIG-IP|F5 Networks|MRHSession)/i.test(body)],
    ['fortinet', /(?:FortiGate|Fortinet SSL VPN|fortisslvpn)/i.test(body)],
    ['array', /(?:Array Networks|Array AG SSL VPN)/i.test(body)],
  ];
  const matches = signals.filter(([, matches]) => matches).map(([protocol]) => protocol);
  // Pulse pages also contain Juniper's older markers; prefer the explicit newer identity.
  const unique = matches.includes('pulse') ? matches.filter((p) => p !== 'nc') : matches;
  if (unique.length !== 1)
    return {
      gateway,
      authentication: 'unknown',
      reason: unique.length
        ? '网关返回了多个客户端标识，无法可靠识别'
        : '未识别到受支持的企业 VPN 网关',
    };
  return {
    gateway,
    protocol: unique[0],
    authentication: /(?:type\s*=\s*["']password|auth\/psw|password)/i.test(body)
      ? 'password'
      : 'interactive',
  };
}
