import {
  PortableConfigOperations,
  type PortableConfigEffects,
} from '../portable-config-operations';
import { ConfigRepository } from '../config-repository';
import { createDefaultConfig } from '../config-defaults';
import { DIRECT_SERVER_ID } from '../direct-selection';
import type { ServerConfig } from '../types';

const node: Omit<ServerConfig, 'id'> = {
  name: 'Fixture',
  protocol: 'vless',
  address: 'example.com',
  port: 443,
  uuid: '00000000-0000-4000-8000-000000000001',
};
function fixture() {
  let content: string | null = null;
  const write = jest.fn(async (_name: string, value: string) => {
    content = value;
  });
  const repository = new ConfigRepository(
    { read: async () => content, write },
    () => createDefaultConfig('fixture'),
    () => undefined
  );
  const effects: PortableConfigEffects = {
    saved: jest.fn(async () => undefined),
    removeServer: jest.fn(async () => undefined),
    removeSubscription: jest.fn(),
  };
  return {
    repository,
    write,
    effects,
    operations: new PortableConfigOperations(repository, effects),
  };
}
test('bulk imports get fresh identities, lose foreign ownership, and trigger dependencies once after persistence', async () => {
  const { repository, effects, operations } = fixture();
  const added = await operations.addServers([{ ...node, subscriptionId: 'foreign' }, node]);
  expect(new Set(added.map((item) => item.id)).size).toBe(2);
  expect(added.every((item) => !item.subscriptionId)).toBe(true);
  expect((await repository.read()).servers).toEqual(added);
  expect(effects.saved).toHaveBeenCalledTimes(1);
});
test('deleting selected nodes falls back to direct, disables dangling rules, and cleans native state', async () => {
  const { repository, effects, operations } = fixture();
  const [added] = await operations.addServers([node]);
  await operations.switchServer(added.id);
  await operations.addRule({
    type: 'domainSuffix',
    values: ['example.com'],
    enabled: true,
    action: 'proxy',
    targetServerId: added.id,
  });
  await operations.deleteServers([added.id], 'missing');
  const config = await repository.read();
  expect(config.selectedServerId).toBe(DIRECT_SERVER_ID);
  expect(config.customRules[0]).toMatchObject({ enabled: false });
  expect(config.customRules[0].targetServerId).toBeUndefined();
  expect(effects.removeServer).toHaveBeenCalledWith(expect.objectContaining({ id: added.id }));
});
test('failed storage never triggers refresh or native side effects', async () => {
  const { repository, write, effects, operations } = fixture();
  await repository.read();
  write.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(operations.addServers([node])).rejects.toThrow('database unavailable');
  expect(effects.saved).not.toHaveBeenCalled();
  expect(effects.removeServer).not.toHaveBeenCalled();
  expect((await repository.read()).servers).toEqual([]);
});
test('invalid reorder preserves every rule and unchanged reorder causes no application refresh', async () => {
  const { repository, effects, operations } = fixture();
  const rule = await operations.addRule({
    type: 'domainSuffix',
    values: ['example.com'],
    enabled: true,
    action: 'direct',
  });
  (effects.saved as jest.Mock).mockClear();
  await expect(operations.reorderRules(['missing'])).rejects.toThrow();
  await operations.reorderRules([rule.id]);
  expect((await repository.read()).customRules.map((item) => item.id)).toEqual([rule.id]);
  expect(effects.saved).not.toHaveBeenCalled();
});
test('changing a subscription link removes conditional cache and preserves creation identity', async () => {
  const { repository, operations } = fixture();
  const sub = await operations.addSubscription({
    name: 'Fixture',
    url: 'https://example.com/first',
    autoUpdate: true,
    etag: 'old',
  });
  await operations.updateSubscription({
    ...sub,
    url: 'https://example.com/second',
    createdAt: 'invalid',
    lastModified: 'old',
  });
  expect((await repository.read()).subscriptions![0]).toMatchObject({
    createdAt: sub.createdAt,
    url: 'https://example.com/second',
  });
  expect((await repository.read()).subscriptions![0].etag).toBeUndefined();
  expect((await repository.read()).subscriptions![0].lastModified).toBeUndefined();
});
