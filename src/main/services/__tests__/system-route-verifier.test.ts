import { createServer, type Server } from 'http';
import { once } from 'events';
import { verifyTunSystemRoute } from '../SystemRouteVerifier';
import type { SingBoxConnection } from '../singbox-api-client';

let origin: Server;
let connection: SingBoxConnection | undefined;
let target: string;
beforeEach(async () => {
  connection = undefined;
  origin = createServer((request, response) => {
    connection = {
      createdAt: String(Date.now()),
      source: `127.0.0.1:${request.socket.remotePort}`,
      destination: `127.0.0.1:${request.socket.localPort}`,
      domain: 'localhost',
      outbound: 'DIRECT',
      rule: 'Match',
      processInfo: { processPath: process.execPath },
    };
    setTimeout(() => response.end('fixture'), 180);
  });
  origin.listen(0, '127.0.0.1');
  await once(origin, 'listening');
  target = `http://localhost:${(origin.address() as { port: number }).port}/fixture`;
});
afterEach(async () => {
  origin.closeAllConnections();
  await new Promise<void>((done) => origin.close(() => done()));
});
const expected = { outbound: 'fixture-node', processPath: process.execPath };

it('does not count a real successful OS request with no core observation as a pass', async () => {
  const result = await verifyTunSystemRoute(target, expected, async () => []);
  expect(result).toMatchObject({ status: 'unobserved', httpStatus: 200 });
  expect(result.observed).toBeUndefined();
});
it('requires the actual leaf outbound and process, not a successful request or selector name', async () => {
  const result = await verifyTunSystemRoute(target, expected, async () =>
    connection ? [connection] : []
  );
  expect(result).toMatchObject({ status: 'wrong-route', observed: { outbound: 'DIRECT' } });
});
it('rejects stale connection evidence even with an otherwise matching source port', async () => {
  const result = await verifyTunSystemRoute(target, expected, async () =>
    connection ? [{ ...connection, createdAt: '1', outbound: 'fixture-node' }] : []
  );
  expect(result.status).toBe('unobserved');
});
it('does not turn controller evidence into request success', async () => {
  origin.closeAllConnections();
  await new Promise<void>((done) => origin.close(() => done()));
  const result = await verifyTunSystemRoute(target, expected, async () => [], 500);
  expect(result.status).toBe('request-failed');
});
