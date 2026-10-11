/** Real official cores and complete requests. Missing binaries fail this release gate. */
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createServer, request } from 'http';
import { connect } from 'net';
import { once } from 'events';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { CompatibilityCoreService, allocateCompatibilityPort } from '../CompatibilityCoreService';
import { buildBridgeOutbound, buildXrayConfig, buildMihomoConfig } from '../compatibility-config';
import type { ServerConfig } from '../../../shared/types';

jest.setTimeout(30000);
const dir = mkdtempSync(join(tmpdir(), 'shadowvpn-core-test-'));
const platform =
  process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? 'mac-arm64'
      : 'mac-x64'
    : process.platform === 'win32'
      ? 'win'
      : 'linux';
const binary = (name: string) =>
  resolve(
    __dirname,
    '../../../../resources',
    platform,
    name + (process.platform === 'win32' ? '.exe' : '')
  );
const children: ChildProcess[] = [];
let sequence = 0;
let cores: CompatibilityCoreService;
const fixturePorts = new Set<number>();
let fixtureOutput = '';
async function fixturePort(): Promise<number> {
  return allocateCompatibilityPort(fixturePorts);
}

beforeEach(() => {
  fixturePorts.clear();
  fixtureOutput = '';
});
async function ready(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await new Promise<boolean>((done) => {
        const s = connect(port, '127.0.0.1');
        const finish = (ok: boolean) => {
          s.destroy();
          done(ok);
        };
        s.once('connect', () => finish(true));
        s.once('error', () => finish(false));
        s.setTimeout(100, () => finish(false));
      })
    )
      return;
    await new Promise((done) => setTimeout(done, 30));
  }
  throw new Error('fixture listener not ready');
}
function launch(name: string, config: object): ChildProcess {
  const file = join(dir, `${name}-${sequence++}.json`);
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  const args = name === 'sing-box' ? ['run', '-c', file] : ['run', '-config', file];
  const child = spawn(binary(name), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = (chunk: Buffer) => {
    fixtureOutput = (fixtureOutput + chunk.toString()).slice(-8000);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  children.push(child);
  return child;
}
async function fetchThrough(port: number, target: string): Promise<string> {
  const agent = new HttpsProxyAgent(`http://127.0.0.1:${port}`);
  try {
    return await new Promise((done, fail) => {
      const req = request(target, { agent }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => done(body));
      });
      req.setTimeout(4000, () => req.destroy(new Error('request timeout')));
      req.once('error', (error) =>
        fail(
          new Error(
            `${error.message}; proxy=${port}; fixture ports=${[...fixturePorts].join(',')}; core output=${fixtureOutput}`
          )
        )
      );
      req.end();
    });
  } finally {
    agent.destroy();
  }
}
beforeAll(() => {
  for (const name of ['sing-box', 'xray', 'mihomo'])
    execFileSync(binary(name), [name === 'mihomo' ? '-v' : 'version'], { stdio: 'ignore' });
});
afterEach(async () => {
  await cores?.close();
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      await closed;
    })
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it.each(['auto', 'packet-up', 'stream-up', 'invalid-uuid'])(
  'XHTTP %s carries a complete HTTP request through sing-box → Xray → direct dial',
  async (caseName) => {
    const mode = caseName === 'invalid-uuid' ? 'auto' : caseName;
    const http = createServer((_req, res) => res.end('fixture-response-through-xhttp'));
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    try {
      const originPort = (http.address() as { port: number }).port;
      fixturePorts.add(originPort);
      const nodePort = await fixturePort();
      const directPort = await fixturePort();
      const entryPort = await fixturePort();
      const uuid = '00000000-0000-4000-8000-000000000001';
      launch('xray', {
        log: { loglevel: 'warning' },
        inbounds: [
          {
            listen: '127.0.0.1',
            port: nodePort,
            protocol: 'vless',
            settings: { clients: [{ id: uuid }], decryption: 'none' },
            streamSettings: { network: 'xhttp', xhttpSettings: { path: '/fixture', mode } },
          },
        ],
        outbounds: [{ protocol: 'freedom' }],
      });
      await ready(nodePort);
      const server: ServerConfig = {
        id: 'fixture-xhttp',
        name: 'fixture',
        protocol: 'vless',
        address: '127.0.0.1',
        port: nodePort,
        uuid: caseName === 'invalid-uuid' ? '00000000-0000-4000-8000-000000000002' : uuid,
        encryption: 'none',
        network: 'xhttp',
        security: 'none',
        xhttpSettings: { path: '/fixture', mode: mode as 'auto' },
        createdAt: '2026-10-08T00:00:00Z',
        updatedAt: '2026-10-08T00:00:00Z',
      };
      cores = new CompatibilityCoreService(binary, (_level, message) => {
        fixtureOutput = (fixtureOutput + message).slice(-8000);
      });
      await cores.prepare([server], directPort);
      expect(cores.failures.size).toBe(0);
      const bridge = cores.bridges.get(server.id)!;
      expect(bridge).toBeDefined();
      launch('sing-box', {
        log: { level: 'warn' },
        inbounds: [
          { type: 'mixed', tag: 'entry', listen: '127.0.0.1', listen_port: entryPort },
          { type: 'mixed', tag: 'dial', listen: '127.0.0.1', listen_port: directPort },
        ],
        outbounds: [buildBridgeOutbound('node', bridge), { type: 'direct', tag: 'direct' }],
        route: { rules: [{ inbound: ['dial'], outbound: 'direct' }], final: 'node' },
      });
      await ready(entryPort);
      if (caseName === 'invalid-uuid')
        await expect(
          fetchThrough(entryPort, `http://127.0.0.1:${originPort}/fixture`)
        ).rejects.toThrow();
      else
        expect(await fetchThrough(entryPort, `http://127.0.0.1:${originPort}/fixture`)).toBe(
          'fixture-response-through-xhttp'
        );
      await cores.close();
      await expect(
        fetchThrough(entryPort, `http://127.0.0.1:${originPort}/fixture`)
      ).rejects.toThrow();
    } finally {
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
    }
  }
);

it('mihomo native nodes carry requests through authenticated loopback bridges and preserve config errors per node', async () => {
  const http = createServer((_req, res) => res.end('fixture-response-through-mihomo'));
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  try {
    const targetPort = (http.address() as { port: number }).port;
    fixturePorts.add(targetPort);
    const nodePort = await fixturePort();
    const directPort = await fixturePort();
    const entryPort = await fixturePort();
    launch('sing-box', {
      inbounds: [{ type: 'socks', listen: '127.0.0.1', listen_port: nodePort }],
      outbounds: [{ type: 'direct' }],
    });
    await ready(nodePort);
    const server: ServerConfig = {
      id: 'fixture-mihomo',
      name: 'fixture',
      protocol: 'custom',
      address: '127.0.0.1',
      port: nodePort,
      compatibilitySettings: {
        engine: 'mihomo',
        outbound: { type: 'socks5', server: '127.0.0.1', port: nodePort, udp: true },
      },
      createdAt: '2026-10-08T00:00:00Z',
      updatedAt: '2026-10-08T00:00:00Z',
    };
    const invalid = {
      ...server,
      id: 'invalid',
      compatibilitySettings: {
        engine: 'mihomo' as const,
        outbound: { type: 'unknown-fixture-type', server: 'example.com', port: 443 },
      },
    };
    cores = new CompatibilityCoreService(binary, (_level, message) => {
      fixtureOutput = (fixtureOutput + message).slice(-8000);
    });
    await cores.prepare([server, invalid], directPort);
    expect(cores.failures.has('invalid')).toBe(true);
    const bridge = cores.bridges.get(server.id)!;
    expect(bridge).toBeDefined();
    launch('sing-box', {
      inbounds: [
        { type: 'mixed', tag: 'entry', listen: '127.0.0.1', listen_port: entryPort },
        { type: 'mixed', tag: 'dial', listen: '127.0.0.1', listen_port: directPort },
      ],
      outbounds: [buildBridgeOutbound('node', bridge), { type: 'direct', tag: 'direct' }],
      route: { rules: [{ inbound: ['dial'], outbound: 'direct' }], final: 'node' },
    });
    await ready(entryPort);
    expect(await fetchThrough(entryPort, `http://127.0.0.1:${targetPort}/fixture`)).toBe(
      'fixture-response-through-mihomo'
    );
  } finally {
    http.closeAllConnections();
    await new Promise<void>((done) => http.close(() => done()));
  }
});

it('official Xray and mihomo validate preserved XHTTP extra and SSR shapes', () => {
  const bridge = { port: 19081, username: 'fixture-user', password: 'fixture-password' };
  const base = {
    id: 'fixture',
    name: 'fixture',
    address: 'example.com',
    port: 443,
    createdAt: '2026-10-08T00:00:00Z',
    updatedAt: '2026-10-08T00:00:00Z',
  };
  const xray = buildXrayConfig(
    [
      {
        server: {
          ...base,
          protocol: 'vless',
          uuid: '00000000-0000-4000-8000-000000000001',
          encryption: 'none',
          network: 'xhttp',
          security: 'tls',
          xhttpSettings: {
            path: '/up',
            mode: 'packet-up',
            extra: {
              noSSEHeader: true,
              xmux: { maxConcurrency: '8-16' },
              downloadSettings: {
                address: 'download.example.com',
                port: 443,
                network: 'xhttp',
                security: 'tls',
                tlsSettings: { serverName: 'download.example.com' },
              },
            },
          },
        },
        bridge,
      },
    ],
    19080
  );
  const mihomo = buildMihomoConfig(
    [
      {
        server: {
          ...base,
          protocol: 'custom',
          compatibilitySettings: {
            engine: 'mihomo',
            outbound: {
              name: 'fixture',
              type: 'ssr',
              server: 'example.com',
              port: 443,
              cipher: 'aes-128-cfb',
              password: 'fixture-secret',
              protocol: 'auth_sha1_v4',
              obfs: 'tls1.2_ticket_auth',
              'obfs-param': 'cdn.example.com',
            },
          },
        },
        bridge,
      },
    ],
    19080
  );
  const xf = join(dir, 'check-xray.json');
  const mf = join(dir, 'check-mihomo.json');
  writeFileSync(xf, JSON.stringify(xray));
  writeFileSync(mf, JSON.stringify(mihomo));
  expect(() =>
    execFileSync(binary('xray'), ['run', '-test', '-config', xf], { stdio: 'pipe' })
  ).not.toThrow();
  expect(() =>
    execFileSync(binary('mihomo'), ['-t', '-d', dir, '-f', mf], { stdio: 'pipe' })
  ).not.toThrow();
});

it('carries a complete request through Mihomo → authenticated sing-box compatibility bridge → direct dial', async () => {
  const { MihomoRuntime } = await import('../MihomoRuntime');
  const { buildMihomoMainConfig } = await import('../mihomo-config-builder');
  const origin = createServer((_req, res) => res.end('fixture-through-singbox-compatibility'));
  const proxy = createServer();
  const sockets = new Set<import('stream').Duplex>();
  origin.listen(0, '127.0.0.1');
  proxy.listen(0, '127.0.0.1');
  await Promise.all([once(origin, 'listening'), once(proxy, 'listening')]);
  const originPort = (origin.address() as { port: number }).port;
  proxy.on('connect', (_request, incoming, head) => {
    const outgoing = connect(originPort, '127.0.0.1');
    sockets.add(incoming);
    sockets.add(outgoing);
    incoming.once('error', () => outgoing.destroy());
    outgoing.once('error', () => incoming.destroy());
    outgoing.once('connect', () => {
      incoming.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) outgoing.write(head);
      incoming.pipe(outgoing);
      outgoing.pipe(incoming);
    });
  });
  const mainDirectory = mkdtempSync(join(tmpdir(), 'shadowvpn-main-compat-test-'));
  const runtime = new MihomoRuntime(binary('mihomo'), mainDirectory);
  try {
    const directPort = await allocateCompatibilityPort(),
      entryPort = await allocateCompatibilityPort(),
      controllerPort = await fixturePort();
    const node = {
      id: 'fixture-http',
      name: 'fixture',
      protocol: 'http',
      address: '127.0.0.1',
      port: (proxy.address() as { port: number }).port,
    } as ServerConfig;
    cores = new CompatibilityCoreService(
      (name) => binary(name),
      () => {},
      () => binary('sing-box')
    );
    await cores.prepare([node], directPort, () => 'sing-box');
    expect(cores.failures.size).toBe(0);
    expect(cores.bridges.has(node.id)).toBe(true);
    const user = {
      servers: [node],
      selectedServerId: node.id,
      proxyMode: 'global',
      proxyModeType: 'manual',
      mixedPort: entryPort,
      blockBrowserDoh: false,
      customRules: [],
    } as unknown as import('../../../shared/types').UserConfig;
    const built = buildMihomoMainConfig(user, {
      controllerPort,
      secret: 'fictional-secret',
      directPort,
      bridges: cores.bridges,
    });
    await runtime.start(built.config, controllerPort, 'fictional-secret');
    expect(await fetchThrough(entryPort, `http://127.0.0.1:${originPort}/`)).toBe(
      'fixture-through-singbox-compatibility'
    );
  } finally {
    await runtime.stop();
    await cores?.close();
    sockets.forEach((socket) => socket.destroy());
    origin.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([
      new Promise<void>((done) => origin.close(() => done())),
      new Promise<void>((done) => proxy.close(() => done())),
    ]);
    rmSync(mainDirectory, { recursive: true, force: true });
  }
});
