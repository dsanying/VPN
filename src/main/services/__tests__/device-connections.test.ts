import {
  DeviceConnectionsService,
  parseLsofConnections,
  parseProcessPaths,
  parseSsConnections,
  parseWindowsConnections,
} from '../DeviceConnectionsService';

it('parses established IPv4/IPv6 and connected UDP without inventing domains, bytes or rules', () => {
  const paths = parseProcessPaths(' 42 /Applications/Example App.app/Contents/MacOS/Example\n');
  const data =
    'p42\0cExample App\0\nf7\0PTCP\0n192.0.2.1:2000->198.51.100.2:443\0TST=ESTABLISHED\0\nf8\0PTCP\0n[2001:db8::1]:2001->[2001:db8::2]:443\0TST=ESTABLISHED\0\nf9\0PUDP\0n192.0.2.1:2002->198.51.100.3:443\0\nf10\0PTCP\0n*:80\0TST=LISTEN\0\nf11\0PUDP\0n192.0.2.1:2003\0';
  const entries = parseLsofConnections(data, paths);
  expect(entries).toHaveLength(3);
  expect(entries[0].metadata).toMatchObject({
    processId: 42,
    processPath: paths.get(42),
    destinationIP: '198.51.100.2',
    destinationPort: '443',
  });
  expect(entries[1].metadata?.destinationIP).toBe('2001:db8::2');
  expect(entries[2].metadata?.network).toBe('udp');
  for (const entry of entries) {
    expect(entry.metadata?.host).toBeUndefined();
    expect(entry.download).toBeUndefined();
    expect(entry.rule).toBe('');
    expect(entry.outbound).toBe('system-network');
  }
});
it('keeps all visible connections, rejects malformed addresses and non-established sockets', () => {
  const entries = parseLsofConnections(
    'p7\0' +
      Array.from(
        { length: 140 },
        (_, i) => `f${i}\0PTCP\0n192.0.2.1:${2000 + i}->198.51.100.2:443\0TST=ESTABLISHED\0\n`
      ).join('') +
      'f999\0PTCP\0ninvalid:12->example.com:443\0TST=ESTABLISHED\0',
    new Map()
  );
  expect(entries).toHaveLength(140);
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(140);
});
it('parses Linux and Windows visible connections with honest missing process identity', () => {
  const linux = parseSsConnections(
    'tcp ESTAB 0 0 192.0.2.1:2000 198.51.100.2:443 users:(("Example",pid=42,fd=3))\nudp UNCONN 0 0 0.0.0.0:5353 0.0.0.0:*\ntcp ESTAB 0 0 [::1]:1000 [::1]:2000'
  );
  expect(linux).toHaveLength(2);
  expect(linux[0].metadata?.processId).toBe(42);
  expect(linux[1].metadata?.processId).toBeUndefined();
  const windows = parseWindowsConnections(
    JSON.stringify([
      {
        LocalAddress: '2001:db8::1',
        LocalPort: 1000,
        RemoteAddress: '2001:db8::2',
        RemotePort: 443,
        OwningProcess: 42,
        ProcessPath: 'C:\\Example\\Example.exe',
      },
    ])
  );
  expect(windows[0].metadata).toMatchObject({
    destinationIP: '2001:db8::2',
    processPath: 'C:\\Example\\Example.exe',
  });
  expect(() => parseWindowsConnections('{}')).toThrow('Invalid system connection list');
});
describe('passive collection lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('reads only with demand, polls, and reports failure as unavailable', async () => {
    const update = jest.fn();
    const read = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('permission denied'));
    const service = new DeviceConnectionsService(update, read);
    expect(read).not.toHaveBeenCalled();
    service.setEnabled(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ connections: [], source: 'device' })
    );
    await jest.advanceTimersByTimeAsync(3000);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ unavailable: true, source: 'device' })
    );
    service.setEnabled(false);
    await jest.advanceTimersByTimeAsync(9000);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('disabling rejects in-flight results; restarting never overlaps native commands', async () => {
    const update = jest.fn();
    let resolve!: (entries: []) => void;
    const read = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      )
      .mockResolvedValue([]);
    const service = new DeviceConnectionsService(update, read);
    service.setEnabled(true);
    await jest.advanceTimersByTimeAsync(0);
    service.setEnabled(false);
    service.setEnabled(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    resolve([]);
    await jest.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
    service.setEnabled(false);
  });
});

it('retains the lsof process name when the process path snapshot misses its PID', () => {
  const [entry] = parseLsofConnections(
    'p42\0cExample Helper\0f7\0PTCP\0n192.0.2.1:2000->198.51.100.2:443\0TST=ESTABLISHED\0',
    new Map()
  );
  expect(entry.metadata).toMatchObject({ processId: 42, processName: 'Example Helper' });
  expect(entry.metadata?.processPath).toBeUndefined();
});
