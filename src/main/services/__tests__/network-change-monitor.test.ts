import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { NetworkChangeMonitor } from '../NetworkChangeMonitor';

function fixture(platform: NodeJS.Platform = 'darwin') {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
  const launch = jest.fn().mockReturnValue(child);
  const changed = jest.fn(),
    failed = jest.fn();
  const monitor = new NetworkChangeMonitor(
    changed,
    failed,
    '/owned/network-events',
    platform,
    launch
  );
  return { child, launch, changed, failed, monitor };
}

it('streams partial native markers, ignores readiness and closes without reporting an error', () => {
  const f = fixture();
  f.monitor.start();
  f.monitor.start();
  expect(f.launch).toHaveBeenCalledTimes(1);
  expect(f.launch.mock.calls[0][0]).toBe('/owned/network-events');
  f.child.stdout.write('NETWORK_READY\nNETWORK_CH');
  expect(f.changed).not.toHaveBeenCalled();
  f.child.stdout.write('ANGED\r\n');
  expect(f.changed).toHaveBeenCalledTimes(1);
  f.monitor.dispose();
  f.child.emit('exit', 0);
  f.child.stdout.write('NETWORK_CHANGED\n');
  expect(f.changed).toHaveBeenCalledTimes(1);
  expect(f.failed).not.toHaveBeenCalled();
});

it('reports a process failure once and restarts only when explicitly requested', () => {
  const f = fixture();
  f.monitor.start();
  f.child.emit('error', new Error('failed'));
  f.child.emit('exit', 1);
  expect(f.failed).toHaveBeenCalledTimes(1);
  expect(f.launch).toHaveBeenCalledTimes(1);
  f.monitor.start();
  expect(f.launch).toHaveBeenCalledTimes(2);
  f.monitor.dispose();
});

it('bounds a corrupt stream and handles a broken stdin without an uncaught error', () => {
  const f = fixture();
  f.monitor.start();
  f.child.stdout.write('x'.repeat(65537));
  expect(f.failed).toHaveBeenCalledTimes(1);
  expect(f.child.kill).toHaveBeenCalled();
  const g = fixture();
  g.monitor.start();
  g.child.stdin.emit('error', new Error('EPIPE'));
  expect(g.failed).toHaveBeenCalledTimes(1);
  g.monitor.dispose();
});

it('uses a blocking OS notification API on Windows, with no WMI polling or execution-policy override', () => {
  const f = fixture('win32');
  f.monitor.start();
  const args = f.launch.mock.calls[0][1].join(' ');
  expect(args).toContain('NetworkChange.NetworkAddressChanged');
  expect(args).toContain('[Console]::ReadLine()');
  expect(args).not.toMatch(/ExecutionPolicy|Get-Cim|Start-Sleep|setInterval/);
  f.child.stdout.write('NETWORK_CHANGED\n');
  expect(f.changed).toHaveBeenCalledTimes(1);
  f.monitor.dispose();
});
