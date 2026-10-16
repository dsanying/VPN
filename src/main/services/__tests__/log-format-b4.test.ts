import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowvpn-logformat-'));
const appendCalls: string[] = [];
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  appendFile: jest.fn((_p: string, data: string) => {
    appendCalls.push(data);
    return Promise.resolve();
  }),
  unlink: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  rename: jest.fn().mockResolvedValue(undefined),
}));
import { LogManager } from '../LogManager';

describe('Structured application log persistence', () => {
  let manager: LogManager;
  beforeEach(() => {
    appendCalls.length = 0;
    manager = new LogManager(TMP);
  });
  afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
  it('retains complete source, machine event and session identity', async () => {
    manager.addLog('error', 'Application started', 'A'.repeat(80));
    await manager.flush();
    const record = JSON.parse(appendCalls[0]);
    expect(record).toMatchObject({
      schema: 1,
      source: 'A'.repeat(80),
      sequence: 1,
      message: 'Application started',
      level: 'error',
    });
    expect(record.eventId).toMatch(/^log\./);
    expect(record.id).toBe(`${record.sessionId}:1`);
    expect(record.pid).toBe(process.pid);
    expect(Date.parse(record.timestamp)).not.toBeNaN();
  });
  it('escapes multiline messages and stacks into one parseable record, without truncation', async () => {
    const message = 'first\n[2026-01-01] [INFO] forged';
    const stack = 'Error: example\n  at example.ts:12:4';
    manager.addLog('fatal', message, '', stack);
    await manager.flush();
    expect(appendCalls[0].split('\n')).toHaveLength(2);
    expect(JSON.parse(appendCalls[0])).toMatchObject({ message, stack, source: '' });
  });
  it('preserves order and levels, including consecutive duplicate errors', async () => {
    manager.setLogLevel('debug');
    for (const level of ['debug', 'info', 'warn', 'error', 'fatal'] as const)
      manager.addLog(level, 'example', 'Source');
    manager.addLog('fatal', 'example', 'Source');
    await manager.flush();
    expect(appendCalls.map((line) => JSON.parse(line).level)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
      'fatal',
    ]);
    expect(appendCalls.map((line) => JSON.parse(line).sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('display filters preserve durable sequence and protect credentials before every sink', async () => {
    manager.addLog('debug', 'filtered', 'Example');
    manager.addLog(
      'error',
      'https://example.com/subscribe?token=fake-secret',
      'Example',
      'Authorization: Bearer fake-authorization'
    );
    await manager.flush();
    expect(manager.getLogs()).toHaveLength(1);
    expect(manager.getLogs()[0].sequence).toBe(2);
    expect(appendCalls.map((line) => JSON.parse(line).sequence)).toEqual([1, 2]);
    expect(JSON.parse(appendCalls[0]).message).toBe('filtered');
    expect(JSON.stringify(manager.getLogs())).not.toMatch(/fake-secret|fake-authorization/);
    expect(appendCalls[0]).not.toMatch(/fake-secret|fake-authorization/);
  });
});
