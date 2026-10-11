import { MihomoRuntime } from '../MihomoRuntime';
import { buildMihomoMainConfig } from '../mihomo-config-builder';
import type { UserConfig } from '../../../shared/types';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createServer } from 'net';
import { once } from 'events';

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
let directory: string, runtime: MihomoRuntime;
async function port(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'shadowvpn-mihomo-lifecycle-'));
  runtime = new MihomoRuntime(binary, directory);
});
afterEach(async () => {
  await runtime.stop();
  rmSync(directory, { recursive: true, force: true });
});
async function config(controllerPort: number) {
  return buildMihomoMainConfig(
    {
      servers: [],
      selectedServerId: '__direct__',
      mixedPort: await port(),
      proxyMode: 'direct',
      proxyModeType: 'manual',
      customRules: [],
    } as unknown as UserConfig,
    { controllerPort, secret: 'fictional-secret' }
  ).config;
}

it('owns real startup, readiness, restart and stop without leaving a controller', async () => {
  const controllerPort = await port();
  const first = await config(controllerPort);
  await runtime.start(first, controllerPort, 'fictional-secret');
  const client = runtime.client!,
    firstPid = runtime.pid;
  expect(firstPid).toBeGreaterThan(0);
  await client.probe();
  await runtime.start(await config(controllerPort), controllerPort, 'fictional-secret');
  expect(runtime.pid).not.toBe(firstPid);
  await runtime.client!.probe();
  await runtime.stop();
  expect(runtime.pid).toBeUndefined();
  expect(runtime.client).toBeNull();
  await expect(client.probe(100)).rejects.toThrow();
});
it('cancels a superseded startup and allows the next generation to start', async () => {
  const controllerPort = await port(),
    first = await config(controllerPort);
  const pending = runtime.start(first, controllerPort, 'fictional-secret');
  const rejected = expect(pending).rejects.toThrow('superseded');
  await runtime.stop();
  await rejected;
  await runtime.start(first, controllerPort, 'fictional-secret');
  expect(runtime.pid).toBeGreaterThan(0);
});
it('rejects invalid native configuration and keeps failures free of node credentials', async () => {
  const controllerPort = await port(),
    built = await config(controllerPort);
  built.proxies = [
    {
      name: 'fixture',
      type: 'unknown-type',
      server: 'example.com',
      port: 443,
      password: 'fictional-sensitive-password',
    },
  ];
  await expect(runtime.start(built, controllerPort, 'fictional-secret')).rejects.toThrow(
    'configuration validation failed'
  );
  expect(runtime.client).toBeNull();
  expect(runtime.pid).toBeUndefined();
});
it('does not accept an unrelated controller occupying the requested port', async () => {
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const controllerPort = (occupied.address() as { port: number }).port;
  try {
    await expect(
      runtime.start(await config(controllerPort), controllerPort, 'fictional-secret')
    ).rejects.toThrow('already in use');
    expect(runtime.pid).toBeUndefined();
  } finally {
    await new Promise<void>((done) => occupied.close(() => done()));
  }
});

it('keeps the running core when a replacement configuration fails native validation', async () => {
  const controllerPort = await port();
  const built = await config(controllerPort);
  await runtime.start(built, controllerPort, 'fictional-secret');
  const pid = runtime.pid;
  await expect(
    runtime.start(
      { ...built, proxies: [{ name: 'invalid', type: 'invalid' }] },
      controllerPort,
      'fictional-secret'
    )
  ).rejects.toThrow('validation failed');
  expect(runtime.pid).toBe(pid);
  await runtime.client!.probe();
});

it('rejects mismatched controller identity before disturbing a running core', async () => {
  const controllerPort = await port();
  const built = await config(controllerPort);
  await runtime.start(built, controllerPort, 'fictional-secret');
  const pid = runtime.pid;
  await expect(runtime.start(built, controllerPort, 'wrong-secret')).rejects.toThrow('identity');
  expect(runtime.pid).toBe(pid);
  await runtime.client!.probe();
});
