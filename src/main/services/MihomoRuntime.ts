import { spawn, execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { mkdir, writeFile, rename, rm } from 'fs/promises';
import { join } from 'path';
import { createServer } from 'net';
import { StringDecoder } from 'string_decoder';
import { MihomoApiClient } from './MihomoApiClient';
import { probeMihomoReadiness } from './mihomo-readiness';
import { redactLogText } from '../../shared/log-redact';

const run = promisify(execFile);

/** Owns one main core. No system proxy, route or helper side effects are hidden here. */
export class MihomoRuntime {
  private child: ChildProcess | null = null;
  private api: MihomoApiClient | null = null;
  private generation = 0;
  private transition: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly binary: string,
    private readonly directory: string,
    private readonly log: (message: string) => void = () => {},
    private readonly exited: (code: number | null) => void = () => {}
  ) {}

  get client(): MihomoApiClient | null {
    return this.api;
  }
  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(config: Record<string, unknown>, port: number, secret: string): Promise<void> {
    if (
      !secret ||
      config.secret !== secret ||
      config['external-controller'] !== `127.0.0.1:${port}`
    )
      return Promise.reject(new Error('Controller identity does not match runtime'));
    const generation = ++this.generation;
    const operation = this.transition
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) throw new Error('Core startup superseded');
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = join(this.directory, 'mihomo.json');
        const scratch = `${file}.${generation}.new`;
        await writeFile(scratch, JSON.stringify(config), { mode: 0o600 });
        try {
          await run(this.binary, ['-t', '-d', this.directory, '-f', scratch], {
            timeout: 15000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          });
        } catch {
          await rm(scratch, { force: true });
          throw new Error('Mihomo configuration validation failed');
        }
        try {
          if (generation !== this.generation) throw new Error('Core startup superseded');
          await this.stopOwned();
          await assertControllerAvailable(port);
          await rename(scratch, file);
        } finally {
          await rm(scratch, { force: true });
        }
        const secrets = sensitiveValues(config);
        const sanitize = (value: string) => {
          let text = value;
          for (const secretValue of secrets) text = text.split(secretValue).join('<redacted>');
          return redactLogText(text);
        };
        const child = spawn(this.binary, ['-d', this.directory, '-f', file], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        this.child = child;
        let spawnError: Error | undefined;
        child.once('error', (error) => {
          spawnError = error;
        });
        // Streams can split UTF-8 and credentials across chunks. Redact complete lines only.
        for (const stream of [child.stdout, child.stderr]) {
          const decoder = new StringDecoder('utf8');
          let pending = '';
          stream?.on('data', (data: Buffer) => {
            pending += decoder.write(data);
            let newline: number;
            while ((newline = pending.indexOf('\n')) >= 0) {
              this.log(sanitize(pending.slice(0, newline + 1)));
              pending = pending.slice(newline + 1);
            }
            // A malformed unbounded line is discarded rather than partially exposing a secret.
            if (pending.length > 1024 * 1024) pending = '';
          });
          stream?.on('end', () => {
            pending += decoder.end();
            if (pending) this.log(sanitize(pending));
          });
        }
        child.once('exit', (code) => {
          if (this.child !== child) return;
          this.child = null;
          this.api?.stop();
          this.api = null;
          if (generation === this.generation) this.exited(code);
        });
        const api = new MihomoApiClient(port, secret);
        try {
          const deadline = Date.now() + 12000;
          for (;;) {
            if (generation !== this.generation) throw new Error('Core startup superseded');
            if (spawnError || child.exitCode !== null || child.signalCode !== null)
              throw new Error('Mihomo exited before readiness');
            try {
              await probeMihomoReadiness(api, config, 250);
              break;
            } catch {
              if (Date.now() >= deadline) throw new Error('Mihomo controller did not become ready');
              await new Promise((done) => setTimeout(done, 50));
            }
          }
          if (generation !== this.generation) throw new Error('Core startup superseded');
          this.api = api;
          api.start();
        } catch (error) {
          api.stop();
          await this.stopOwned();
          throw error;
        }
      });
    this.transition = operation;
    return operation;
  }

  stop(): Promise<void> {
    this.generation++;
    this.api?.stop();
    const operation = this.transition.catch(() => {}).then(() => this.stopOwned());
    this.transition = operation;
    return operation;
  }
  private async stopOwned(): Promise<void> {
    this.api?.stop();
    this.api = null;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('close', () => {
        clearTimeout(timer);
        done();
      });
      child.kill('SIGTERM');
    });
  }
}

async function assertControllerAvailable(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid controller port');
  await new Promise<void>((done, fail) => {
    const listener = createServer();
    listener.once('error', () => fail(new Error('Controller port is already in use')));
    listener.listen(port, '127.0.0.1', () =>
      listener.close((error) => (error ? fail(error) : done()))
    );
  });
}

function sensitiveValues(config: unknown): string[] {
  const values = new Set<string>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (
        /password|secret|uuid|private.?key|auth.?key|token|psk|encryption|protocol-param|obfs-param/i.test(
          key
        ) &&
        typeof item === 'string' &&
        item.length >= 4
      )
        values.add(item);
      else if (typeof item === 'object') walk(item);
    }
  };
  walk(config);
  return [...values].sort((a, b) => b.length - a.length);
}
