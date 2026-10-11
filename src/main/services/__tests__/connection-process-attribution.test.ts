import { attributeLocalProxyConnections } from '../connection-process-attribution';
import type { ConnectionEntry, ConnectionsSnapshot } from '../../../shared/types';

const row = (id: string, processPath?: string): ConnectionEntry => ({
  id,
  chains: ['node'],
  outbound: 'node',
  rule: '',
  rulePayload: '',
  download: 123,
  metadata: {
    network: 'tcp',
    sourceIP: '127.0.0.1',
    sourcePort: '50001',
    destinationIP: '127.0.0.1',
    destinationPort: '7890',
    processPath,
    processId: processPath ? 42 : undefined,
  },
});
const snap = (connections: ConnectionEntry[], at = 1000): ConnectionsSnapshot => ({
  connections,
  at,
});
const app = '/Applications/Example.app/Contents/MacOS/Example';

it('retains exact socket owner name and PID even when its path is inaccessible', () => {
  const client = row('client');
  client.metadata!.processId = 42;
  client.metadata!.processName = 'Example Helper';
  const result = attributeLocalProxyConnections(snap([row('proxy')]), snap([client]), [7890], 1200);
  expect(result.connections[0].metadata).toMatchObject({
    processId: 42,
    processName: 'Example Helper',
  });
  expect(result.connections[0].metadata?.processPath).toBeUndefined();
});

it('uses actual client socket ownership without changing route, flow bytes or input snapshots', () => {
  const proxy = row('proxy');
  proxy.metadata!.destinationIP = '192.0.2.1';
  proxy.metadata!.destinationPort = '443';
  const original = snap([proxy]);
  const observed = snap([row('client', app)]);
  const result = attributeLocalProxyConnections(original, observed, [7890], 1200);
  expect(result.connections[0]).toEqual({
    ...proxy,
    metadata: { ...proxy.metadata, processPath: app, processId: 42 },
  });
  expect(original.connections[0].metadata?.processPath).toBeUndefined();
  expect(result.connections[0].download).toBe(123);
  expect(result.connections[0].outbound).toBe('node');
});

it('never guesses from remote destinations, nonmatching ports/IP/network or ambiguous owners', () => {
  for (const metadata of [
    { destinationIP: '192.0.2.1' },
    { destinationPort: '9090' },
    { sourcePort: '50002' },
    { sourceIP: '::1' },
    { network: 'udp' },
  ]) {
    const client = row('client', app);
    Object.assign(client.metadata!, metadata);
    expect(
      attributeLocalProxyConnections(snap([row('proxy')]), snap([client]), [7890], 1200)
        .connections[0].metadata?.processPath
    ).toBeUndefined();
  }
  const ambiguous = [
    row('client', app),
    row('other', '/Applications/Other.app/Contents/MacOS/Main'),
  ];
  expect(
    attributeLocalProxyConnections(snap([row('proxy')]), snap(ambiguous), [7890], 1200)
      .connections[0].metadata?.processPath
  ).toBeUndefined();
});

it('ignores unavailable/stale/future observations and preserves authoritative process attribution', () => {
  const original = snap([row('proxy')]);
  for (const observed of [
    undefined,
    { ...snap([row('client', app)]), unavailable: true },
    snap([row('client', app)], -6000),
    snap([row('client', app)], 3000),
  ]) {
    expect(attributeLocalProxyConnections(original, observed, [7890], 1200)).toBe(original);
  }
  const known = row('proxy', '/Applications/Other.app/Contents/MacOS/Main');
  expect(
    attributeLocalProxyConnections(snap([known]), snap([row('client', app)]), [7890], 1200)
      .connections[0]
  ).toBe(known);
  const pid = row('proxy');
  pid.metadata!.processId = 99;
  expect(
    attributeLocalProxyConnections(snap([pid]), snap([row('client', app)]), [7890], 1200)
      .connections[0]
  ).toBe(pid);
});

it('supports IPv4 mapped loopback and duplicate descriptors with the same owner', () => {
  const client = row('client', app);
  client.metadata!.sourceIP = '::ffff:127.0.0.1';
  expect(
    attributeLocalProxyConnections(
      snap([row('proxy')]),
      snap([client, { ...client, id: 'duplicate' }]),
      [7890],
      1200
    ).connections[0].metadata?.processPath
  ).toBe(app);
});
