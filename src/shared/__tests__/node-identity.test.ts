import {
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
