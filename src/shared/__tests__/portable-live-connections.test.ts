import { PortableLiveConnections } from '../portable-live-connections';
const connection = {
  source: '[::1]:42',
  destination: '192.0.2.1:443',
  domain: 'example.com',
  network: 'tcp',
  packages: ['com.example.client'],
  uploadTotal: 10,
  downloadTotal: 20,
  createdAt: 1760140000000,
};
test('native deltas and close update active entries without fabricating an outbound', () => {
  const live = new PortableLiveConnections();
  live.apply({ reset: true, events: [{ type: 0, id: 'a', connection }] });
  live.apply({ reset: false, events: [{ type: 1, id: 'a', uploadDelta: 4, downloadDelta: 6 }] });
  expect(live.snapshot().connections[0]).toMatchObject({
    chains: [],
    upload: 14,
    download: 26,
    metadata: {
      sourceIP: '::1',
      sourcePort: '42',
      destinationIP: '192.0.2.1',
      processPath: 'android-package:com.example.client',
    },
  });
  live.apply({ reset: false, events: [{ type: 2, id: 'a' }] });
  expect(live.snapshot().connections).toEqual([]);
});
test('limit is explicit until reset; inaccessible package identity retains the observed UID', () => {
  const live = new PortableLiveConnections(1);
  live.apply({
    reset: true,
    events: [
      { type: 0, id: 'a', connection: { ...connection, packages: [], uid: 12345 } },
      { type: 0, id: 'b', connection },
    ],
  });
  expect(live.snapshot()).toMatchObject({
    limited: true,
    connections: [{ metadata: { processName: 'UID 12345' } }],
  });
  live.apply({ reset: true, events: [] });
  expect(live.snapshot().limited).toBeUndefined();
  expect(live.snapshot([], false).unavailable).toBe(true);
});
test('unknown update and invalid deltas cannot create or poison a connection', () => {
  const live = new PortableLiveConnections();
  live.apply({ reset: false, events: [{ type: 1, id: 'unknown', uploadDelta: 1 }] });
  live.apply({
    reset: false,
    events: [
      { type: 0, id: 'a', connection: { ...connection, createdAt: 1e30 } },
      { type: 1, id: 'a', uploadDelta: -2, downloadDelta: NaN },
    ],
  });
  expect(live.snapshot().connections).toHaveLength(1);
  expect(live.snapshot().connections[0]).toMatchObject({ upload: 10, download: 20 });
});
