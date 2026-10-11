import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { LogEntry, LogLevel } from '../../shared/types';
import { identifyLogMessage } from '../../shared/log-presentation';
import { redactLogText } from '../../shared/log-redact';
import { getLogsPath } from '../utils/paths';

export interface ILogManager {
  addLog(level: LogLevel, message: string, source: string, stack?: string): void;
  getLogs(limit?: number): LogEntry[];
  clearLogs(): void | Promise<void>;
  setLogLevel(level: LogLevel): void;
  getLogLevel(): LogLevel;
  on(event: 'log', listener: (log: LogEntry) => void): void;
  off(event: 'log', listener: (log: LogEntry) => void): void;
}

/** Bounded in-memory tail and ordered JSONL persistence. All sink losses are observable. */
export class LogManager extends EventEmitter implements ILogManager {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private logFilePath: string;
  private currentLogLevel: LogLevel = 'info';
  private logLevelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  };
  private maxLogFileSize = 10 * 1024 * 1024;
  private maxLogFiles = 5;
  private initPromise: Promise<void>;
  private pendingWrites = new Set<Promise<void>>();
  private writeTail: Promise<void> = Promise.resolve();
  private static readonly MAX_PENDING_WRITES = 200;
  private static readonly CRITICAL_WRITE_RESERVE = 200;
  private droppedDueToBackpressure = 0;
  private criticalDropped = 0;
  private writeErrors = 0;
  private memoryEvicted = 0;
  private uiDropped = 0;
  private sequence = 0;
  private readonly sessionId = randomUUID();
  private readonly sessionStartedAt = new Date().toISOString();
  private lastWriteError?: string;

  constructor(logDir?: string) {
    super();
    this.logFilePath = path.join(logDir || getLogsPath(), 'app.log');
    this.initPromise = this.ensureLogDirectory();
  }

  private async ensureLogDirectory(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
    } catch (error) {
      this.recordWriteError(error);
    }
  }

  setLogLevel(level: LogLevel): void {
    this.currentLogLevel = level;
  }
  getLogLevel(): LogLevel {
    return this.currentLogLevel;
  }

  addLog(level: LogLevel, message: string, source: string, stack?: string): void {
    if (this.logLevelPriority[level] < this.logLevelPriority[this.currentLogLevel]) return;
    const safeMessage = redactLogText(message);
    const sequence = ++this.sequence;
    const event = identifyLogMessage(safeMessage);
    const entry: LogEntry = {
      id: `${this.sessionId}:${sequence}`,
      sessionId: this.sessionId,
      sequence,
      timestamp: new Date().toISOString(),
      level,
      message: safeMessage,
      source: redactLogText(source),
      stack: stack ? redactLogText(stack) : undefined,
      ...(event ? { eventId: event.eventId, eventArgs: event.args } : {}),
    };
    // Critical storms are bounded too. A reserve preserves errors during normal-level bursts.
    const critical = level === 'error' || level === 'fatal';
    const capacity =
      LogManager.MAX_PENDING_WRITES + (critical ? LogManager.CRITICAL_WRITE_RESERVE : 0);
    if (this.pendingWrites.size < capacity) {
      const write = this.enqueue(async () => {
        await this.writeToFile(entry);
      })
        .catch((error) => this.recordWriteError(error))
        .finally(() => this.pendingWrites.delete(write));
      this.pendingWrites.add(write);
    } else {
      this.droppedDueToBackpressure++;
      if (critical) this.criticalDropped++;
    }
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
      this.memoryEvicted++;
    }
    this.emit('log', entry);
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeTail.then(operation);
    // A failed write must not poison all subsequent writes.
    this.writeTail = next.catch(() => undefined);
    return next;
  }
  private recordWriteError(error: unknown): void {
    this.writeErrors++;
    this.lastWriteError = redactLogText(error instanceof Error ? error.message : String(error));
    console.error('Log persistence failed:', this.lastWriteError);
  }
  async flush(): Promise<void> {
    await this.writeTail;
  }
  getDroppedDueToBackpressure(): number {
    return this.droppedDueToBackpressure;
  }
  recordUiDrop(count: number): void {
    this.uiDropped += count;
  }
  getDiagnostics() {
    return {
      format: 'jsonl-v1',
      sessionId: this.sessionId,
      sessionStartedAt: this.sessionStartedAt,
      accepted: this.sequence,
      retained: this.logs.length,
      memoryCapacity: this.maxLogs,
      memoryEvicted: this.memoryEvicted,
      pendingWrites: this.pendingWrites.size,
      droppedWrites: this.droppedDueToBackpressure,
      criticalDropped: this.criticalDropped,
      uiDropped: this.uiDropped,
      writeErrors: this.writeErrors,
      lastWriteError: this.lastWriteError,
      level: this.currentLogLevel,
      rotationBytes: this.maxLogFileSize,
      rotatedFiles: this.maxLogFiles,
    };
  }
  getLogs(limit?: number): LogEntry[] {
    return limit && limit > 0 ? this.logs.slice(-limit) : [...this.logs];
  }

  async clearLogs(): Promise<void> {
    this.logs = [];
    await this.enqueue(async () => {
      await this.initPromise;
      await fs.writeFile(this.logFilePath, '', 'utf-8');
      for (let i = 1; i <= this.maxLogFiles; i++)
        await this.ignoreMissing(() => fs.unlink(this.rotatedPath(i)));
    });
  }
  private rotatedPath(index: number): string {
    return this.logFilePath.replace(/\.log$/, `.${index}.log`);
  }
  private async ignoreMissing(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  private async writeToFile(entry: LogEntry): Promise<void> {
    await this.initPromise;
    await this.rotateLogIfNeeded();
    // JSON escaping preserves multi-line stacks without creating forged records; never truncate source or message.
    await fs.appendFile(
      this.logFilePath,
      JSON.stringify({ schema: 1, pid: process.pid, ...entry }) + '\n',
      'utf-8'
    );
  }
  private async rotateLogIfNeeded(): Promise<void> {
    let size = 0;
    await this.ignoreMissing(async () => {
      size = (await fs.stat(this.logFilePath)).size;
    });
    if (size < this.maxLogFileSize) return;
    await this.ignoreMissing(() => fs.unlink(this.rotatedPath(this.maxLogFiles)));
    for (let i = this.maxLogFiles - 1; i >= 1; i--)
      await this.ignoreMissing(() => fs.rename(this.rotatedPath(i), this.rotatedPath(i + 1)));
    await this.ignoreMissing(() => fs.rename(this.logFilePath, this.rotatedPath(1)));
  }
}
