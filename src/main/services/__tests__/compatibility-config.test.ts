import { ProtocolParser } from '../ProtocolParser';
import { parseClashProxies } from '../ClashSubscriptionParser';
import { parseXrayOutbounds } from '../xray-import';
import {
  buildXrayConfig,
  buildMihomoConfig,
  buildXrayOutbound,
  rejectExternalCoreReferences,
} from '../compatibility-config';
import { compatibilityEngine } from '../../../shared/core-capabilities';
import { protocolRequirementError } from '../../../shared/server-completeness';
import { redactDeep } from '../../../shared/diagnostic-redact';

const parser = new ProtocolParser();
const bridge = { port: 19081, username: 'fixture-user', password: 'fixture-password' };
const extra = {
  noSSEHeader: true,
  xmux: { maxConcurrency: '8-16' },
  downloadSettings: {
    address: 'download.example.com',
    port: 443,
    network: 'xhttp',
    security: 'tls',
    tlsSettings: { serverName: 'download.example.com' },
  },
};

it.each(['xhttp', 'splithttp'])(
  'preserves URL %s fields through sharing and native core generation',
  (type) => {
    const url = `vless://00000000-0000-4000-8000-000000000001@example.com:443?type=${type}&security=tls&host=cdn.example.com&path=%2Fupload&mode=packet-up&extra=${encodeURIComponent(JSON.stringify(extra))}#fixture`;
    const server = parser.parseUrl(url);
    expect(server.network).toBe('xhttp');
    expect(compatibilityEngine(server)).toBe('xray');
    expect(parser.parseUrl(parser.generateUrl(server)).xhttpSettings).toEqual(server.xhttpSettings);
    const config = buildXrayConfig([{ server, bridge }], 19080) as any;
    expect(config.outbounds[0].streamSettings.xhttpSettings.extra.xmux).toEqual(extra.xmux);
    expect(
      config.outbounds[0].streamSettings.xhttpSettings.extra.downloadSettings.sockopt.dialerProxy
    ).toBe('dial-0');
    expect(config.outbounds[0].streamSettings.tlsSettings.allowInsecure).toBe(false);
    expect(config.inbounds[0].listen).toBe('127.0.0.1');
    expect(config.inbounds[0].settings.accounts[0].pass).toBe(bridge.password);
  }
);

it('VMess XHTTP sharing preserves extended options', () => {
  const server = parser.parseUrl(
    'vmess://' +
      Buffer.from(
        JSON.stringify({
          add: 'example.com',
          port: '443',
          id: 'fixture-id',
          net: 'splithttp',
          host: 'cdn.example.com',
          path: '/up',
          mode: 'stream-up',
          extra,
        })
      ).toString('base64')
  );
  expect(parser.parseUrl(parser.generateUrl(server)).xhttpSettings).toEqual(server.xhttpSettings);
});

it('Clash XHTTP retains native options without TLS bypass', () => {
  const result = parseClashProxies(
    [
      {
        type: 'vless',
        name: 'fixture',
        server: 'example.com',
        port: 443,
        uuid: 'fixture-id',
        network: 'xhttp',
        tls: true,
        'xhttp-opts': { host: 'cdn.example.com', path: '/up', mode: 'auto', extra },
      },
    ],
    'fixture-sub',
    '2026-10-08T00:00:00Z'
  );
  expect(result.failed).toBe(0);
  expect(result.servers[0].xhttpSettings?.extra).toEqual(extra);
  expect(result.servers[0].tlsSettings?.allowInsecure).not.toBe(true);
});

it('unknown transports and invalid modes never become TCP', () => {
  expect(() => parser.parseUrl('vless://fixture@example.com:443?type=unknown')).toThrow();
  expect(() =>
    parser.parseUrl('vless://fixture@example.com:443?type=xhttp&mode=invalid')
  ).toThrow();
});

it('native Xray KCP and VLESS encryption remain complete native data', () => {
  const native = {
    tag: 'fixture',
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: 'example.com',
          port: 443,
          users: [{ id: 'fixture-id', encryption: 'fixture-new-encryption' }],
        },
      ],
    },
    streamSettings: {
      network: 'kcp',
      kcpSettings: { seed: 'fixture-seed', header: { type: 'none' } },
    },
  };
  const server = parseXrayOutbounds([native], '2026-10-08T00:00:00Z').servers[0];
  expect(server.network).not.toBe('tcp');
  expect(server.compatibilitySettings?.outbound).toEqual(native);
  expect(buildXrayOutbound(server, 'runtime').streamSettings).toMatchObject(native.streamSettings);
});

it('SSR imports as native mihomo data with the entire protocol and obfs parameters', () => {
  const raw = {
    name: 'fixture',
    type: 'ssr',
    server: 'example.com',
    port: 443,
    cipher: 'aes-128-cfb',
    password: 'fixture-secret',
    protocol: 'auth_sha1_v4',
    obfs: 'tls1.2_ticket_auth',
    'obfs-param': 'cdn.example.com',
    'protocol-param': 'fixture-param',
    udp: true,
  };
  const result = parseClashProxies([raw], 'fixture-sub', '2026-10-08T00:00:00Z');
  const server = result.servers[0];
  expect(protocolRequirementError(server)).toBeNull();
  expect(server.compatibilitySettings?.outbound).toEqual(raw);
  const config = buildMihomoConfig([{ server, bridge, dialPort: 19082 }], 19080) as any;
  expect(config.proxies[0]).toMatchObject({
    type: 'ssr',
    'protocol-param': 'fixture-param',
    'dialer-proxy': 'dial-0',
  });
  expect(config.proxies[1].port).toBe(19082);
  expect(config.listeners[0]).toMatchObject({
    listen: '127.0.0.1',
    proxy: 'node-0',
    users: [{ username: bridge.username, password: bridge.password }],
  });
  expect((redactDeep(config) as any).proxies[0].password).not.toBe(raw.password);
});

it.each(['certificateFile', 'keyFile', 'private-key-path', 'dialer-proxy', 'proxySettings'])(
  'rejects untrusted external reference %s',
  (key) => {
    expect(() =>
      rejectExternalCoreReferences({ extra: { [key]: '/fixture/private-file' } })
    ).toThrow();
  }
);

it('SSR URL round trips Unicode remarks, password, obfs and protocol parameters', () => {
  const encode = (text: string) => Buffer.from(text).toString('base64url');
  const payload = `example.com:443:auth_sha1_v4:aes-128-cfb:tls1.2_ticket_auth:${encode('fixture-p:a:ss')}/?remarks=${encode('测试 fixture')}&obfsparam=${encode('cdn.example.com')}&protoparam=${encode('fixture-user:param')}&group=${encode('fixture-group')}`;
  const server = parser.parseUrl('ssr://' + encode(payload));
  expect(server.name).toBe('测试 fixture');
  expect(server.compatibilitySettings?.outbound).toMatchObject({
    password: 'fixture-p:a:ss',
    'obfs-param': 'cdn.example.com',
    'protocol-param': 'fixture-user:param',
    group: 'fixture-group',
  });
  expect(parser.parseUrl(parser.generateUrl(server)).compatibilitySettings).toEqual(
    server.compatibilitySettings
  );
});

it('SSR malformed credentials and ports do not create usable nodes', () => {
  for (const value of [
    'example.com:0:origin:aes-128-cfb:plain:Zml4dHVyZQ',
    'example.com:443:origin:aes-128-cfb:plain:',
    'invalid-fields',
  ])
    expect(() => parser.parseUrl('ssr://' + Buffer.from(value).toString('base64url'))).toThrow();
});

it('new VLESS encryption preserves WebSocket mapping instead of silently becoming TCP', () => {
  const server = parser.parseUrl(
    'vless://fixture-id@example.com:443?encryption=fixture-encryption&type=ws&path=%2Ffixture&host=cdn.example.com'
  );
  expect(buildXrayOutbound(server, 'fixture').streamSettings).toMatchObject({
    network: 'ws',
    wsSettings: { path: '/fixture', headers: { Host: 'cdn.example.com' } },
  });
});

it('native Xray credentials redact without deleting non-secret request correlation ids', () => {
  expect(
    redactDeep({
      id: 'event-fixture',
      settings: { vnext: [{ users: [{ id: 'fixture-secret', encryption: 'fixture-key' }] }] },
      inbounds: [{ settings: { accounts: [{ pass: 'fixture-password' }] } }],
    })
  ).toMatchObject({
    id: 'event-fixture',
    settings: { vnext: [{ users: [{ id: '<redacted>', encryption: '<redacted>' }] }] },
    inbounds: [{ settings: { accounts: [{ pass: '<redacted>' }] } }],
  });
});
it.each(['certificate', 'private-key', 'ca', 'plugin-path', 'script', 'dialerProxy'])(
  'prevents subscriptions referencing local files or foreign core routes through %s',
  (key) => {
    expect(() => rejectExternalCoreReferences({ [key]: '/fixture/private-file' })).toThrow();
  }
);
it('inline PEM certificates are preserved', () => {
  expect(() =>
    rejectExternalCoreReferences({
      certificate: '-----BEGIN CERTIFICATE-----\nfixture-only\n-----END CERTIFICATE-----',
    })
  ).not.toThrow();
});
it('Clash new VLESS encryption is preserved and selects Xray', () => {
  const { servers } = parseClashProxies(
    [
      {
        type: 'vless',
        name: 'fixture',
        server: 'example.com',
        port: 443,
        uuid: 'fixture-id',
        encryption: 'fixture-new-encryption',
      },
    ],
    'fixture',
    '2026-10-08T00:00:00Z'
  );
  expect(servers[0].encryption).toBe('fixture-new-encryption');
  expect(compatibilityEngine(servers[0])).toBe('xray');
});
it('native Xray scalar edits update the actual outbound and keep advanced fields', () => {
  const raw = {
    protocol: 'vless',
    settings: {
      vnext: [
        { address: 'example.com', port: 443, users: [{ id: 'fixture-old', encryption: 'none' }] },
      ],
    },
    streamSettings: { network: 'kcp', kcpSettings: { seed: 'fixture' } },
  };
  const server = parseXrayOutbounds([raw], '2026-10-08T00:00:00Z').servers[0];
  server.uuid = 'fixture-new';
  server.address = 'new.example.com';
  server.port = 8443;
  expect(buildXrayOutbound(server, 'fixture')).toMatchObject({
    settings: {
      vnext: [{ address: 'new.example.com', port: 8443, users: [{ id: 'fixture-new' }] }],
    },
    streamSettings: raw.streamSettings,
  });
});

it('HTTP camouflage adapter retains full native transport while applying node identity edits', () => {
  const raw = {
    name: 'Example',
    type: 'vmess',
    server: 'old.example.com',
    port: 80,
    uuid: '00000000-0000-4000-8000-000000000001',
    network: 'http',
    'http-opts': {
      method: 'GET',
      path: ['/first', '/second'],
      headers: { Host: ['example.com'], 'X-Test': ['one', 'two'] },
    },
  };
  const node = parseClashProxies([raw], 'fixture', '2026-01-01').servers[0];
  const config = buildMihomoConfig(
    [
      {
        server: {
          ...node,
          address: 'new.example.com',
          port: 8443,
          uuid: '00000000-0000-4000-8000-000000000002',
        },
        bridge,
      },
    ],
    19080
  );
  expect((config.proxies as Array<Record<string, unknown>>)[0]).toMatchObject({
    type: 'vmess',
    server: 'new.example.com',
    port: 8443,
    uuid: '00000000-0000-4000-8000-000000000002',
    network: 'http',
    'http-opts': raw['http-opts'],
  });
  expect(raw.server).toBe('old.example.com');
  expect(raw.port).toBe(80);
});
