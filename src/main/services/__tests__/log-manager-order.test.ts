import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LogManager } from '../LogManager';
import { presentLog } from '../../../shared/log-presentation';

describe('Log storage ordering and diagnostics', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadowvpn-log-order-'));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('clear is an ordered barrier; later records survive while earlier records do not reappear', async () => {
    const manager = new LogManager(directory);
    manager.addLog('info', 'before clear', 'Example');
    const cleared = manager.clearLogs();
    manager.addLog('error', 'after clear', 'Example');
    await cleared;
    await manager.flush();
    const records = (await fs.readFile(path.join(directory, 'app.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s));
    expect(records.map((r) => r.message)).toEqual(['after clear']);
    expect(manager.getLogs().map((r) => r.message)).toEqual(['after clear']);
  });
  it('persists template arguments and localizes without losing the original', async () => {
    const manager = new LogManager(directory);
    manager.addLog('info', '测速完成：成功 2/3', 'SpeedTest');
    await manager.flush();
    const event = manager.getLogs()[0];
    expect(event.eventArgs).toEqual(['2', '3']);
    expect(presentLog(event, 'en-US').message).toContain('2/3');
    expect(event.message).toBe('测速完成：成功 2/3');
  });
  it('rotation preserves parseable complete records across files', async () => {
    const manager = new LogManager(directory);
    Object.assign(manager, { maxLogFileSize: 1 });
    manager.addLog('info', 'first', 'Example');
    await manager.flush();
    manager.addLog('error', 'second', 'Example');
    await manager.flush();
    expect(
      JSON.parse((await fs.readFile(path.join(directory, 'app.1.log'), 'utf8')).trim()).message
    ).toBe('first');
    expect(
      JSON.parse((await fs.readFile(path.join(directory, 'app.log'), 'utf8')).trim()).message
    ).toBe('second');
  });
  it('records disk errors and recovers after storage becomes available', async () => {
    const manager = new LogManager(directory);
    await manager.flush();
    await fs.rm(directory, { recursive: true });
    await fs.writeFile(directory, 'blocked');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      manager.addLog('error', 'write rejected', 'Example');
      await manager.flush();
      expect(manager.getDiagnostics().writeErrors).toBeGreaterThan(0);
      await fs.unlink(directory);
      await fs.mkdir(directory);
      manager.addLog('error', 'recovered', 'Example');
      await manager.flush();
      expect(await fs.readFile(path.join(directory, 'app.log'), 'utf8')).toContain('recovered');
    } finally {
      consoleError.mockRestore();
    }
  });
});
