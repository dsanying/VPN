import { buildProxyOutbound } from '../singbox-proxy-outbound';
import type { ServerConfig } from '../types';

const node: ServerConfig = {
  id: 'node',
  name: 'test',
  protocol: 'vless',
  address: 'example.com',
  port: 443,
  uuid: '00000000-0000-4000-8000-000000000001',
  network: 'tcp',
  security: 'tls',
};
const build = (server = node) =>
  buildProxyOutbound(server, new Map([['node', 'node']]), 'dns-direct', undefined, {
    platform: 'android',
    arch: 'arm64',
  });

test('Android explicit host preserves TLS and resolver without a desktop bridge', () => {
  expect(build()).toMatchObject({
    type: 'vless',
    server: 'example.com',
    server_port: 443,
    domain_resolver: 'dns-direct',
    tls: { enabled: true },
  });
});
test('unknown transport fails instead of becoming a TCP outbound', () => {
  expect(() => build({ ...node, network: 'unknown-transport' as never })).toThrow(
    'Unsupported transport'
  );
});
test('compatibility node cannot silently start without its real additional engine', () => {
  expect(() => build({ ...node, network: 'xhttp' })).toThrow('Compatibility core is not ready');
});
