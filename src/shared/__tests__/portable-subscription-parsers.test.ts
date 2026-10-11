import { parseSingboxOutbounds } from '../singbox-subscription-parser';
import { parseXrayOutbounds } from '../xray-import';
import { reconcileServers, leftoverToKeep } from '../subscription-reconciliation';

const uuid = '00000000-0000-4000-8000-000000000001';

test('JSON parsers work without Node Buffer and retain TLS and transport parameters', () => {
  const buffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined as never;
    const nodes = parseSingboxOutbounds(
      [
        {
          type: 'vless',
          tag: 'fixture',
          server: 'example.com',
          server_port: 443,
          uuid,
          transport: { type: 'ws', path: '/fixture', headers: { Host: 'edge.example.com' } },
          tls: { enabled: true, server_name: 'example.com', alpn: ['h2'], insecure: false },
        },
      ],
      'group',
      { addLog: jest.fn() }
    );
    expect(nodes[0]).toMatchObject({
      subscriptionId: 'group',
      uuid,
      network: 'ws',
      security: 'tls',
      tlsSettings: { serverName: 'example.com', alpn: ['h2'], allowInsecure: false },
      wsSettings: { path: '/fixture', headers: { Host: 'edge.example.com' } },
    });
    const xray = parseXrayOutbounds(
      [
        {
          tag: 'fixture',
          protocol: 'vless',
          settings: { vnext: [{ address: 'example.com', port: 443, users: [{ id: uuid }] }] },
          streamSettings: {
            network: 'ws',
            security: 'tls',
            tlsSettings: { serverName: 'example.com' },
            wsSettings: { path: '/fixture', headers: { Host: 'edge.example.com' } },
          },
        },
      ],
      '2026-01-01T00:00:00Z'
    );
    expect(xray.servers[0]).toMatchObject({
      uuid,
      network: 'ws',
      security: 'tls',
      wsSettings: { path: '/fixture', headers: { Host: 'edge.example.com' } },
    });
    expect(xray.failed).toBe(0);
  } finally {
    globalThis.Buffer = buffer;
  }
});

test('shared reconciliation preserves stable identity and only retains failed provider removals', () => {
  const log = { addLog: jest.fn() };
  const old = parseSingboxOutbounds(
    [{ type: 'vless', tag: 'old', server: 'example.com', server_port: 443, uuid }],
    'group',
    log
  );
  const fetched = parseSingboxOutbounds(
    [{ type: 'vless', tag: 'renamed', server: 'example.com', server_port: 443, uuid }],
    'group',
    log
  );
  const result = reconcileServers(old, fetched, '2026-01-01T00:00:00Z');
  expect(result.servers[0]).toMatchObject({
    id: old[0].id,
    name: 'renamed',
    createdAt: old[0].createdAt,
  });
  expect(result.added).toBe(0);
  const missing = [
    { ...old[0], id: 'failed', providerName: 'failed-provider' },
    { ...old[0], id: 'removed', providerName: 'successful-provider' },
  ];
  expect(
    leftoverToKeep(missing, new Set(['failed', 'removed']), ['failed-provider']).map(
      (node) => node.id
    )
  ).toEqual(['failed']);
});

test('unknown Sing-box transport is reported and cannot become a plain TCP node', () => {
  const log = { addLog: jest.fn() };
  expect(
    parseSingboxOutbounds(
      [
        {
          type: 'vless',
          tag: 'fixture',
          server: 'example.com',
          server_port: 443,
          uuid,
          transport: { type: 'unknown' },
        },
      ],
      'group',
      log
    )
  ).toEqual([]);
  expect(log.addLog).toHaveBeenCalledWith(
    'warn',
    expect.stringContaining('unknown'),
    'Subscription'
  );
});
