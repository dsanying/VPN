import { PortableImportParser } from '../import-parser';
import { encodeBase64Utf8 } from '../portable-codec';

const uuid = '00000000-0000-4000-8000-000000000001';
const link = `vless://${uuid}@example.com:443?security=tls&type=ws&path=%2Ffixture&sni=edge.example.com#fixture`;

test('portable local imports decode UTF-8 links without Node Buffer and preserve protocol fields', async () => {
  const encoded = encodeBase64Utf8(link);
  const buffer = globalThis.Buffer;
  let result;
  try {
    globalThis.Buffer = undefined as never;
    result = await new PortableImportParser().parseLocalContent(encoded);
  } finally {
    globalThis.Buffer = buffer;
  }
  expect(result?.format).toBe('links');
  expect(result?.nodes).toHaveLength(1);
  expect(result?.nodes[0]).toMatchObject({
    uuid,
    address: 'example.com',
    port: 443,
    security: 'tls',
    network: 'ws',
    tlsSettings: { serverName: 'edge.example.com' },
    wsSettings: { path: '/fixture' },
    subscriptionId: undefined,
    providerName: undefined,
  });
});

test('local Clash providers become source records without any network request', async () => {
  const result = await new PortableImportParser().parseLocalContent(`
proxies:
  - name: fixture
    type: trojan
    server: example.com
    port: 443
    password: fictional-password
proxy-providers:
  remote:
    type: http
    url: https://example.com/subscription
  local:
    type: file
    path: local.yaml
`);
  expect(result.nodes).toHaveLength(1);
  expect(result.subscriptions).toEqual([
    { name: 'remote', url: 'https://example.com/subscription' },
  ]);
  expect(result.nodes[0].subscriptionId).toBeUndefined();
});

test('unknown native outbounds retain the complete payload for compatibility validation', async () => {
  const outbound = {
    type: 'future-protocol',
    tag: 'fixture',
    server: 'example.com',
    server_port: 443,
    nested: { credential: 'fictional' },
  };
  const result = await new PortableImportParser().parseLocalContent(
    JSON.stringify({ outbounds: [outbound] })
  );
  expect(result.nodes[0]).toMatchObject({ protocol: 'custom', customSettings: { outbound } });
  expect(result.stats.unsupported).toBe(1);
});

test('byte budget rejects multibyte oversized input and unknown formats cannot become empty success', async () => {
  const parser = new PortableImportParser();
  await expect(parser.parseLocalContent('中'.repeat(4 * 1024 * 1024))).rejects.toThrow(
    '导入内容过大'
  );
  await expect(parser.parseLocalContent('unrecognized')).rejects.toThrow('无法识别文件格式');
});
