import { commitSubscriptionResult } from '../subscription-commit';
import { createDefaultConfig } from '../config-defaults';
import type { ServerConfig, UserConfig } from '../types';
const source = { id: 'group', url: 'https://example.com/subscription' };
const node = (id: string, providerName?: string): ServerConfig => ({
  id,
  name: id,
  protocol: 'trojan',
  address: `${id}.example.com`,
  port: 443,
  password: 'fixture',
  createdAt: 'before',
  updatedAt: 'before',
  subscriptionId: source.id,
  providerName,
});
const fixture = (): UserConfig & { subscriptions: NonNullable<UserConfig['subscriptions']> } => ({
  ...createDefaultConfig('fixture'),
  subscriptions: [
    { ...source, name: 'Fixture', autoUpdate: true, createdAt: 'before', etag: 'old' },
  ],
  servers: [node('old')],
  selectedServerId: 'old',
});
describe('shared subscription commit semantics', () => {
  it('preserves node identities and ordering for unchanged content while clearing retired validators', () => {
    const config = fixture();
    const before = config.servers;
    const result = commitSubscriptionResult(
      config,
      source,
      { servers: [{ ...node('old'), id: 'fresh' }] },
      'now'
    );
    expect(result.result.unchanged).toBe(true);
    expect(config.servers).toBe(before);
    expect(config.subscriptions[0].etag).toBeUndefined();
    expect(result.restartRequired).toBe(false);
  });
  it('rejects a changed source and an empty successful response before mutating configuration', () => {
    const config = fixture();
    const before = structuredClone(config);
    expect(() =>
      commitSubscriptionResult(
        config,
        { ...source, url: 'https://example.com/new' },
        { servers: [node('new')] },
        'now'
      )
    ).toThrow('changed');
    expect(() => commitSubscriptionResult(config, source, { servers: [] }, 'now')).toThrow(
      'no usable nodes'
    );
    expect(config).toEqual(before);
  });
  it('retains only failed-provider leftovers and reselects a live exit', () => {
    const config = fixture();
    config.servers = [node('old', 'healthy'), node('retained', 'failed')];
    const result = commitSubscriptionResult(
      config,
      source,
      { servers: [node('new', 'healthy')], partial: true, failedProviders: ['failed'] },
      'now'
    );
    expect(config.servers.map((server) => server.id)).toEqual(['new', 'retained']);
    expect(config.selectedServerId).toBe('new');
    expect(result.result.deletedServers).toBe(1);
    expect(result.restartRequired).toBe(false);
  });
  it('prefers same-subscription candidates over unrelated manual nodes when reselecting', () => {
    const config = fixture();
    const manual: ServerConfig = { ...node('manual-campus'), subscriptionId: undefined };
    config.servers = [manual, node('old'), node('peer')];
    config.selectedServerId = 'old';
    commitSubscriptionResult(config, source, { servers: [node('peer')] }, 'now');
    expect(config.selectedServerId).toBe('peer');
  });
  it('ranks a same-region peer above a cross-region one when reselecting', () => {
    const config = fixture();
    config.servers = [node('old'), node('jp-peer'), node('us-peer')];
    config.selectedServerId = 'old';
    const region = (code: string) => ({
      exit: { ip: '1.1.1.1', countryCode: code, measuredAt: 1, provider: 'test' },
    });
    commitSubscriptionResult(
      config,
      source,
      { servers: [node('us-peer'), node('jp-peer')] },
      'now',
      undefined,
      undefined,
      {
        latencyMap: { 'us-peer': 50, 'jp-peer': 300 },
        regionMap: {
          old: region('JP'),
          'jp-peer': region('JP'),
          'us-peer': region('US'),
        },
      }
    );
    expect(config.selectedServerId).toBe('jp-peer');
  });
  it('cross-region fallback stays inside the subscription over an unrelated manual node', () => {
    const config = fixture();
    const manual: ServerConfig = {
      ...node('manual'),
      subscriptionId: undefined,
      id: 'manual-node',
      name: 'manual-node',
    };
    config.servers = [manual, node('old'), node('remote-peer')];
    config.selectedServerId = 'old';
    const region = (code: string) => ({
      exit: { ip: '1.1.1.1', countryCode: code, measuredAt: 1, provider: 'test' },
    });
    commitSubscriptionResult(
      config,
      source,
      { servers: [node('remote-peer')] },
      'now',
      undefined,
      undefined,
      {
        regionMap: {
          old: region('JP'),
          'manual-node': region('JP'),
          'remote-peer': region('BR'),
        },
      }
    );
    expect(config.selectedServerId).toBe('remote-peer');
  });
  it('304 updates metadata without changing nodes or dropping validators', () => {
    const config = fixture();
    const before = config.servers;
    commitSubscriptionResult(config, source, { notModified: true }, 'now');
    expect(config.servers).toBe(before);
    expect(config.subscriptions[0].etag).toBe('old');
    expect(config.subscriptions[0].lastUpdated).toBe('now');
  });
});
