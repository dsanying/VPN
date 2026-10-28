import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LogManager } from '../LogManager';
import type { LogEntry } from '../../../shared/types';

describe('Log folding keeps disk evidence complete while the UI tail shows key info', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadowvpn-log-fold-'));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('folds same-key repeats into one entry with a count; disk keeps every occurrence', async () => {
    const manager = new LogManager(directory);
    const emitted: LogEntry[] = [];
    manager.on('log', (log) => emitted.push(log));
    // 目录命中的常量事件（dns-race POISONED，生产中每污染响应一条）
    const message = 'dns-race: 上游返回 decoy 答案，判 POISONED 丢弃（first-clean-wins）';
    manager.addLog('warn', message, 'ProxyManager');
    manager.addLog('warn', message, 'ProxyManager');
    manager.addLog('warn', message, 'ProxyManager');
    await manager.flush();
    const tail = manager.getLogs();
    expect(tail).toHaveLength(1);
    expect(tail[0].repeatCount).toBe(3);
    // 实时流三次都发出（渲染端按 id 就地更新），同一 id
    expect(emitted).toHaveLength(3);
    expect(new Set(emitted.map((log) => log.id)).size).toBe(1);
    // 磁盘逐条落盘，证据不减
    const records = (await fs.readFile(path.join(directory, 'app.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s));
    expect(records).toHaveLength(3);
  });

  it('merges the sing-box dns/router pair of one failed lookup into a single key-info entry', async () => {
    const manager = new LogManager(directory);
    // 生产中的归因包裹文本（查询 id 每次不同，外观前缀不同）
    const dnsLine =
      'DNS 解析失败：无法解析服务器域名，请检查 DNS 设置 [[4243907428 1.50s] dns: lookup failed for firefoxusercontent.com: SERVFAIL]';
    const routerLine =
      'DNS 解析失败：无法解析服务器域名，请检查 DNS 设置 [[4243907428 1.50s] router: lookup firefoxusercontent.com: SERVFAIL]';
    manager.addLog('error', dnsLine, 'sing-box');
    manager.addLog('error', routerLine, 'sing-box');
    await manager.flush();
    const tail = manager.getLogs();
    expect(tail).toHaveLength(1);
    expect(tail[0].repeatCount).toBe(2);
    // 代表条目取最近一次出现（router 行），id 保持首个的稳定身份供渲染端就地更新
    expect(tail[0].message).toBe(routerLine);
    // 不同域名不互折
    const otherDomain =
      'DNS 解析失败：无法解析服务器域名，请检查 DNS 设置 [[991 1.00s] dns: lookup failed for example.com: SERVFAIL]';
    manager.addLog('error', otherDomain, 'sing-box');
    expect(manager.getLogs()).toHaveLength(2);
  });

  it('starts a fresh entry after the fold window slides past the last occurrence', async () => {
    jest.spyOn(Date, 'now');
    let now = 1_000_000;
    (Date.now as jest.Mock).mockImplementation(() => now);
    const manager = new LogManager(directory);
    manager.addLog('warn', 'same key', 'Example');
    now += 1_000; // 窗口内 → 合并
    manager.addLog('warn', 'same key', 'Example');
    expect(manager.getLogs()).toHaveLength(1);
    expect(manager.getLogs()[0].repeatCount).toBe(2);
    now += 10 * 60_000; // 远超窗口 → 新条目
    manager.addLog('warn', 'same key', 'Example');
    const tail = manager.getLogs();
    expect(tail).toHaveLength(2);
    expect(tail[0].repeatCount).toBe(2);
    expect(tail[1].repeatCount).toBeUndefined();
  });

  it('does not fold different levels or sources', () => {
    const manager = new LogManager(directory);
    manager.addLog('warn', 'same key', 'A');
    manager.addLog('error', 'same key', 'A');
    manager.addLog('warn', 'same key', 'B');
    const same = manager.getLogs().filter((log) => log.message === 'same key');
    expect(same).toHaveLength(3);
    expect(same.every((log) => log.repeatCount === undefined)).toBe(true);
  });

  it('clear resets the fold index', async () => {
    const manager = new LogManager(directory);
    manager.addLog('warn', 'same key', 'Example');
    const cleared = manager.clearLogs();
    manager.addLog('warn', 'same key', 'Example');
    await cleared;
    expect(manager.getLogs().map((log) => log.repeatCount ?? 1)).toEqual([1]);
  });
});
