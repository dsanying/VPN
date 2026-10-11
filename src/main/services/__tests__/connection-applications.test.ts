import { createConnectionApplicationResolver } from '../ConnectionApplications';
import type { ConnectionsSnapshot } from '../../../shared/types';

const snapshot = (paths: string[], at = 1): ConnectionsSnapshot => ({
  at,
  connections: paths.map((processPath, index) => ({
    id: String(index),
    chains: [],
    rule: '',
    rulePayload: '',
    metadata: { processPath },
  })),
});

it('reads outer development bundles once, coalesces concurrent frames and preserves actual runtime paths', async () => {
  const read = jest.fn(async () => 'data:image/png;base64,fixture');
  const resolve = createConnectionApplicationResolver(read, 'darwin');
  const sample = snapshot([
    '/Users/example/dev/Electron.app/Contents/MacOS/Electron',
    '/Users/example/dev/Electron.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper',
    '/usr/local/bin/python3',
  ]);
  const [first, second] = await Promise.all([resolve(sample), resolve(sample)]);
  expect(read.mock.calls).toHaveLength(2);
  expect(first.applications?.map((app) => app.path)).toEqual([
    '/Users/example/dev/Electron.app',
    '/usr/local/bin/python3',
  ]);
  expect(first.applications?.every((app) => app.iconDataUrl)).toBe(true);
  expect(first.applications?.[1].coverage).toBe('unsupported');
  const next = await resolve({ ...sample, at: 2 });
  expect(next.applications).toBe(second.applications);
  expect(next.at).toBe(2);
  expect(sample.applications).toBeUndefined();
});

it('bounds native work and retains names on failures without inventing icons', async () => {
  let active = 0;
  let peak = 0;
  const read = jest.fn(async () => {
    peak = Math.max(peak, ++active);
    await new Promise((done) => setImmediate(done));
    active--;
    throw new Error('inaccessible icon');
  });
  const resolve = createConnectionApplicationResolver(read, 'darwin');
  const result = await resolve(snapshot(Array.from({ length: 23 }, (_, i) => `/opt/tool${i}`)));
  expect(result.applications).toHaveLength(23);
  expect(peak).toBeLessThanOrEqual(8);
  expect(result.applications?.every((app) => app.name && !app.iconDataUrl)).toBe(true);
});
