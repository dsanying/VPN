import {
  nodeRegionCode,
  nodeRegionEvidence,
  nodeDisplayName,
  nodeDisplayIdentity,
  nodeGroupName,
  resolveNodeIdentity,
} from '../node-identity';
import type { ServerConfig, SubscriptionConfig } from '../types';

it('uses measured ISO region only, preserves original name and falls back to globe', () => {
  expect(nodeDisplayName('日本名称', ' sg ')).toBe('🇸🇬 日本名称');
  expect(nodeDisplayName('日本名称', undefined)).toBe('🌐 日本名称');
  expect(nodeDisplayName('日本名称', 'invalid')).toBe('🌐 日本名称');
});
it('resolves IDs and unique routing names; ambiguous names cannot borrow a region', () => {
  const a = { id: 'a', name: 'Duplicate' } as ServerConfig;
  const b = { id: 'b', name: 'Duplicate' } as ServerConfig;
  const c = { id: 'c', name: 'Unique' } as ServerConfig;
  expect(resolveNodeIdentity('a', [a, b, c])).toBe(a);
  expect(resolveNodeIdentity('Unique', [a, b, c])).toBe(c);
  expect(resolveNodeIdentity('Duplicate', [a, b, c])).toBeUndefined();
  expect(resolveNodeIdentity('direct', [a, b, c])).toBeUndefined();
  expect(a.name).toBe('Duplicate');
});

it('uses one group / measured region original-name contract across display formats', () => {
  const name = '日本 / 原名 🇺🇸';
  expect(nodeDisplayName(name, 'SG', '订阅一')).toBe('订阅一 / 🇸🇬 日本 / 原名 🇺🇸');
  expect(nodeDisplayName(name, undefined, '订阅二')).toBe('订阅二 / 🌐 日本 / 原名 🇺🇸');
  expect(nodeDisplayName(name, 'SG', '')).toBe('🇸🇬 日本 / 原名 🇺🇸');
});

it('resolves duplicate names by node membership and follows orphan and mesh grouping', () => {
  const a = { id: 'a', name: '同名', protocol: 'vless', subscriptionId: 's1' } as ServerConfig;
  const b = { ...a, id: 'b', subscriptionId: 's2' };
  const subscriptions = [
    { id: 's1', name: '订阅一' },
    { id: 's2', name: '订阅二' },
  ] as SubscriptionConfig[];
  const labels = { manual: '自建节点', mesh: '组网' };
  expect(nodeGroupName(a, subscriptions, labels)).toBe('订阅一');
  expect(nodeGroupName(b, subscriptions, labels)).toBe('订阅二');
  expect(nodeGroupName(a, [], labels)).toBe('自建节点');
  expect(nodeGroupName({ ...a, protocol: 'wireguard' }, [], labels)).toBe('组网');
  expect(nodeDisplayIdentity(a.name, 'JP', nodeGroupName(a, subscriptions, labels))).toEqual({
    name: '同名',
    region: '🇯🇵',
    groupPrefix: '订阅一 /',
    text: '订阅一 / 🇯🇵 同名',
  });
  expect(a.name).toBe('同名');
});

it('shares enterprise and ordinary node identity without inferring geography from names', () => {
  const node = {
    id: 'enterprise',
    name: 'Example corporate gateway',
    protocol: 'enterprise',
  } as ServerConfig;
  const labels = { manual: '自建节点', mesh: '组网' };
  const detail = {
    exit: { ip: '192.0.2.1', countryCode: ' sg ', measuredAt: 1, provider: 'test' },
  };
  expect(nodeRegionCode(detail)).toBe('sg');
  expect(nodeDisplayName(node.name, nodeRegionCode(detail), nodeGroupName(node, [], labels))).toBe(
    '自建节点 / 🇸🇬 Example corporate gateway'
  );
  expect(nodeRegionCode()).toBeUndefined();
  expect(nodeRegionCode({ exit: { ...detail.exit, countryCode: 'invalid' } })).toBeUndefined();
  expect(nodeDisplayName('日本 gateway.example.com', nodeRegionCode(), '自建节点')).toBe(
    '自建节点 / 🌐 日本 gateway.example.com'
  );
});

it('keeps gateway and exit evidence distinct with measured exit precedence', () => {
  const gateway = { ip: '192.0.2.1', countryCode: 'CN', measuredAt: 1, provider: 'test' };
  const exit = { ip: '192.0.2.2', countryCode: 'SG', measuredAt: 2, provider: 'test' };
  expect(nodeRegionEvidence({ gateway })).toEqual({ source: 'gateway', observation: gateway });
  expect(nodeRegionCode({ gateway })).toBe('cn');
  expect(nodeRegionEvidence({ gateway, exit })).toEqual({ source: 'exit', observation: exit });
  expect(nodeRegionCode({ gateway, exit })).toBe('sg');
});
