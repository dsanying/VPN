import { parseGatewayResources, type GatewayResources } from './GatewayResources';
import { openConnectAuthBinary, parseAuthFields } from './OpenConnectForms';
import { get as httpGet } from 'http';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { allocateCompatibilityPort } from '../CompatibilityCoreService';
import type { StoredEnterpriseProfile } from './EnterpriseProfileStore';
import type { EnterpriseChallenge } from '../../../shared/enterprise-vpn';
import { ENTERPRISE_ADAPTERS } from '../../../shared/enterprise-vpn';
export interface EnterpriseBridge {
  dnsPort?: number;
  healthPort?: number;
  availability?: 'available' | 'unknown';
  resources?: GatewayResources;
  port: number;
  username: string;
  password: string;
}
export class EnterpriseEngine {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: {
    id: string;
    kind: EnterpriseChallenge['kind'];
    fields?: EnterpriseChallenge['fields'];
  };
  private rejectStart?: (error: Error) => void;
  constructor(
    private readonly directory: string,
    private readonly packaged: boolean
  ) {}
  async start(
    profile: StoredEnterpriseProfile,
    onChallenge: (c: EnterpriseChallenge) => void,
    onExit: (reason?: string) => void,
    onPhase: (phase: string) => void = () => {}
  ): Promise<EnterpriseBridge> {
    if (this.child) throw new Error('企业 VPN 引擎正在运行');
    const binary = join(
      this.directory,
      process.platform === 'win32' ? 'enterprise-runtime.exe' : 'enterprise-runtime'
    );
    if (!existsSync(binary)) throw new Error('企业 VPN 引擎尚未安装');
    const manifest = JSON.parse(
      readFileSync(join(this.directory, 'enterprise-runtime-manifest.json'), 'utf8')
    );
    if (
      manifest.tlsVerification !== true ||
      createHash('sha256').update(readFileSync(binary)).digest('hex') !== manifest.sha256
    )
      throw new Error('企业 VPN 引擎完整性校验失败');
    const bridge = {
      port: await allocateCompatibilityPort(),
      username: randomBytes(16).toString('hex'),
      password: randomBytes(24).toString('hex'),
    };
    const adapter = ENTERPRISE_ADAPTERS[profile.protocol];
    if (!adapter) throw new Error('企业 VPN 协议尚未适配');
    const sangfor = adapter.engine === 'zju-connect';
    if (!sangfor && process.platform === 'win32')
      throw new Error('当前 Windows 引擎尚未支持企业 VPN 用户态隧道');
    const openconnect = join(
      this.directory,
      process.platform === 'win32' ? 'openconnect.exe' : 'openconnect'
    );
    const command = sangfor
      ? binary
      : existsSync(openconnect)
        ? openconnect
        : !this.packaged && existsSync('/opt/homebrew/bin/openconnect')
          ? '/opt/homebrew/bin/openconnect'
          : undefined;
    if (!command) throw new Error('OpenConnect 引擎尚未安装');
    // The script is exclusively our integrity-checked binary, not gateway-provided executable content.
    const script = `'${binary.replace(/'/g, "'\\''")}' --openconnect; bridge_status=$?; printf '{"type":"error","stage":"tunnel-exit-%d"}\\n' "$bridge_status"`;
    const args = sangfor ? [] : ['--connect', profile.protocol, profile.gateway, command, script];
    const child = spawn(sangfor ? binary : openConnectAuthBinary(this.directory), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        SHADOW_BRIDGE_GATEWAY: profile.gateway,
        SHADOW_BRIDGE_PORT: String(bridge.port),
        SHADOW_BRIDGE_USER: bridge.username,
        SHADOW_BRIDGE_TOKEN: bridge.password,
      },
    });
    this.child = child;
    // Do not persist or forward raw engine stderr (cookies, auth challenges, URLs may be secret).
    let failure = '企业 VPN 认证或隧道建立失败，请检查账密、证书及网关准入要求';
    let diagnostic = '';
    let lastPhase = '';
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString('utf8')).slice(-8192);
      if (/certificate|SSL connection failure|TLS connection failure/i.test(diagnostic))
        failure = '网关 TLS 证书或加密连接验证失败';
      else if (/authentication failed|login failed|401 unauthorized/i.test(diagnostic))
        failure = '网关认证失败，请检查账号或准入要求';
      else if (
        /Failed to obtain WebVPN cookie|non-inter|authgroup|No password supplied/i.test(diagnostic)
      )
        failure = '网关要求交互认证或登录分组，当前 OpenConnect 适配尚未完成此认证流程';
      const phase = /Connected as|Established (?:DTLS|SSL)|Tunnel/i.test(diagnostic)
        ? '建立隧道'
        : /POST|XML|password|login|GET/i.test(diagnostic)
          ? '网关认证'
          : '连接网关';
      if (phase !== lastPhase) {
        lastPhase = phase;
        onPhase(phase);
      }
    });
    const lines = createInterface({ input: child.stdout });
    return new Promise((resolve, reject) => {
      let settled = false;
      let ready = false;
      let exited = false;
      const notifyExit = (reason?: string) => {
        if (ready && !exited) {
          exited = true;
          onExit(reason);
        }
      };
      let timer = setTimeout(
        () =>
          fail(new Error(`企业 VPN ${lastPhase || '连接网关'}超时，请检查网络或网关交互认证要求`)),
        60_000
      );
      timer.unref();
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.rejectStart = undefined;
        reject(error);
        void this.stop();
      };
      this.rejectStart = fail;
      lines.on('line', (line) => {
        if (line.length > 1024 * 1024) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === 'ready' && event.port === bridge.port) {
          settled = true;
          ready = true;
          clearTimeout(timer);
          this.rejectStart = undefined;
          resolve({
            ...bridge,
            resources: parseGatewayResources(event.resources),
            availability: event.availability === 'available' ? 'available' : 'unknown',
            ...(typeof event.healthPort === 'number' &&
            Number.isInteger(event.healthPort) &&
            event.healthPort > 0 &&
            event.healthPort <= 65535
              ? { healthPort: event.healthPort }
              : {}),
            ...(typeof event.dnsPort === 'number' &&
            Number.isInteger(event.dnsPort) &&
            event.dnsPort > 0 &&
            event.dnsPort <= 65535
              ? { dnsPort: event.dnsPort }
              : {}),
          });
        } else if (event.type === 'error') {
          if (settled) {
            notifyExit(
              typeof event.stage === 'string' && /^[a-z0-9-]{1,64}$/.test(event.stage)
                ? /no buffer space available/i.test(diagnostic)
                  ? 'tunnel-backpressure'
                  : event.stage
                : 'tunnel-runtime'
            );
            void this.stop();
          } else
            fail(new Error(event.stage === 'tunnel-exit' ? '企业 VPN 隧道桥接已退出' : failure));
        } else if (
          event.type === 'challenge' &&
          ['code', 'text-captcha', 'click-captcha', 'external', 'form'].includes(String(event.kind))
        ) {
          const id = randomUUID();
          const kind = event.kind as EnterpriseChallenge['kind'];

          // Login URLs/images are ephemeral UI data, never logged or saved in the database.
          let fields;
          try {
            fields = kind === 'form' ? parseAuthFields(event.fields) : undefined;
          } catch {
            fail(new Error('网关认证表单无效'));
            return;
          }
          this.pending = { id, kind, fields };
          clearTimeout(timer);
          timer = setTimeout(() => fail(new Error('等待网关认证输入超时')), 180_000);
          timer.unref();
          onChallenge({
            fields,
            id,
            kind,
            message: typeof event.message === 'string' ? event.message.slice(0, 256) : undefined,
            image:
              typeof event.image === 'string' && event.image
                ? `data:image/png;base64,${event.image}`
                : undefined,
            url: typeof event.url === 'string' ? event.url : undefined,
          });
        }
      });
      child.once('error', () => fail(new Error('企业 VPN 引擎无法启动')));
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        lines.close();
        this.pending = undefined;
        if (this.child === child) this.child = undefined;
        if (!settled) fail(new Error(failure));
        else
          notifyExit(
            /no buffer space available/i.test(diagnostic)
              ? 'tunnel-backpressure'
              : `engine-exit-${signal ?? code ?? 'unknown'}`
          );
      });
      if (sangfor)
        child.stdin.write(
          JSON.stringify({
            Protocol: profile.protocol,
            Gateway: profile.gateway,
            Username: profile.username,
            Password: profile.password ?? '',
            Selections: profile.selections ?? {},
            Port: bridge.port,
            User: bridge.username,
            Token: bridge.password,
          }) + '\n'
        );
      else
        child.stdin.write(
          JSON.stringify({
            username: profile.username,
            password: profile.password ?? '',
            selections: profile.selections ?? {},
          }) + '\n'
        );
    });
  }
  respond(
    id: string,
    value: {
      fields?: Record<string, string>;
      code?: string;
      callbackURL?: string;
      points?: { x: number; y: number }[];
      width?: number;
      height?: number;
    }
  ): void {
    if (!this.pending || id !== this.pending.id || !this.child) throw new Error('认证请求已失效');
    if (JSON.stringify(value).length > 8192) throw new Error('认证响应过大');
    if (this.pending.kind === 'form') {
      const fields = this.pending.fields ?? [];
      if (
        !value.fields ||
        Object.keys(value.fields).length !== fields.length ||
        fields.some((field) => {
          const answer = value.fields?.[field.name];
          return (
            typeof answer !== 'string' ||
            !answer ||
            answer.length > 4096 ||
            /[\r\n\0]/.test(answer) ||
            (field.choices && !field.choices.some((choice) => choice.value === answer))
          );
        })
      )
        throw new Error('请完成当前网关要求的认证字段');
    }
    const response =
      this.pending.kind === 'form'
        ? { fields: value.fields }
        : this.pending.kind === 'external'
          ? { CallbackURL: value.callbackURL }
          : this.pending.kind === 'click-captcha'
            ? { Points: value.points, Width: value.width, Height: value.height }
            : { Code: value.code };
    this.pending = undefined;
    this.child.stdin.write(JSON.stringify(response) + '\n');
  }
  private signal(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      /* Already exited. */
    }
  }
  /** Recheck the active data plane without relogin, rebuilding cores or interrupting traffic. */
  checkHealth(bridge: EnterpriseBridge): Promise<'available' | 'unknown'> {
    if (!bridge.healthPort) return Promise.resolve('unknown');
    return new Promise((resolve) => {
      const req = httpGet(
        {
          hostname: '127.0.0.1',
          port: bridge.healthPort,
          path: '/health',
          auth: `${bridge.username}:${bridge.password}`,
          timeout: 10000,
        },
        (response) => {
          let data = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            data += chunk;
            if (data.length > 1024) req.destroy(new Error('Invalid health response'));
          });
          response.on('error', () => resolve('unknown'));
          response.on('end', () => {
            try {
              resolve(
                response.statusCode === 200 && JSON.parse(data).availability === 'available'
                  ? 'available'
                  : 'unknown'
              );
            } catch {
              resolve('unknown');
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('Health request timeout')));
      req.on('error', () => resolve('unknown'));
    });
  }
  async stop(): Promise<void> {
    this.rejectStart?.(new Error('企业 VPN 连接已取消'));
    this.rejectStart = undefined;
    this.pending = undefined;
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.signal(child, 'SIGKILL');
        resolve();
      }, 2000);
      timer.unref();
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.signal(child, 'SIGTERM');
    });
  }
}
export function enterpriseResourceDirectory(
  packaged: boolean,
  resourcesPath: string,
  root: string
): string {
  return packaged
    ? join(
        resourcesPath,
        process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
      )
    : join(
        root,
        'resources',
        process.platform === 'darwin'
          ? `mac-${process.arch}`
          : process.platform === 'win32'
            ? 'win'
            : 'linux'
      );
}
