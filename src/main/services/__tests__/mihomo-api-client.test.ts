import { createServer, type Server } from 'http';
import { once } from 'events';
import { MihomoApiClient } from '../MihomoApiClient';

describe('Mihomo controller desktop contract', () => {
  let server: Server;
  let client: MihomoApiClient;
  let response: Record<string, unknown>;
  let calls: Array<{ method?: string; path?: string; body: string }>;
  beforeEach(async () => {
    calls = [];
    response = { uploadTotal: 10, downloadTotal: 20, connections: [] };
    server = createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer fictional-secret') {
        res.writeHead(401).end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        calls.push({ method: req.method, path: req.url, body });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(req.url === '/connections' ? response : { version: 'fixture' }));
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    client = new MihomoApiClient((server.address() as { port: number }).port, 'fictional-secret');
  });
  afterEach(async () => {
    client.stop();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  it('authenticates and preserves group/member names containing slashes, spaces and Chinese', async () => {
    await client.probe();
    await client.selectOutbound('规则 / Firefox', '官方订阅 / 节点 1');
    await client.closeConnection('connection/id');
    await client.closeAllConnections();
    expect(calls).toEqual([
      { method: 'GET', path: '/version', body: '' },
      {
        method: 'PUT',
        path: '/proxies/%E8%A7%84%E5%88%99%20%2F%20Firefox',
        body: JSON.stringify({ name: '官方订阅 / 节点 1' }),
      },
      { method: 'DELETE', path: '/connections/connection%2Fid', body: '' },
      { method: 'DELETE', path: '/connections', body: '' },
    ]);
  });

  it('shares snapshots, preserves IPv6 and executable identity, and removes closed connections', async () => {
    response.connections = [
      {
        id: 'fixture-connection',
        metadata: {
          network: 'tcp',
          type: 'Tun',
          sourceIP: '::1',
          sourcePort: '5000',
          destinationIP: '2001:db8::1',
          destinationPort: '443',
          host: 'example.com',
          processPath: '/Applications/Example.app/Contents/MacOS/Example',
        },
        upload: 8,
        download: 16,
        start: '2026-10-10T00:00:00Z',
        chains: ['fixture-node', 'proxy-selector'],
        rule: 'ProcessPath',
      },
    ];
    const status = jest.fn();
    const connections = jest.fn();
    client.subscribeStatus(1e9, status);
    client.subscribeConnections(1e9, connections);
    client.start();
    await until(() => connections.mock.calls.length > 0);
    expect(calls.filter((c) => c.path === '/connections')).toHaveLength(1);
    expect(status.mock.calls[0][0]).toMatchObject({
      uplinkTotal: '10',
      downlinkTotal: '20',
      connectionsIn: 1,
    });
    expect(connections.mock.calls[0][0]).toMatchObject({
      reset: true,
      events: [
        {
          type: 'NEW',
          connection: {
            source: '[::1]:5000',
            destination: '[2001:db8::1]:443',
            processInfo: { processPath: '/Applications/Example.app/Contents/MacOS/Example' },
            uplinkTotal: '8',
            createdAt: String(Date.parse('2026-10-10T00:00:00Z')),
          },
        },
      ],
    });
    response.connections = [];
    await until(() => connections.mock.calls.length > 1);
    expect(connections.mock.calls[1][0]).toEqual({ reset: true, events: [] });
    const count = status.mock.calls.length;
    client.stop();
    await new Promise((done) => setTimeout(done, 1100));
    expect(status).toHaveBeenCalledTimes(count);
  });

  it('rejects failed authentication without returning credentials in errors', async () => {
    const wrong = new MihomoApiClient(
      (server.address() as { port: number }).port,
      'another-fictional-secret'
    );
    await expect(wrong.probe()).rejects.toThrow('HTTP 401');
    wrong.stop();
  });
});

async function until(predicate: () => boolean): Promise<void> {
  const end = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('controller sample did not arrive');
    await new Promise((done) => setTimeout(done, 20));
  }
}
