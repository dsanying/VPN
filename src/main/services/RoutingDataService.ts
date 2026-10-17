import { observationIsFresh, BACKGROUND_REFRESH_MS } from '../../shared/background-refresh';
/** Background routing data only: no catalog, manual CRUD, application-service presets or renderer IPC. */
import { net, type Session } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { getUserDataPath } from '../utils/paths';
import { APP_USER_AGENT } from '../../shared/constants';
import { normalizeCountryCode } from '../../shared/country';
import { routingDataNeeds } from '../../shared/routing-data-needs';
import {
  applyGhProxy,
  ghMirrorUrl,
  isGithubHost,
  normalizeGhProxyPrefix,
} from '../../shared/gh-proxy';
import type { UserConfig } from '../../shared/types';
import { writeFileAtomic } from '../utils/atomic-write';
import {
  findBuiltin,
  getRuleSetRuntimeDir,
  isValidSrsFile,
  seedBuiltinRuleSets,
} from './builtin-geo-rulesets';
import { BackoffTracker } from './backoff-tracker';
import type { ConfigManager } from './ConfigManager';
import type { UpdateNetwork } from './UpdateNetwork';

const IDLE_TIMEOUT_MS = 15_000;
const OVERALL_TIMEOUT_MS = 120_000;
const MAX_SIZE = 64 * 1024 * 1024;
type FetchResult =
  { ok: true; buf: Buffer } | { ok: false; errorCode: string; statusCode?: number };
type DataFile = { tag: string; sourceUrl: string; dest: string };

export class RoutingDataService {
  private running = false;
  private failures = new Set<string>();
  private prepared = new Map<string, Buffer>();
  private retiredFilesRemoved = false;
  private inflight = new Map<string, Promise<boolean>>();
  private backoff = new BackoffTracker(10 * 60_000, BACKGROUND_REFRESH_MS);

  constructor(
    private readonly deps: {
      configManager: ConfigManager;
      isProxyRunning?: () => boolean;
      updateNetwork: UpdateNetwork;
      region: () => UserConfig['regionRouting'];
      onMissingRestored: (config: UserConfig) => void;
      log: (level: 'info' | 'warn', message: string) => void;
    }
  ) {}

  private async updateSession(): Promise<Session | undefined> {
    return this.deps.updateNetwork.resolveSessionForMainUpdate().catch(() => undefined);
  }

  /** Stale cache remains usable when offline; invalid data never replaces the last good file. */
  private ensureFile(file: DataFile, prefix?: string, force = false): Promise<boolean> {
    const existing = this.inflight.get(file.dest);
    if (existing) return existing;
    const task = (async () => {
      const valid = isValidSrsFile(file.dest);
      if (valid) {
        const stat = await fs.stat(file.dest).catch(() => null);
        // NTFS mtimes may land slightly ahead of Date.now(); a future-dated file
        // can only prove freshness, never staleness, so clamp it to the wall clock.
        if (!force && stat && observationIsFresh(Math.min(Math.floor(stat.mtimeMs), Date.now())))
          return true;
      }
      if (!this.backoff.isEligible(file.dest, Date.now())) {
        this.failures.add(file.dest);
        return valid;
      }
      try {
        let result = await this.fetchBuffer(applyGhProxy(prefix, file.sourceUrl));
        if (!result.ok && prefix) result = await this.fetchBuffer(file.sourceUrl);
        if (!result.ok && isGithubHost(file.sourceUrl))
          result = await this.fetchBuffer(ghMirrorUrl(file.sourceUrl));
        if (!result.ok) throw new Error(result.errorCode);
        if (result.buf.length < 3 || result.buf.subarray(0, 3).toString() !== 'SRS')
          throw new Error('invalid_content');
        this.failures.delete(file.dest);
        const previous = await fs.readFile(file.dest).catch(() => null);
        if (previous?.equals(result.buf)) {
          await fs.utimes(file.dest, new Date(), new Date());
          this.prepared.delete(file.dest);
          this.backoff.recordSuccess(file.dest);
          return true;
        }
        if (this.deps.isProxyRunning?.()) {
          this.prepared.set(file.dest, result.buf);
          this.backoff.recordSuccess(file.dest);
          return valid;
        }
        await fs.mkdir(path.dirname(file.dest), { recursive: true });
        await writeFileAtomic(file.dest, result.buf);
        this.backoff.recordSuccess(file.dest);
        return true;
      } catch (error) {
        this.failures.add(file.dest);
        this.backoff.recordFailure(file.dest, Date.now());
        // Never log custom URLs or node credentials.
        this.deps.log(
          'warn',
          `Routing data ${file.tag}: ${error instanceof Error ? error.message : 'network'}`
        );
        return isValidSrsFile(file.dest);
      }
    })();
    this.inflight.set(file.dest, task);
    void task
      .finally(() => {
        this.inflight.delete(file.dest);
      })
      .catch(() => {});
    return task;
  }

  async ensureCountryRuleSet(country: string): Promise<boolean> {
    const code = normalizeCountryCode(country);
    if (!code) return false;
    return this.ensureFile({
      tag: `geoip-${code}`,
      sourceUrl: `https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-${code}.srs`,
      dest: path.join(getRuleSetRuntimeDir(), `geoip-${code}.srs`),
    });
  }

  /** Prepare and refresh only the active country and LAN data. */
  async refreshRequired(force = false): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (force) this.failures.clear();
    try {
      const stored = await this.deps.configManager.loadConfig();
      const region = this.deps.region();
      const config = region ? { ...stored, regionRouting: region } : stored;
      const { tags } = routingDataNeeds(config);
      if (!this.retiredFilesRemoved) {
        await fs.rm(path.join(getUserDataPath(), 'rule-resources'), {
          recursive: true,
          force: true,
        });
        const retainedFiles = new Set([
          'geosite-private.srs',
          'geosite-cn.srs',
          'geosite-geolocation-!cn.srs',
        ]);
        const runtimeDir = getRuleSetRuntimeDir();
        for (const name of await fs.readdir(runtimeDir).catch(() => [])) {
          if (
            name.endsWith('.srs') &&
            !retainedFiles.has(name) &&
            !/^geoip-[a-z]{2}\.srs$/.test(name)
          )
            await fs.rm(path.join(runtimeDir, name), { force: true });
        }
        this.retiredFilesRemoved = true;
      }
      await seedBuiltinRuleSets({ tags });
      const files = new Map<string, DataFile>();
      const runtimeDir = getRuleSetRuntimeDir();
      for (const tag of tags) {
        const builtin = findBuiltin(tag);
        if (builtin)
          files.set(tag, {
            tag,
            sourceUrl: builtin.sourceUrl,
            dest: path.join(runtimeDir, builtin.fileName),
          });
        else {
          const code = tag.startsWith('geoip-') ? normalizeCountryCode(tag.slice(6)) : null;
          if (code)
            files.set(tag, {
              tag,
              sourceUrl: `https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-${code}.srs`,
              dest: path.join(runtimeDir, `geoip-${code}.srs`),
            });
        }
      }
      const queue = [...files.values()];
      let restored = false;
      const prefix = config.ghProxyPrefix
        ? (normalizeGhProxyPrefix(config.ghProxyPrefix) ?? undefined)
        : undefined;
      // Bounded parallelism, with one shared in-flight promise per file.
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          for (let file = queue.shift(); file; file = queue.shift()) {
            const missing = !isValidSrsFile(file.dest);
            if (await this.ensureFile(file, prefix, force)) restored ||= missing;
          }
        })
      );
      if (restored) this.deps.onMissingRestored(await this.deps.configManager.loadConfig());
      if (force && this.failures.size)
        throw new Error('Routing data update failed; cached data retained');
    } catch (error) {
      this.deps.log('warn', 'Routing data maintenance failed');
      if (force) throw error;
    } finally {
      this.running = false;
    }
  }

  hasPreparedUpdates(): boolean {
    return this.prepared.size > 0;
  }

  preparedRevision(): string {
    const hash = createHash('sha256');
    for (const [dest, data] of [...this.prepared].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      hash.update(path.basename(dest));
      hash.update(data);
    }
    return hash.digest('hex');
  }

  async applyPrepared(): Promise<void> {
    if (this.deps.isProxyRunning?.())
      throw new Error('Proxy must be stopped before routing data changes');
    for (const [dest, buf] of this.prepared) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await writeFileAtomic(dest, buf);
      this.prepared.delete(dest);
    }
  }

  private async fetchBuffer(
    url: string,
    onChunk?: (received: number, total: number | null) => void
  ): Promise<FetchResult> {
    const sess = await this.updateSession();
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: FetchResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(overall);
        clearTimeout(idle);
        resolve(v);
      };
      let received = 0;
      let total: number | null = null;
      const chunks: Buffer[] = [];
      const req = net.request({ url, redirect: 'follow', session: sess });
      req.setHeader('User-Agent', APP_USER_AGENT);

      let encoded = false; // 响应被压缩（content-encoding）→ data 为解压字节，content-length 是压缩长度，跳过比对
      let idle: NodeJS.Timeout;
      const resetIdle = () => {
        clearTimeout(idle);
        idle = setTimeout(() => {
          req.abort();
          done({ ok: false, errorCode: 'timeout' });
        }, IDLE_TIMEOUT_MS);
      };
      const overall = setTimeout(() => {
        req.abort();
        done({ ok: false, errorCode: 'timeout' });
      }, OVERALL_TIMEOUT_MS);
      resetIdle(); // 响应头到达前也看门狗，避免连接挂起需等满整体超时

      req.on('response', (res) => {
        const status = res.statusCode || 0;
        if (status >= 400) {
          req.abort();
          done({ ok: false, errorCode: 'http', statusCode: status });
          return;
        }
        const ce = res.headers['content-encoding'];
        const ceStr = (Array.isArray(ce) ? ce[0] : ce) || '';
        encoded = ceStr !== '' && ceStr.toLowerCase() !== 'identity';
        const cl = res.headers['content-length'];
        const clStr = Array.isArray(cl) ? cl[0] : cl;
        total = clStr ? parseInt(clStr, 10) : null;
        resetIdle();
        res.on('data', (c: Buffer) => {
          received += c.length;
          if (received > MAX_SIZE) {
            req.abort();
            done({ ok: false, errorCode: 'too_large' });
            return;
          }
          chunks.push(c);
          onChunk?.(received, total);
          resetIdle();
        });
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // 压缩响应下 content-length 是压缩长度，与解压字节数必不等 → 跳过比对（魔数+end 完整兜底）
          if (!encoded && total != null && buf.length !== total) {
            done({ ok: false, errorCode: 'size_mismatch' });
            return;
          }
          done({ ok: true, buf });
        });
        res.on('error', () => done({ ok: false, errorCode: 'network' }));
      });
      req.on('error', () => done({ ok: false, errorCode: 'network' }));
      req.end();
    });
  }
}
