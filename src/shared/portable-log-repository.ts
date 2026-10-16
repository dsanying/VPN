import type { ConfigDocumentStore } from './config-repository';
import type { LogEntry, LogLevel } from './types';
import { redactLogText } from './log-redact';
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
/** Bounded durable client log, shared by UI and maintenance hosts; redact before storage. */
export class PortableLogRepository {
  private tail: Promise<unknown> = Promise.resolve();
  private cached?: LogEntry[];
  constructor(
    private store: ConfigDocumentStore,
    private maximum = 1000
  ) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 10000)
      throw new Error('Invalid log bound');
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation);
    this.tail = task.catch(() => undefined);
    return task;
  }
  private async load(): Promise<LogEntry[]> {
    if (this.cached) return this.cached;
    const content = await this.store.read('logs');
    if (content === null) return (this.cached = []);
    const saved = JSON.parse(content);
    if (saved.schema !== 1 || !Array.isArray(saved.entries)) throw new Error('Invalid stored logs');
    this.cached = this.bound(
      saved.entries
        .filter(
          (entry: LogEntry) =>
            entry &&
            typeof entry.message === 'string' &&
            typeof entry.source === 'string' &&
            levels.includes(entry.level) &&
            Number.isFinite(Date.parse(entry.timestamp))
        )
        .map((entry: LogEntry) => this.sanitize(entry))
    );
    return this.cached!;
  }
  private sanitize(entry: LogEntry): LogEntry {
    if (
      typeof entry.message !== 'string' ||
      typeof entry.source !== 'string' ||
      !levels.includes(entry.level) ||
      !Number.isFinite(Date.parse(entry.timestamp))
    )
      throw new Error('Invalid log entry');
    return {
      timestamp: entry.timestamp,
      level: entry.level,
      message: redactLogText(entry.message).slice(0, 8192),
      source: redactLogText(entry.source).slice(0, 128),
      ...(typeof entry.traceId === 'string' && /^[a-f0-9]{32}$/.test(entry.traceId)
        ? { traceId: entry.traceId }
        : {}),
      ...(typeof entry.operation === 'string'
        ? { operation: redactLogText(entry.operation).slice(0, 128) }
        : {}),
      ...(['start', 'progress', 'success', 'failure'].includes(entry.phase ?? '')
        ? { phase: entry.phase }
        : {}),
      ...(Number.isFinite(entry.durationMs) && entry.durationMs! >= 0
        ? { durationMs: entry.durationMs }
        : {}),
      ...(typeof entry.sessionId === 'string' ? { sessionId: entry.sessionId.slice(0, 128) } : {}),
      ...(Number.isSafeInteger(entry.sequence) && entry.sequence! >= 0
        ? { sequence: entry.sequence }
        : {}),
      ...(typeof entry.id === 'string' ? { id: entry.id.slice(0, 128) } : {}),
      ...(typeof entry.stack === 'string'
        ? { stack: redactLogText(entry.stack).slice(0, 8192) }
        : {}),
    };
  }
  private bound(entries: LogEntry[]): LogEntry[] {
    let size = 0;
    const kept: LogEntry[] = [];
    for (const entry of entries.slice(-this.maximum).reverse()) {
      const bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1;
      if (size + bytes > MAX_DOCUMENT_BYTES) break;
      size += bytes;
      kept.push(entry);
    }
    return kept.reverse();
  }
  read(): Promise<LogEntry[]> {
    return this.enqueue(async () => structuredClone(await this.load()));
  }
  append(entries: LogEntry[]): Promise<LogEntry[]> {
    return this.enqueue(async () => {
      const sanitized = entries.map((entry) => this.sanitize(entry));
      const next = this.bound([...(await this.load()), ...sanitized]);
      await this.store.write('logs', JSON.stringify({ schema: 1, entries: next }));
      this.cached = next;
      return structuredClone(sanitized);
    });
  }
  clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.store.write('logs', JSON.stringify({ schema: 1, entries: [] }));
      this.cached = [];
    });
  }
}
