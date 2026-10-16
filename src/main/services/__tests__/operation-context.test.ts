import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { traceOperation, currentOperation } from '../OperationContext';
import { LogManager } from '../LogManager';
import { collectLogArchive } from '../DiagnosticArchive';

test('concurrent work keeps distinct traces, nested evidence and failure stacks', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-operations-'));
  const logs = new LogManager(directory);
  try {
    const record = (
      context: Parameters<Parameters<typeof traceOperation>[1]>[0],
      error?: unknown
    ) =>
      logs.addLog(
        context.phase === 'failure' ? 'error' : 'info',
        context.operation,
        'Operation',
        error instanceof Error ? error.stack : undefined,
        context
      );
    await Promise.allSettled([
      traceOperation('proxy:start', record, async () => {
        await new Promise((r) => setTimeout(r, 15));
        logs.addLog('info', 'inner-first', 'Engine');
        return true;
      }),
      traceOperation('enterprise:save', record, async () => {
        logs.addLog('info', 'inner-second', 'Engine');
        throw new Error('password=fixture-secret');
      }),
    ]);
    await logs.flush();
    const entries = logs.getLogs();
    const first = entries.filter((e) => e.operation === 'proxy:start');
    const second = entries.filter((e) => e.operation === 'enterprise:save');
    expect(new Set(first.map((e) => e.traceId)).size).toBe(1);
    expect(new Set(second.map((e) => e.traceId)).size).toBe(1);
    expect(first[0].traceId).not.toBe(second[0].traceId);
    expect(first.at(-1)).toMatchObject({ phase: 'success', durationMs: expect.any(Number) });
    expect(second.at(-1)).toMatchObject({ phase: 'failure', stack: expect.any(String) });
    expect(currentOperation()).toBeUndefined();
    expect(await fs.readFile(path.join(directory, 'app.log'), 'utf8')).not.toContain(
      'fixture-secret'
    );
  } finally {
    await logs.flush();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('diagnostic archive identifies truncation and missing sources; preserves parseable sanitized history', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-archive-'));
  try {
    await fs.writeFile(path.join(directory, 'app.2.log'), '{"message":"previous failure"}\n');
    await fs.writeFile(
      path.join(directory, 'app.log'),
      Array.from(
        { length: 10000 },
        () => '{"message":"password=fixture-secret","phase":"failure"}\n'
      ).join('') + '{"incomplete":'
    );
    const archive = await collectLogArchive(directory);
    expect(archive.find((f) => f.name === 'app.1.log')?.status).toBe('missing');
    expect(archive.find((f) => f.name === 'app.2.log')?.content).toContain('previous failure');
    const active = archive.find((f) => f.name === 'app.log')!;
    expect(active).toMatchObject({ truncated: true, incompleteTail: true });
    expect(active.capturedBytes).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.stringify(archive)).not.toContain('fixture-secret');
    for (const line of active.content!.trim().split('\n'))
      expect(() => JSON.parse(line)).not.toThrow();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('display threshold never discards durable debug evidence', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-display-'));
  const logs = new LogManager(directory);
  try {
    logs.setLogLevel('error');
    logs.addLog('debug', 'diagnostic detail', 'Example');
    expect(logs.getLogs()).toEqual([]);
    await logs.flush();
    expect(await fs.readFile(path.join(directory, 'app.log'), 'utf8')).toContain(
      'diagnostic detail'
    );
  } finally {
    await logs.flush();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('diagnostic subscriber failure cannot change the business outcome', async () => {
  await expect(
    traceOperation(
      'example:save',
      () => {
        throw new Error('observer failed');
      },
      async () => 'committed'
    )
  ).resolves.toBe('committed');
});
