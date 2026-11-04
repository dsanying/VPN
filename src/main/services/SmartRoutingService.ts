import { normalizeCountryCode } from '../../shared/country';
import { observationIsFresh } from '../../shared/background-refresh';
import type { IpInfo, IpInfoSnapshot, RegionRoutingConfig } from '../../shared/types';

type State = NonNullable<IpInfoSnapshot['smartRouting']>;

/** One runtime country policy; no location is persisted or inferred from a proxy exit. */
export class SmartRoutingService {
  private state: State = { status: 'detecting' };
  private policy: RegionRoutingConfig | null = null;
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
    // 探测不可观测（失败/进行中）一律保留在跑策略，换网判定交给「成功的观测」而非网络指纹：
    // 暗唤醒/Wi-Fi 重连会让 en0 地址瞬失（指纹瞬变），上游故障又让探测拿不到结果；若按指纹下线，
    // 故障期拆策略 → 整核重启、恢复后翻回 → 二次重启，两次掀掉全部 TCP（2026-11-04 实测，RDP 被杀）。
    // 保留的代价：真实换网且探测始终拿不到结果时，旧国家的直连规则暂留——但直连规则只影响对应国家
    // IP 走不走代理，私有段恒直连，无泄漏面；观测成功（含不同国家）即正常切换或翻回。
    const effective = !next.enabled && this.policy?.enabled === true ? this.policy : next;
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
