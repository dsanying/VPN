import { selectSubscriptionProtocol } from '../subscription-protocol';
import type { ServerConfig } from '../types';
const nodes = [
  { protocol: 'vmess' },
  { protocol: 'vless' },
  { protocol: 'hysteria2' },
] as ServerConfig[];
it('默认自动保留多协议，单选只保留目标协议', () => {
  expect(selectSubscriptionProtocol(nodes)).toBe(nodes);
  expect(selectSubscriptionProtocol(nodes, 'auto')).toBe(nodes);
  expect(selectSubscriptionProtocol(nodes, 'vless')).toEqual([nodes[1]]);
});
it('未知或不存在的协议显式报错，不以空结果覆盖旧订阅', () => {
  expect(() => selectSubscriptionProtocol(nodes, 'trojan')).toThrow('没有所选协议');
  expect(() => selectSubscriptionProtocol(nodes, 'unknown' as never)).toThrow('Unsupported');
});
