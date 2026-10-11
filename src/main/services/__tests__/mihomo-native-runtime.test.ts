import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createServer, request, type Server } from 'http';
import { connect } from 'net';
import { allocateCompatibilityPort } from '../CompatibilityCoreService';
import { once } from 'events';
import { randomUUID } from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { buildMihomoMainConfig } from '../mihomo-config-builder';
import { buildMihomoUserRules } from '../mihomo-rules';
import { MihomoApiClient } from '../MihomoApiClient';
import { probeMihomoReadiness } from '../mihomo-readiness';
import type { ServerConfig, UserConfig } from '../../../shared/types';

jest.setTimeout(30000);
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
const uuid = '00000000-0000-4000-8000-000000000001';
let directory: string;
let children: ChildProcess[];
let fixturePorts: Set<number>;
let coreOutput: string;
let origin: Server;
let api: MihomoApiClient | undefined;
let fixtureSecret: string;
let expectedMihomoConfig: Record<string, unknown>;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'shadowvpn-mihomo-native-'));
  children = [];
  fixturePorts = new Set();
  coreOutput = '';
  fixtureSecret = `fixture-${randomUUID()}`;
  expectedMihomoConfig = {};
  origin = createServer((_req, res) => res.end('fixture-origin'));
  origin.listen(0, '127.0.0.1');
  await once(origin, 'listening');
});
afterEach(async () => {
  api?.stop();
  api = undefined;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(kill);
  }
  origin.closeAllConnections();
  await new Promise<void>((done) => origin.close(() => done()));
  rmSync(directory, { recursive: true, force: true });
});

async function port(): Promise<number> {
  return allocateCompatibilityPort(fixturePorts);
}

function launch(name: 'mihomo' | 'xray', config: object): void {
  if (name === 'mihomo') expectedMihomoConfig = config as Record<string, unknown>;
  const file = join(directory, `${name}.json`);
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  const check =
    name === 'mihomo' ? ['-t', '-d', directory, '-f', file] : ['run', '-test', '-config', file];
  execFileSync(binary(name), check, { timeout: 10000, stdio: 'pipe' });
  children.push(
    spawn(
      binary(name),
      name === 'mihomo' ? ['-d', directory, '-f', file] : ['run', '-config', file],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
  );
  const child = children.at(-1)!;
  child.stdout?.on('data', (chunk) => {
    coreOutput += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    coreOutput += String(chunk);
  });
}
async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (children.some((child) => child.exitCode !== null)) throw new Error('Fixture core exited');
    try {
      await probeMihomoReadiness(api!, expectedMihomoConfig, 100);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 30));
    }
  }
  throw new Error('Fixture core API not ready');
}
async function fetchThrough(proxyPort: number): Promise<string> {
  const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`);
  try {
    return await new Promise<string>((done, fail) => {
      const req = request(
        `http://127.0.0.1:${(origin.address() as { port: number }).port}/fixture`,
        { agent },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => done(body));
        }
      );
      req.once('error', (error) =>
        fail(
          new Error(
            `${error.message}; requested proxy ${proxyPort}; configured mixed ${expectedMihomoConfig['mixed-port']}; controller ${expectedMihomoConfig['external-controller']}; core output: ${coreOutput.slice(-8000)}`
          )
        )
      );
      req.setTimeout(4000, () => req.destroy(new Error('Fixture request timed out')));
      req.end();
    });
  } finally {
    agent.destroy();
  }
}

it.each(['vless', 'vmess'] as const)(
  'uses native %s, a real Xray server and complete proxied requests',
  async (protocol) => {
    const serverPort = await port(),
      mixedPort = await port(),
      controllerPort = await port();
    const network = protocol === 'vless' ? 'xhttp' : 'tcp';
    launch('xray', {
      inbounds: [
        {
          listen: '127.0.0.1',
          port: serverPort,
          protocol,
          settings: {
            clients: [{ id: uuid }],
            ...(protocol === 'vless' ? { decryption: 'none' } : {}),
          },
          streamSettings: {
            network,
            ...(network === 'xhttp'
              ? { xhttpSettings: { path: '/fixture', mode: 'packet-up' } }
              : {}),
          },
        },
      ],
      outbounds: [{ protocol: 'freedom' }],
    });
    const server = {
      id: 'fixture',
      name: 'fixture',
      protocol,
      address: '127.0.0.1',
      port: serverPort,
      uuid,
      network,
      xhttpSettings: { path: '/fixture', mode: 'packet-up' },
    } as ServerConfig;
    const built = buildMihomoMainConfig(
      {
        servers: [server],
        selectedServerId: server.id,
        proxyMode: 'global',
        proxyModeType: 'manual',
        blockBrowserDoh: false,
        mixedPort,
        customRules: [],
      } as unknown as UserConfig,
      { controllerPort, secret: fixtureSecret }
    );
    (built.config['proxy-groups'] as Array<{ proxies: string[] }>)[0].proxies.push('REJECT');
    launch('mihomo', built.config);
    api = new MihomoApiClient(controllerPort, fixtureSecret);
    await ready();
    for (let attempt = 0; attempt < 10; attempt++)
      expect(await fetchThrough(mixedPort)).toBe('fixture-origin');
    await api.selectOutbound('proxy-selector', 'REJECT');
    await expect(fetchThrough(mixedPort)).rejects.toThrow();
    await api.selectOutbound('proxy-selector', built.names.get(server.id)!);
    expect(await fetchThrough(mixedPort)).toBe('fixture-origin');
    await api.closeAllConnections();
    const snapshot = await api.request<{ uploadTotal: number; downloadTotal: number }>(
      'GET',
      '/connections'
    );
    expect(snapshot.uploadTotal).toBeGreaterThan(0);
    expect(snapshot.downloadTotal).toBeGreaterThan(0);
  }
);

it('loads the unified ordered table and native nested logic without changing its order', async () => {
  const controllerPort = await port();
  const config = {
    proxyMode: 'smart',
    customRules: [
      { id: 'domain', type: 'domainSuffix', values: ['claude.ai'], action: 'proxy', enabled: true },
      {
        id: 'app',
        type: 'processPathRegex',
        values: ['^/Applications/Firefox\\.app/.*$'],
        action: 'direct',
        enabled: true,
      },
      {
        id: 'logical',
        type: 'domainSuffix',
        values: ['example.com'],
        action: 'block',
        enabled: true,
        combineMode: 'and',
        conditions: [
          { type: 'domainSuffix', values: ['example.com', 'example.net'] },
          { type: 'port', values: ['443', '8000-9000'] },
        ],
      },
    ],
  } as UserConfig;
  launch('mihomo', {
    'external-controller': `127.0.0.1:${controllerPort}`,
    secret: fixtureSecret,
    'proxy-groups': [{ name: 'proxy-selector', type: 'select', proxies: ['DIRECT'] }],
    rules: [...buildMihomoUserRules(config, new Map()), 'MATCH,DIRECT'],
  });
  api = new MihomoApiClient(controllerPort, fixtureSecret);
  await ready();
  const response = await api.request<{
    rules: Array<{ type: string; payload: string; proxy: string }>;
  }>('GET', '/rules');
  expect(response.rules.map((rule) => rule.type)).toEqual([
    'DomainSuffix',
    'ProcessPathRegex',
    'AND',
    'Match',
  ]);
  expect(response.rules[0]).toMatchObject({ payload: 'claude.ai', proxy: 'proxy-selector' });
  expect(response.rules[1]).toMatchObject({ proxy: 'DIRECT' });
});

it.each(['smart', 'global', 'direct'] as const)(
  'executes the compiled %s policy against a real HTTP origin',
  async (proxyMode) => {
    const mixedPort = await port(),
      controllerPort = await port(),
      deadPort = await port();
    const server = {
      id: 'fixture',
      name: 'fixture',
      protocol: 'http',
      address: '127.0.0.1',
      port: deadPort,
    } as ServerConfig;
    const built = buildMihomoMainConfig(
      {
        servers: [server],
        selectedServerId: server.id,
        mixedPort,
        proxyMode,
        proxyModeType: 'manual',
        blockBrowserDoh: false,
        customRules: [
          {
            id: 'literal',
            type: 'ipCidr',
            values: ['127.0.0.1/32'],
            action: 'block',
            enabled: true,
          },
        ],
        regionRouting: { enabled: false, region: 'cn', reverse: false },
      } as unknown as UserConfig,
      { controllerPort, secret: fixtureSecret }
    );
    launch('mihomo', built.config);
    api = new MihomoApiClient(controllerPort, fixtureSecret);
    await ready();
    if (proxyMode === 'direct') expect(await fetchThrough(mixedPort)).toBe('fixture-origin');
    else await expect(fetchThrough(mixedPort)).rejects.toThrow();
    const response = await api.request<{ rules: Array<{ type: string; proxy: string }> }>(
      'GET',
      '/rules'
    );
    if (proxyMode === 'smart')
      expect(response.rules[0]).toMatchObject({ type: 'IPCIDR', proxy: 'REJECT' });
    else
      expect(response.rules.slice(-1)).toEqual([
        expect.objectContaining({
          type: 'Match',
          proxy: proxyMode === 'direct' ? 'DIRECT' : 'proxy-selector',
        }),
      ]);
  }
);

it.each(['smart', 'global', 'direct'] as const)(
  'pins proxy measurements to the tested node independently of the %s policy and selected node',
  async (proxyMode) => {
    const secondOrigin = createServer((_request, response) => response.end('second-node-origin'));
    secondOrigin.listen(0, '127.0.0.1');
    await once(secondOrigin, 'listening');
    const sockets = new Set<import('stream').Duplex>();
    const upstreams: Server[] = [];
    const destinations: string[] = [];
    try {
      for (const destination of [origin, secondOrigin]) {
        const upstream = createServer();
        upstream.on('connect', (request, incoming, head) => {
          destinations.push(request.url || '');
          const outgoing = connect((destination.address() as { port: number }).port, '127.0.0.1');
          sockets.add(incoming);
          sockets.add(outgoing);
          incoming.once('error', () => outgoing.destroy());
          outgoing.once('error', () => incoming.destroy());
          incoming.once('close', () => {
            sockets.delete(incoming);
            outgoing.destroy();
          });
          outgoing.once('close', () => {
            sockets.delete(outgoing);
            incoming.destroy();
          });
          outgoing.once('connect', () => {
            incoming.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) outgoing.write(head);
            incoming.pipe(outgoing);
            outgoing.pipe(incoming);
          });
        });
        upstream.listen(0, '127.0.0.1');
        await once(upstream, 'listening');
        upstreams.push(upstream);
      }
      const servers = upstreams.map((upstream, index) => ({
        id: `fixture-${index}`,
        name: `fixture-${index}`,
        protocol: 'http',
        address: '127.0.0.1',
        port: (upstream.address() as { port: number }).port,
      })) as ServerConfig[];
      const mixedPort = await port(),
        controllerPort = await port(),
        probePort = await port();
      const built = buildMihomoMainConfig(
        {
          servers,
          selectedServerId: servers[0].id,
          mixedPort,
          proxyMode,
          proxyModeType: 'manual',
          blockBrowserDoh: false,
          regionRouting: { enabled: false, region: 'cn', reverse: false },
          customRules: [
            {
              id: 'block-origin',
              type: 'ipCidr',
              values: ['127.0.0.1/32'],
              action: 'block',
              enabled: true,
            },
          ],
        } as unknown as UserConfig,
        { controllerPort, secret: fixtureSecret, probePorts: [probePort] }
      );
      launch('mihomo', built.config);
      api = new MihomoApiClient(controllerPort, fixtureSecret);
      await ready();
      await api.selectOutbound('probe-selector-0', built.names.get(servers[1].id)!);
      expect(await fetchThrough(probePort)).toBe('second-node-origin');
      expect(destinations).toContain(`127.0.0.1:${(origin.address() as { port: number }).port}`);
      if (proxyMode === 'smart') await expect(fetchThrough(mixedPort)).rejects.toThrow();
      else expect(await fetchThrough(mixedPort)).toBe('fixture-origin');
      await api.selectOutbound('probe-selector-0', built.names.get(servers[0].id)!);
      expect(await fetchThrough(probePort)).toBe('fixture-origin');
      const selected = await api.request<{ now: string }>('GET', '/proxies/proxy-selector');
      expect(selected.now).toBe(built.names.get(servers[0].id));
    } finally {
      for (const socket of sockets) socket.destroy();
      secondOrigin.closeAllConnections();
      await Promise.all(
        [...upstreams, secondOrigin].map(
          (server) => new Promise<void>((done) => server.close(() => done()))
        )
      );
    }
  }
);
