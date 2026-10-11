import { summarizeNodeProtocols } from '../subscription-protocol';
import type { ServerConfig } from '../types';
const nodes = [
  { protocol: 'vmess' },
  { protocol: 'vless' },
  { protocol: 'hysteria2' },
] as ServerConfig[];
it('协议摘要聚合数量且不携带节点地址与凭据', () => {
  expect(
    summarizeNodeProtocols([
      ...nodes,
      { ...nodes[0], password: 'fictional-secret', address: 'example.com' },
    ])
  ).toEqual([
    { protocol: 'hysteria2', count: 1 },
    { protocol: 'vless', count: 1 },
    { protocol: 'vmess', count: 2 },
  ]);
});
