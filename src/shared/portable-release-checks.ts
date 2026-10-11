import type { ConfigDocumentStore } from './config-repository';
import type { GlobalUpdateItem, GlobalUpdateSnapshot } from './global-update';
import { fetchPublisherReleases, type ReleaseRead } from './publisher-release-source';
import { compareSemver } from './version';
import { githubDownloadCandidates } from './gh-proxy';
import { ReleaseCatalogState } from './release-catalog-state';

export interface PortableReleasePorts {
  store: ConfigDocumentStore;
  read: ReleaseRead;
  version(): Promise<{ appVersion: string; singBoxVersion: string }>;
  prepare(options: {
    url: string;
    version: string;
    digest: string;
    candidates: string[];
  }): Promise<{ version: string; verified: boolean }>;
  install(): Promise<{ installationRequested?: boolean; permissionRequired?: boolean }>;
  restored(): Promise<{ version: string; verified: boolean } | null>;
  changed(snapshot: GlobalUpdateSnapshot): void;
}
const DOCUMENT = 'release-checks';
const initial = (): GlobalUpdateSnapshot => ({ checking: false, lastCheckedAt: null, items: [] });
/** Manual release checks do not enqueue subscription sync, latency tests, or connectivity checks. */
export class PortableReleaseChecks {
  private snapshot = initial();
  private initialized?: Promise<void>;
  private pending?: Promise<ReturnType<PortableReleaseChecks['status']>>;
  private closed = false;
  private readonly cancellation = new AbortController();
  private readonly catalogState: ReleaseCatalogState;
  constructor(private readonly ports: PortableReleasePorts) {
    this.catalogState = new ReleaseCatalogState(ports.store);
  }
  private initialize(): Promise<void> {
    return (this.initialized ??= (async () => {
      const content = await this.ports.store.read(DOCUMENT);
      if (!content) return;
      try {
        const saved = JSON.parse(content);
        if (
          saved.schema !== 1 ||
          !Number.isFinite(saved.lastCheckedAt) ||
          !Array.isArray(saved.items)
        )
          return;
        this.snapshot = {
          checking: false,
          lastCheckedAt: saved.lastCheckedAt,
          // Saved text alone never authorizes an installer.
          items: saved.items
            .filter(
              (item: GlobalUpdateItem) =>
                item &&
                ['software', 'core'].includes(item.kind) &&
                ['latest', 'error', 'incompatible'].includes(item.status)
            )
            .map((item: GlobalUpdateItem) => ({
              kind: item.kind,
              status: item.status,
              ...(typeof item.version === 'string' ? { version: item.version } : {}),
              ...(typeof item.error === 'string' ? { error: item.error } : {}),
            })),
        };
      } catch {
        /* Invalid historical results do not authorize an installer. */
      }
      const restored = await this.ports.restored();
      if (restored?.verified === true && /^\d+\.\d+\.\d+$/.test(restored.version)) {
        this.snapshot.items = this.snapshot.items.filter((item) => item.kind !== 'software');
        this.snapshot.items.push({
          kind: 'software',
          status: 'ready',
          version: restored.version,
          restart: 'software',
        });
      }
    })().catch((error) => {
      this.initialized = undefined;
      throw error;
    }));
  }
  status() {
    return {
      globalUpdates: structuredClone(this.snapshot),
      hasUpdate: this.snapshot.items.some(
        (item) => item.status === 'ready' || item.status === 'incompatible'
      ),
    };
  }
  async savedStatus() {
    await this.initialize();
    return this.status();
  }
  check(): Promise<ReturnType<PortableReleaseChecks['status']>> {
    if (this.closed) return Promise.reject(new Error('Release checks are closed'));
    if (this.pending) return this.pending;
    const pending = this.run().finally(() => {
      if (this.pending === pending) this.pending = undefined;
    });
    this.pending = pending;
    return pending;
  }
  private publish() {
    if (!this.closed) {
      try {
        this.ports.changed(structuredClone(this.snapshot));
      } catch {
        /* View failure cannot invalidate saved work. */
      }
    }
  }
  private async run() {
    await this.initialize();
    if (this.closed) throw new Error('Release checks are closed');
    this.snapshot = { ...this.snapshot, checking: true };
    this.publish();
    try {
      const current = await this.ports.version();
      const software = async (): Promise<GlobalUpdateItem> => {
        try {
          const releases = await fetchPublisherReleases(
            'dsanying/VPN',
            (url, accept, signal) => this.read(url, accept, signal),
            this.catalogState
          );
          this.assertOpen();
          const release = releases
            .filter((item) => !item.draft && !item.prerelease)
            .sort((a, b) => compareSemver(b.tag_name, a.tag_name))[0];
          if (!release || compareSemver(release.tag_name, current.appVersion) <= 0)
            return { kind: 'software', status: 'latest', version: current.appVersion };
          const assets = release.assets.filter((asset) => asset.name.endsWith('.apk'));
          if (assets.length !== 1 || !/^sha256:[a-f0-9]{64}$/i.test(assets[0].digest ?? ''))
            throw new Error('No unambiguous verified Android installer');
          const version = release.tag_name.replace(/^v/, ''),
            asset = assets[0];
          const prepared = await this.ports.prepare({
            url: asset.browser_download_url,
            version,
            digest: asset.digest!,
            candidates: githubDownloadCandidates(asset.browser_download_url),
          });
          this.assertOpen();
          if (!prepared.verified || prepared.version !== version)
            throw new Error('Native installer was not verified');
          return { kind: 'software', status: 'ready', version, restart: 'software' };
        } catch {
          return { kind: 'software', status: 'error', error: '软件更新检查或安装包验证失败' };
        }
      };
      const core = async (): Promise<GlobalUpdateItem> => {
        try {
          const releases = await fetchPublisherReleases(
            'SagerNet/sing-box',
            (url, accept, signal) => this.read(url, accept, signal),
            this.catalogState
          );
          this.assertOpen();
          const release = releases
            .filter((item) => !item.draft && !item.prerelease)
            .sort((a, b) => compareSemver(b.tag_name, a.tag_name))[0];
          if (!release) throw new Error('No published engine');
          const version = release.tag_name.replace(/^v/, '');
          return {
            kind: 'core',
            status: compareSemver(version, current.singBoxVersion) > 0 ? 'incompatible' : 'latest',
            version,
          };
        } catch {
          return { kind: 'core', status: 'error', error: '内核更新检查失败' };
        }
      };
      const items = await Promise.all([software(), core()]);
      if (this.closed) throw new Error('Release checks are closed');
      const next: GlobalUpdateSnapshot = { checking: false, lastCheckedAt: Date.now(), items };
      await this.ports.store.write(DOCUMENT, JSON.stringify({ schema: 1, ...next }));
      this.snapshot = next;
      this.publish();
      return this.status();
    } finally {
      if (this.snapshot.checking) {
        this.snapshot = { ...this.snapshot, checking: false };
        this.publish();
      }
    }
  }
  async install(kind: unknown) {
    if (this.closed) throw new Error('Release checks are closed');
    if (
      kind !== 'software' ||
      !this.snapshot.items.some((item) => item.kind === 'software' && item.status === 'ready')
    )
      throw new Error('没有已验证的软件更新');
    const result = await this.ports.install();
    if (result.installationRequested !== true && result.permissionRequired !== true)
      throw new Error('系统安装程序未打开');
    return { success: true, ...result };
  }
  private assertOpen(): void {
    if (this.closed) throw new Error('Release checks are closed');
  }
  private read(url: string, accept: string, signal?: AbortSignal) {
    // The HTML fallback must also stop after cancellation, even if a transport resolves late.
    this.assertOpen();
    return this.ports.read(
      url,
      accept,
      signal ? AbortSignal.any([signal, this.cancellation.signal]) : this.cancellation.signal
    );
  }
  close() {
    this.closed = true;
    this.cancellation.abort();
  }
}
