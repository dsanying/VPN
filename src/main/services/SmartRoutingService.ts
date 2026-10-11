import { normalizeCountryCode } from '../../shared/country';
import { BACKGROUND_REFRESH_MS } from '../../shared/background-refresh';
import type { IpInfo, IpInfoSnapshot, RegionRoutingConfig } from '../../shared/types';

type State = NonNullable<IpInfoSnapshot['smartRouting']>;

/** One runtime country policy; no location is persisted or inferred from a proxy exit. */
export class SmartRoutingService {
  private state: State = { status: 'detecting' };
  private generation = 0;
  private inflight: Promise<void> | null = null;
  private fingerprint: string | null = null;
  private checkedAt = 0;
  private stopNetworkWatch: (() => void) | null = null;
  private started = false;
  private disposed = false;

  constructor(
    private readonly deps: {
      detect: () => Promise<IpInfo | null>;
      ensureRules: (country: string) => Promise<boolean>;
      fingerprint: () => string;
      onPolicy: (policy: RegionRoutingConfig) => void;
      onState: (state: State) => void;
      watchNetwork?: (changed: () => void) => () => void;
    }
  ) {}

  getState(): State {
    return { ...this.state };
  }

  private publish(state: State): void {
    this.state = state;
    this.deps.onPolicy({
      automatic: true,
      enabled: state.status === 'ready',
      region: state.countryCode ?? '',
      reverse: false,
    });
    this.deps.onState(this.getState());
  }

  /** OS changes and the single maintenance scheduler invalidate the cached country. */
  refresh(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const fingerprint = this.deps.fingerprint();
    const changed = fingerprint !== this.fingerprint;
    if (this.inflight && !changed) return this.inflight;
    const ttl = this.state.status === 'ready' ? BACKGROUND_REFRESH_MS : 60_000;
    if (!force && !changed && Date.now() - this.checkedAt < ttl) return Promise.resolve();
    this.fingerprint = fingerprint;
    const generation = ++this.generation;
    // A new network must not keep a previous country's direct policy.
    if (changed || this.state.status !== 'ready') this.publish({ status: 'detecting' });
    const task = (async () => {
      try {
        const info = await Promise.resolve().then(() => this.deps.detect());
        if (generation !== this.generation || this.disposed) return;
        const country = normalizeCountryCode(info?.countryCode);
        if (!country) {
          this.publish({ status: 'unavailable' });
          return;
        }
        if (this.state.countryCode !== country || this.state.status !== 'ready') {
          this.publish({ status: 'preparing', countryCode: country });
        }
        const ready = await this.deps.ensureRules(country);
        if (generation !== this.generation || this.disposed) return;
        this.publish({ countryCode: country, status: ready ? 'ready' : 'unavailable' });
      } catch {
        if (generation === this.generation && !this.disposed)
          this.publish({ status: 'unavailable' });
      } finally {
        if (generation === this.generation) {
          this.checkedAt = Date.now();
          this.inflight = null;
        }
      }
    })();
    this.inflight = task;
    return task;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.publish({ status: 'detecting' });
    this.stopNetworkWatch = this.deps.watchNetwork?.(() => void this.refresh()) ?? null;
    void this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.stopNetworkWatch?.();
    this.stopNetworkWatch = null;
  }
}
