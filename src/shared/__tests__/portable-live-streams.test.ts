import { PortableLiveStreams } from '../portable-live-streams';
import { IPC_CHANNELS as C } from '../ipc-channels';
function fixture() {
  const ports = {
    subscribe: jest.fn(async () => undefined),
    emit: jest.fn(),
    running: () => true,
    applications: jest.fn(async () => []),
  };
  return { ports, live: new PortableLiveStreams(ports) };
}
test('destroying one view releases all its references and preserves another view and background logs', async () => {
  const { ports, live } = fixture();
  await live.subscription('detail', true, 'view-a');
  await live.subscription('detail', true, 'view-a');
  await live.subscription('stats', true, 'view-a');
  await live.subscription('aggregate', true, 'view-b');
  await live.releaseOwner('view-a');
  expect(ports.subscribe).toHaveBeenLastCalledWith(['logs', 'connections']);
  await live.releaseOwner('view-a');
  await live.subscription('aggregate', false, 'view-b');
  expect(ports.subscribe).toHaveBeenLastCalledWith(['logs']);
  await live.subscription('detail', true, 'view-a-reopened');
  await live.subscription('detail', false, 'view-a-reopened');
  expect(ports.subscribe).toHaveBeenLastCalledWith(['logs']);
  await live.close();
});
test('subscriptions retain shared connections until the final view detaches', async () => {
  const { ports, live } = fixture();
  await live.subscription('detail', true);
  await live.subscription('detail', true);
  await live.subscription('detail', false);
  expect(ports.subscribe).toHaveBeenLastCalledWith(['logs', 'connections']);
  await live.subscription('detail', false);
  expect(ports.subscribe).toHaveBeenLastCalledWith(['logs']);
  await live.close();
  expect(ports.subscribe).toHaveBeenLastCalledWith([]);
  await expect(live.subscription('stats', true)).rejects.toThrow('closed');
});
test('unavailable native traffic does not fabricate zero traffic and available stats match the contract', async () => {
  const { ports, live } = fixture();
  await live.subscription('stats', true);
  live.event('stats', { trafficAvailable: false });
  expect(ports.emit).not.toHaveBeenCalled();
  live.event('stats', {
    trafficAvailable: true,
    uploadSpeed: 1,
    downloadSpeed: 2,
    uploadTotal: 3,
    downloadTotal: 4,
    connectionCount: 5,
  });
  expect(ports.emit).toHaveBeenCalledWith(
    C.EVENT_STATS_UPDATED,
    expect.objectContaining({ totalUpload: 3, totalDownload: 4, activeConnections: 5 })
  );
  await live.close();
});
test('traffic-only deltas do not rebuild unchanged graph aggregates', async () => {
  const { ports, live } = fixture();
  await live.subscription('aggregate', true);
  await Promise.resolve();
  ports.emit.mockClear();
  live.event('connections', {
    reset: true,
    events: [
      {
        type: 0,
        id: 'a',
        connection: { source: '192.0.2.1:1', destination: '192.0.2.2:443', outbound: 'node-a' },
      },
    ],
  });
  const frames = ports.emit.mock.calls.length;
  live.event('connections', { reset: false, events: [{ type: 1, id: 'a', uploadDelta: 10 }] });
  expect(ports.emit.mock.calls).toHaveLength(frames);
  await live.close();
});
