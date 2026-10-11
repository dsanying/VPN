import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  dueMeasurements,
  measurementFingerprint,
  NodeMeasurementStore,
} from '../NodeMeasurementStore';
import type { ServerConfig } from '../../../shared/types';
const node = {
  id: 'example',
  name: 'Example',
  protocol: 'vless',
  address: 'example.com',
  port: 443,
  uuid: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
} as ServerConfig;
it('restores private measurements after restart; renames retain results but transport/target edits invalidate them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-measurements-'));
  try {
    const file = path.join(dir, 'node-measurements.json');
    const record = {
      fingerprint: measurementFingerprint(node, 'https://example.com/check'),
      latency: 42,
      testedAt: 1000,
      detail: {
        entry: { status: 'ok', latencyMs: 12 },
        exit: { ip: '192.0.2.1', countryCode: 'JP', measuredAt: 1000, provider: 'Cloudflare' },
      },
    } as const;
    await new NodeMeasurementStore(file).save([node], 'https://example.com/check', {
      example: record,
    });
    const restored = new NodeMeasurementStore(file);
    expect(
      await restored.get(
        [{ ...node, name: 'Renamed', updatedAt: '2026-02-01' }],
        'https://example.com/check'
      )
    ).toEqual({ example: record });
    expect(await restored.get([{ ...node, port: 8443 }], 'https://example.com/check')).toEqual({});
    expect(await restored.get([node], 'https://example.com/other')).toEqual({});
    expect(await fs.readFile(path.join(dir, 'measurements.sqlite'), 'utf8')).not.toContain(
      node.uuid
    );
    await restored.save([node], 'https://example.com/check', {
      example: { ...record, latency: -1, testedAt: 2000, detail: { entry: { status: 'timeout' } } },
    });
    expect((await restored.get([node], 'https://example.com/check')).example.detail?.exit).toEqual(
      record.detail.exit
    );
    await restored.save([], 'https://example.com/check', {});
    expect(await new NodeMeasurementStore(file).get([node], 'https://example.com/check')).toEqual(
      {}
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
it('schedules every due node, prioritizes selection and uses the UI freshness for both outcomes', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ ...node, id: String(i) }));
  const now = 100000000;
  const records = {
    '0': { fingerprint: '', latency: 10, testedAt: now - 20 * 60000 },
    '1': { fingerprint: '', latency: -1, testedAt: now - 20 * 60000 },
    '2': { fingerprint: '', latency: -1, testedAt: now - 7 * 60 * 60000 },
  };
  const due = dueMeasurements(nodes, records, '19', now);
  expect(due).toHaveLength(18);
  expect(due[0].id).toBe('19');
  expect(due.some((node) => ['0', '1'].includes(node.id))).toBe(false);
  expect(dueMeasurements([nodes[2]], records, undefined, now)).toEqual([nodes[2]]);
});

it('clock rollback does not indefinitely suppress future-dated cached measurements', () => {
  expect(
    dueMeasurements(
      [node],
      { example: { fingerprint: '', latency: 20, testedAt: 2000 } },
      undefined,
      1000
    )
  ).toEqual([node]);
});
it('nonfinite or negative cache timestamps cannot overwrite valid measurements', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-measurements-'));
  try {
    const store = new NodeMeasurementStore(path.join(dir, 'cache.json'));
    const fingerprint = measurementFingerprint(node);
    await store.save([node], undefined, { example: { fingerprint, latency: 20, testedAt: 1000 } });
    for (const invalid of [
      { latency: Infinity, testedAt: 2000 },
      { latency: 1, testedAt: NaN },
      { latency: 1, testedAt: -1 },
    ]) {
      await store.save([node], undefined, { example: { fingerprint, ...invalid } });
    }
    expect((await store.get([node])).example).toMatchObject({ latency: 20, testedAt: 1000 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it('rechecks formerly unsupported QUIC entries without erasing the measured region', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-measurements-'));
  try {
    const file = path.join(dir, 'node-measurements.json');
    const udp = { ...node, protocol: 'tuic' as const };
    const exit = { ip: '192.0.2.1', countryCode: 'JP', measuredAt: 1000, provider: 'Cloudflare' };
    await fs.writeFile(
      file,
      JSON.stringify({
        example: {
          fingerprint: measurementFingerprint(udp),
          latency: 42,
          testedAt: 1000,
          detail: { entry: { status: 'unsupported', reason: 'NO_TCP_ENTRY' }, exit },
        },
      })
    );
    const record = (await new NodeMeasurementStore(file).get([udp])).example;
    expect(record.detail?.exit).toEqual(exit);
    expect(record.testedAt).toBe(0);
    expect(dueMeasurements([udp], { example: record }, udp.id, 2000)).toEqual([udp]);
    expect(record.detail?.entry.status).toBe('unavailable');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it('successful and unavailable results use the same six-hour background cadence', () => {
  const now = 100000000;
  const record = { fingerprint: '', latency: 12, testedAt: now - 6 * 60 * 60000 };
  expect(dueMeasurements([node], { example: record }, undefined, now)).toEqual([node]);
  const local = {
    ...record,
    latency: -1,
    testedAt: now - 6 * 60 * 60000,
    detail: { entry: { status: 'unavailable' as const }, proxyReason: 'core-not-ready' },
  };
  expect(dueMeasurements([node], { example: local }, undefined, now)).toEqual([node]);
});
