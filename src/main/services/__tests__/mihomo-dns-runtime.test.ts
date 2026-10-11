import { createSocket, type Socket } from 'dgram';
import { createServer } from 'net';
import { once } from 'events';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { MihomoRuntime } from '../MihomoRuntime';
import { buildMihomoMainConfig } from '../mihomo-config-builder';
import type { UserConfig } from '../../../shared/types';

jest.setTimeout(30000);
const platform =
  process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? 'mac-arm64'
      : 'mac-x64'
    : process.platform === 'win32'
      ? 'win'
      : 'linux';
const binary = resolve(
  __dirname,
  '../../../../resources',
  platform,
  'mihomo' + (process.platform === 'win32' ? '.exe' : '')
);
async function tcpPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
// DNS owns UDP and TCP. A TCP-only free port can already belong to an unrelated UDP socket.
async function dnsPort(): Promise<number> {
  const udp = createSocket('udp4');
  udp.bind(0, '127.0.0.1');
  await once(udp, 'listening');
  const port = udp.address().port;
  const tcp = createServer();
  try {
    tcp.listen(port, '127.0.0.1');
    await once(tcp, 'listening');
    await new Promise<void>((done) => tcp.close(() => done()));
    return port;
  } finally {
    udp.close();
  }
}
function question(domain: string): Buffer {
  const header = Buffer.from([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([
    header,
    ...domain
      .split('.')
      .map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0, 0, 1, 0, 1]),
  ]);
}
async function query(port: number, domain: string): Promise<string> {
  const socket = createSocket('udp4');
  try {
    return await new Promise<string>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error(`DNS fixture query timed out: ${domain} on 127.0.0.1:${port}`)),
        3000
      );
      socket.once('error', (error) => {
        clearTimeout(timer);
        fail(error);
      });
      socket.once('message', (bytes) => {
        clearTimeout(timer);
        if (
          bytes.readUInt16BE(0) !== 0x1234 ||
          bytes.readUInt16BE(6) !== 1 ||
          (bytes[3] & 15) !== 0
        )
          return fail(new Error('Invalid DNS response'));
        done([...bytes.subarray(bytes.length - 4)].join('.'));
      });
      socket.send(question(domain), port, '127.0.0.1');
    });
  } finally {
    socket.close();
  }
}
let upstream: Socket, directory: string, runtime: MihomoRuntime, upstreamPort: number;
beforeEach(async () => {
  upstream = createSocket('udp4');
  upstream.bind(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamPort = upstream.address().port;
  upstream.on('message', (bytes, remote) => {
    const answer = Buffer.from(bytes);
    answer.writeUInt16BE(0x8180, 2);
    answer.writeUInt16BE(1, 6);
    upstream.send(
      Buffer.concat([
        answer,
        Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 203, 0, 113, 8]),
      ]),
      remote.port,
      remote.address
    );
  });
  directory = mkdtempSync(join(tmpdir(), 'shadowvpn-mihomo-dns-'));
  runtime = new MihomoRuntime(binary, directory);
});
afterEach(async () => {
  await runtime.stop();
  upstream.close();
  rmSync(directory, { recursive: true, force: true });
});
async function start(fake: boolean, bypass = false, nodeResolver?: string): Promise<number> {
  const listeningPort = await dnsPort(),
    controllerPort = await tcpPort();
  const user = {
    servers: nodeResolver
      ? [{ id: 'node', name: 'node', protocol: 'http', address: 'node.example.com', port: 443 }]
      : [],
    selectedServerId: '__direct__',
    mixedPort: await tcpPort(),
    proxyMode: 'smart',
    regionRouting: { enabled: false, region: 'cn', reverse: false },
    proxyModeType: 'manual',
    bypassLAN: false,
    blockBrowserDoh: false,
    dnsConfig: {
      domesticDns: `udp://127.0.0.1:${upstreamPort}`,
      foreignDns: `udp://127.0.0.1:${upstreamPort}`,
      enableFakeIp: fake,
    },
    fakeIpFilterList: ['real.example.com'],
    customRules: bypass
      ? [
          {
            id: 'bypass',
            enabled: true,
            type: 'domain',
            values: ['bypass.example.com'],
            action: 'direct',
            bypassFakeIP: true,
          },
        ]
      : [],
  } as unknown as UserConfig;
  const built = buildMihomoMainConfig(user, {
    controllerPort,
    secret: 'fictional-secret',
    dnsPort: listeningPort,
    nodeResolver,
  });
  await runtime.start(built.config, controllerPort, 'fictional-secret');
  return listeningPort;
}
it('returns native fake IPs while configured exceptions and rule bypass resolve to real IPs', async () => {
  const dnsPort = await start(true, true);
  expect(await query(dnsPort, 'fake.example.com')).toMatch(/^198\.(18|19)\./);
  expect(await query(dnsPort, 'real.example.com')).toBe('203.0.113.8');
  expect(await query(dnsPort, 'bypass.example.com')).toBe('203.0.113.8');
});
it('ignores the retired fake IP toggle while still allowing real-IP exceptions', async () => {
  const dnsPort = await start(false);
  expect(await query(dnsPort, 'ordinary.example.com')).toMatch(/^198\.(18|19)\./);
  expect(await query(dnsPort, 'real.example.com')).toBe('203.0.113.8');
});

it('keeps node-host lookups on direct bootstrap and returns real addresses for entry measurements', async () => {
  const bootstrap = createSocket('udp4');
  bootstrap.bind(0, '127.0.0.1');
  await once(bootstrap, 'listening');
  let requests = 0;
  bootstrap.on('message', (bytes, remote) => {
    requests++;
    const answer = Buffer.from(bytes);
    answer.writeUInt16BE(0x8180, 2);
    answer.writeUInt16BE(1, 6);
    bootstrap.send(
      Buffer.concat([
        answer,
        Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 203, 0, 113, 9]),
      ]),
      remote.port,
      remote.address
    );
  });
  try {
    const dnsPort = await start(true, false, `udp://127.0.0.1:${bootstrap.address().port}`);
    expect(await query(dnsPort, 'node.example.com')).toBe('203.0.113.9');
    expect(requests).toBeGreaterThan(0);
    expect(await query(dnsPort, 'ordinary.example.com')).toMatch(/^198\.(18|19)\./);
  } finally {
    bootstrap.close();
  }
});
