import { buildMihomoProxy, MihomoCompatibilityRequired } from '../mihomo-proxy-builder';
import type { ServerConfig } from '../../../shared/types';

const node = (extra: Partial<ServerConfig> = {}): ServerConfig =>
  ({
    id: 'fixture',
    name: 'fixture',
    protocol: 'vless',
    address: 'example.com',
    port: 443,
    uuid: '00000000-0000-4000-8000-000000000001',
    ...extra,
  }) as ServerConfig;

it('normalizes encoded WS early data while preserving unrelated query parameters', () => {
  expect(
    buildMihomoProxy(
      node({ network: 'ws', wsSettings: { path: '/fixture?ed=2048&eh=X-Fixture&keep=yes' } }),
      'fixture'
    )
  ).toMatchObject({
    'ws-opts': {
      path: '/fixture?keep=yes',
      'max-early-data': 2048,
      'early-data-header-name': 'X-Fixture',
    },
  });
});

it('preserves address, SNI, Host, early data and explicit certificate verification separately', () => {
  expect(
    buildMihomoProxy(
      node({
        security: 'tls',
        network: 'httpupgrade',
        tlsSettings: { serverName: 'tls.example.com', alpn: ['h2'], fingerprint: 'chrome' },
        wsSettings: {
          path: '/fixture',
          headers: { Host: 'http.example.com' },
          maxEarlyData: 2048,
          earlyDataHeaderName: 'Sec-WebSocket-Protocol',
        },
      }),
      'group / fixture'
    )
  ).toMatchObject({
    server: 'example.com',
    servername: 'tls.example.com',
    'skip-cert-verify': false,
    'client-fingerprint': 'chrome',
    network: 'ws',
    'ws-opts': {
      path: '/fixture',
      headers: { Host: 'http.example.com' },
      'max-early-data': 2048,
      'early-data-header-name': 'Sec-WebSocket-Protocol',
      'v2ray-http-upgrade': true,
    },
  });
});

it('uses native VLESS XHTTP and routes other or advanced XHTTP through Xray without dropping fields', () => {
  expect(
    buildMihomoProxy(
      node({ network: 'xhttp', xhttpSettings: { path: '/fixture', mode: 'packet-up' } }),
      'fixture'
    )
  ).toMatchObject({ network: 'xhttp', 'xhttp-opts': { path: '/fixture', mode: 'packet-up' } });
  for (const extra of [
    { protocol: 'vmess' as const, network: 'xhttp' as const },
    { network: 'xhttp' as const, xhttpSettings: { extra: { xmux: { maxConcurrency: 4 } } } },
  ]) {
    try {
      buildMihomoProxy(node(extra), 'fixture');
      throw new Error('should require Xray');
    } catch (error) {
      expect(error).toBeInstanceOf(MihomoCompatibilityRequired);
      expect(error).toMatchObject({ engine: 'xray' });
    }
  }
});

it('keeps native dialect extensions immutable and applies edited identity and chain', () => {
  const raw = {
    type: 'ssr',
    cipher: 'aes-128-cfb',
    password: 'fictional',
    protocol: 'auth_sha1_v4',
    obfs: 'plain',
    'protocol-param': 'fictional-param',
  };
  const original = JSON.stringify(raw);
  const proxy = buildMihomoProxy(
    node({ protocol: 'custom', compatibilitySettings: { engine: 'mihomo', outbound: raw } }),
    'fixture',
    'chain'
  );
  expect(proxy).toEqual({
    ...raw,
    name: 'fixture',
    server: 'example.com',
    port: 443,
    'dialer-proxy': 'chain',
  });
  expect(JSON.stringify(raw)).toBe(original);
});

it('requires explicit compatibility for unsupported TLS options, and rejects unknown transports', () => {
  for (const tlsSettings of [
    { engine: 'apple' as const },
    { spoofSni: 'example.net' },
    { fragment: true },
  ])
    expect(() => buildMihomoProxy(node({ security: 'tls', tlsSettings }), 'fixture')).toThrow(
      MihomoCompatibilityRequired
    );
  expect(() => buildMihomoProxy(node({ network: 'unknown' as never }), 'fixture')).toThrow(
    'Unknown transport'
  );
});

it('converts protocol durations with their documented units', () => {
  expect(
    buildMihomoProxy(
      node({
        protocol: 'hysteria2',
        password: 'fictional',
        hysteria2Settings: {
          serverPorts: '20000:30000',
          hopInterval: '30s',
          obfs: { type: 'gecko', password: 'fictional', minPacketSize: 512 },
        },
      }),
      'fixture'
    )
  ).toMatchObject({
    ports: '20000-30000',
    'hop-interval': 30,
    obfs: 'gecko',
    'obfs-min-packet-size': 512,
  });
  expect(
    buildMihomoProxy(node({ protocol: 'tuic', tuicSettings: { heartbeat: '1.5s' } }), 'fixture')
  ).toMatchObject({ 'heartbeat-interval': 1500 });
});
