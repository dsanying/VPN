import type { UserConfig } from '../../../shared/types';
import { changedMeasurementScope, measurementConfigSnapshot } from '../measurement-refresh';
const config = () =>
  ({
    servers: [
      {
        id: 'a',
        name: 'A',
        protocol: 'vless',
        address: 'example.com',
        port: 443,
        subscriptionId: 's1',
      },
      {
        id: 'b',
        name: 'B',
        protocol: 'vless',
        address: 'example.net',
        port: 443,
        subscriptionId: 's2',
      },
    ],
    subscriptions: [
      { id: 's1', name: 'Group A', url: 'https://example.com/a', lastUpdated: '2026-01-01' },
      { id: 's2', name: 'Group B', url: 'https://example.com/b', lastUpdated: '2026-01-01' },
    ],
  }) as unknown as UserConfig;
it('completed group sync (including unchanged content) refreshes only that group without resynchronization loops', () => {
  const c = config();
  const before = measurementConfigSnapshot(c);
  c.subscriptions![0].lastUpdated = '2026-01-02';
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c))).toEqual({
    all: false,
    groupIds: ['s1'],
    syncGroupIds: [],
    nodeIds: [],
    subscriptionIds: ['s1'],
  });
});
it('source edits resynchronize the group, but quota metadata and UI preferences do not', () => {
  const c = config();
  const before = measurementConfigSnapshot(c);
  c.uiTheme = 'dark';
  c.subscriptions![0].userInfo = { upload: 1, download: 2, total: 100 };
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c)).groupIds).toEqual([]);
  c.subscriptions![0].name = 'Renamed';
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c)).syncGroupIds).toEqual([
    's1',
  ]);
  c.subscriptions![1].url = 'https://example.com/changed';
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c)).syncGroupIds).toEqual([
    's1',
    's2',
  ]);
});
it('transport edits select one node, membership changes select groups, and obsolete target overrides do not affect measurements', () => {
  const c = config();
  const before = measurementConfigSnapshot(c);
  c.servers[0].port = 8443;
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c)).nodeIds).toEqual(['a']);
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c)).groupIds).toEqual([]);
  c.servers[0].subscriptionId = 's2';
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c)).groupIds).toEqual([
    's2',
    's1',
  ]);
  Object.assign(c, { speedTestUrl: 'https://example.org/check' });
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c)).all).toBe(false);
});
it('deletion selects only surviving members and does not resynchronize removed subscriptions', () => {
  const c = config();
  const before = measurementConfigSnapshot(c);
  c.servers = [];
  c.subscriptions = [];
  expect(changedMeasurementScope(before, measurementConfigSnapshot(c))).toEqual({
    all: false,
    groupIds: [],
    syncGroupIds: [],
    nodeIds: [],
    subscriptionIds: [],
  });
});
