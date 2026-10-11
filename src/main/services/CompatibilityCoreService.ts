import { spawn, execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { createServer, connect } from 'net';
import { randomBytes, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ServerConfig, LogLevel } from '../../shared/types';
import {
  compatibilityEngine,
  type CoreBridge,
  type CompatibilityEngine,
} from '../../shared/core-capabilities';
import { redactLogText } from '../../shared/log-redact';
import manifest from '../../shared/compatibility-core-manifest.json';
import primaryManifest from '../../shared/core-manifest.json';
import { buildSingBoxCompatibilityConfig } from './singbox-compatibility-config';
import { buildMihomoConfig, buildXrayConfig, type BridgeNode } from './compatibility-config';

const run = promisify(execFile);
function safeCoreError(error: unknown, servers: ServerConfig[]): string {
  let text = error instanceof Error ? error.message : String(error);
  const scrub = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(id|pass|password|uuid|encryption|secret|token|auth|auth-str|auth_str|psk|private[-_]?key|protocol-param|obfs-param)$/i.test(
          key
        ) &&
        typeof item === 'string' &&
        item.length >= 4
      )
        text = text.split(item).join('<redacted>');
      else if (typeof item === 'object') scrub(item);
    }
  };
  servers.forEach(scrub);
  return redactLogText(text);
}
export async function allocateCompatibilityPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const port = (listener.address() as { port: number }).port;
      listener.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export class CompatibilityCoreService {
  readonly bridges = new Map<string, CoreBridge>();
  readonly dialPorts = new Map<string, number>();
  readonly failures = new Map<string, string>();
  private processes: ChildProcess[] = [];
  private generation = 0;
  private pendingStop: Promise<void> = Promise.resolve();
  constructor(
    private getPath: (engine: CompatibilityEngine) => string,
    private log: (level: LogLevel, message: string, source: string) => void,
    private getSingBoxPath?: () => string
  ) {}

  stop(): void {
    this.generation++;
    this.bridges.clear();
    this.dialPorts.clear();
    const previousStop = this.pendingStop;
    const processes = this.processes.splice(0);
    this.pendingStop = Promise.all([
      previousStop,
      Promise.all(
        processes.map(
          (process) =>
            new Promise<void>((resolve) => {
              if (process.exitCode !== null || process.signalCode !== null) return resolve();
              const timer = setTimeout(() => {
                process.kill('SIGKILL');
                resolve();
              }, 2000);
              timer.unref();
              process.once('close', () => {
                clearTimeout(timer);
                resolve();
              });
              process.kill('SIGTERM');
            })
        )
      ),
    ]).then(() => undefined);
  }
  async close(): Promise<void> {
    this.stop();
    await this.pendingStop;
  }

  async prepare(
    servers: ServerConfig[],
    directPort: number,
    chooseEngine: (
      server: ServerConfig
    ) => CompatibilityEngine | 'sing-box' | undefined = compatibilityEngine
  ): Promise<void> {
    this.stop();
    const generation = this.generation;
    await this.pendingStop;
    if (generation !== this.generation) throw new Error('Compatibility core startup superseded');
    this.failures.clear();
    for (const engine of ['xray', 'mihomo', 'sing-box'] as const) {
      const candidates = servers.filter((server) => chooseEngine(server) === engine);
      if (!candidates.length) continue;
      if (!directPort) throw new Error('Compatibility core requires a direct dial inbound');
      const dir = await mkdtemp(join(tmpdir(), 'shadowvpn-compat-'));
      const file = join(dir, 'config.json');
      let owned = false;
      let ownedProcess: ChildProcess | undefined;
      try {
        const binary = engine === 'sing-box' ? this.getSingBoxPath?.() : this.getPath(engine);
        if (!binary) throw new Error('Compatibility core binary is not configured');
        const platform =
          process.platform === 'darwin'
            ? process.arch === 'arm64'
              ? 'mac-arm64'
              : 'mac-x64'
            : process.platform === 'win32'
              ? 'win'
              : 'linux';
        const spec =
          engine === 'sing-box'
            ? { binarySha256: primaryManifest.coreBinarySha256[platform] }
            : manifest[engine].assets[platform];
        if (!spec.binarySha256) throw new Error(`${engine} binary integrity pin missing`);
        if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== spec.binarySha256)
          throw new Error(`${engine} binary integrity check failed`);
        const nodes: BridgeNode[] = [];
        for (const server of candidates) {
          try {
            const seen = new Set([server.id]);
            let detour = server.detour;
            while (detour) {
              if (seen.has(detour)) throw new Error('Compatibility proxy chain cycle');
              seen.add(detour);
              const target = servers.find((item) => item.id === detour);
              if (!target) throw new Error('Compatibility proxy chain target missing');
              detour = target.detour;
            }
            nodes.push({
              server,
              ...(server.detour ? { dialPort: await allocateCompatibilityPort() } : {}),
              bridge: {
                port: await allocateCompatibilityPort(),
                username: 'shadowvpn',
                password: randomBytes(24).toString('hex'),
              },
            });
          } catch (error) {
            this.failures.set(server.id, safeCoreError(error, candidates));
          }
        }
        if (!nodes.length) continue;
        const build =
          engine === 'xray'
            ? buildXrayConfig
            : engine === 'sing-box'
              ? buildSingBoxCompatibilityConfig
              : buildMihomoConfig;
        const args =
          engine === 'xray'
            ? ['run', '-test', '-config', file]
            : engine === 'sing-box'
              ? ['check', '-c', file]
              : ['-t', '-d', dir, '-f', file];
        const check = async (batch: BridgeNode[]) => {
          await writeFile(file, JSON.stringify(build(batch, directPort)), { mode: 0o600 });
          await run(binary, args, { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 });
        };
        let valid = nodes;
        try {
          await check(nodes);
        } catch {
          valid = [];
          // Isolate malformed nodes, preserving all other nodes and their complete fields.
          for (const node of nodes) {
            try {
              await check([node]);
              valid.push(node);
            } catch (error) {
              this.failures.set(node.server.id, safeCoreError(error, candidates));
            }
          }
          if (!valid.length) continue;
          await check(valid);
        }
        if (generation !== this.generation)
          throw new Error('Compatibility core startup superseded');
        const child = spawn(
          binary,
          engine === 'xray'
            ? ['run', '-config', file]
            : engine === 'sing-box'
              ? ['run', '-c', file]
              : ['-d', dir, '-f', file],
          { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
        );
        ownedProcess = child;
        this.processes.push(child);
        owned = true;
        let output = '';
        let failed = '';
        const collect = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-8000);
        };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        child.once('error', (error) => {
          failed = error.message;
        });
        child.once('close', () => {
          for (const node of valid)
            if (this.bridges.get(node.server.id) === node.bridge) {
              this.bridges.delete(node.server.id);
              this.dialPorts.delete(node.server.id);
            }
          void rm(dir, { recursive: true, force: true }).catch(() => undefined);
          if (generation === this.generation)
            this.log(
              'error',
              safeCoreError(output || `${engine} process exited`, candidates),
              engine
            );
        });
        const deadline = Date.now() + 8000;
        while (true) {
          if (generation !== this.generation)
            throw new Error('Compatibility core startup superseded');
          if (failed || child.exitCode !== null || child.signalCode !== null)
            throw new Error(failed || output || `${engine} startup failed`);
          if (
            await Promise.all(
              valid.map(
                (node) =>
                  new Promise<boolean>((resolve) => {
                    const socket = connect(node.bridge.port, '127.0.0.1');
                    const finish = (ok: boolean) => {
                      socket.destroy();
                      resolve(ok);
                    };
                    socket.setTimeout(100);
                    socket.once('connect', () => finish(true));
                    socket.once('error', () => finish(false));
                    socket.once('timeout', () => finish(false));
                  })
              )
            ).then((results) => results.every(Boolean))
          )
            break;
          if (Date.now() > deadline) throw new Error(`${engine} listeners not ready`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        valid.forEach((node) => {
          this.bridges.set(node.server.id, node.bridge);
          if (node.dialPort) this.dialPorts.set(node.server.id, node.dialPort);
        });
        this.log(
          'info',
          `Compatibility core ready: ${engine} ${engine === 'sing-box' ? primaryManifest.bundledCoreVersion : manifest[engine].version}, nodes=${valid.length}`,
          'CompatibilityCore'
        );
      } catch (error) {
        ownedProcess?.kill('SIGTERM');
        for (const server of candidates)
          this.failures.set(server.id, safeCoreError(error, candidates));
        if (generation !== this.generation) throw error;
      } finally {
        if (!owned) await rm(dir, { recursive: true, force: true });
      }
    }
  }
}
