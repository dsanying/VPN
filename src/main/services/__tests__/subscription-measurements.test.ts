import { closeMeasurementDatabases } from '../MeasurementDatabase';
jest.mock('../subscription-connectivity', () => ({ checkSubscriptionConnectivity: jest.fn() }));
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SubscriptionMeasurementService } from '../SubscriptionMeasurementService';
import { checkSubscriptionConnectivity } from '../subscription-connectivity';
import type { UserConfig } from '../../../shared/types';
it('database survives service restart; rename preserves, URL changes invalidate, deletion during check cannot resurrect a row', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subscription-measurements-'));
  let config = {
    servers: [],
    subscriptions: [
      {
        id: 's1',
        name: 'Test',
        url: 'https://example.com/private-token',
        createdAt: '2026-01-01',
        autoUpdate: true,
      },
    ],
  } as unknown as UserConfig;
  const manager = {
    getConfigPath: () => path.join(dir, 'config.json'),
    loadConfig: async () => config,
  } as never;
  const publish = jest.fn();
  const result = {
    direct: { status: 'reachable' as const, httpStatus: 200 },
    current: { status: 'failed' as const },
    checkedAt: new Date().toISOString(),
  };
  const probe = jest.mocked(checkSubscriptionConnectivity);
  probe.mockResolvedValue(result);
  try {
    const service = new SubscriptionMeasurementService(manager, () => null, publish);
    await Promise.all([service.check('s1'), service.check('s1')]);
    expect(probe).toHaveBeenCalledTimes(1);
    const restored = new SubscriptionMeasurementService(manager, () => null, publish);
    expect(await restored.read()).toEqual({ s1: result });
    config.subscriptions![0].name = 'Renamed';
    expect(await restored.read()).toEqual({ s1: result });
    config.subscriptions![0].url = 'https://example.com/new';
    expect(await restored.read()).toEqual({});
    let finish!: (value: typeof result) => void;
    probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = restored.check('s1');
    await new Promise((resolve) => setImmediate(resolve));
    config = { ...config, subscriptions: [] };
    finish(result);
    await pending;
    expect(await restored.read()).toEqual({});
    const db = await fs.readFile(path.join(dir, 'measurements.sqlite'));
    expect(db.includes(Buffer.from('private-token'))).toBe(false);
  } finally {
    closeMeasurementDatabases(path.join(dir, 'measurements.sqlite'));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
