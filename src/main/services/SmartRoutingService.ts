import { normalizeCountryCode } from '../../shared/country';
import { observationIsFresh } from '../../shared/background-refresh';
import type { IpInfo, IpInfoSnapshot, RegionRoutingConfig } from '../../shared/types';

type State = NonNullable<IpInfoSnapshot['smartRouting']>;

/** One runtime country policy; no location is persisted or inferred from a proxy exit. */
export class SmartRoutingService {
  private state: State = { status: 'detecting' };
  private policy: RegionRoutingConfig | null = null;
  /** 最近一次 ready 观测时的网络指纹：同网探测失败时凭它保留策略（换网即失效）。 */
  private readyFingerprint: string | null = null;
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
    const next: RegionRoutingConfig = {
      automatic: true,
      enabled: state.status === 'ready',
      region: state.countryCode ?? '',
      reverse: false,
    };
    // 同网探测失败不拆路由（瞬态上游故障零重启）：上次 ready 策略仍是对当前网络的真实观测，
    // 探测不可用只降级 UI 状态。换网（指纹对不上）或从未 ready 过才随策略下线——
    // 「新网络不得沿用旧国家的直连策略」的安全语义不变。曾实测缺陷：上游 DNS 抖动 6 分钟内
    // 探测失败把 enabled true→false 再翻回 true，两次整核重启掀掉全部 TCP（RDP 会话被杀）。
    const retainReady =
      !next.enabled &&
      this.policy?.enabled === true &&
      this.readyFingerprint !== null &&
      this.readyFingerprint === this.fingerprint;
    const effective = retainReady ? this.policy! : next;
    if (state.status === 'ready') this.readyFingerprint = this.fingerprint;
    this.policy = effective;
    this.deps.onPolicy(effective);
    this.deps.onState(this.getState());
  }

  /** OS changes and the single maintenance scheduler invalidate the cached country. */
  refresh(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const fingerprint = this.deps.fingerprint();
    const changed = fingerprint !== this.fingerprint;
    if (this.inflight && !changed) return this.inflight;
    if (!force && !changed && observationIsFresh(this.checkedAt)) return Promise.resolve();
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
