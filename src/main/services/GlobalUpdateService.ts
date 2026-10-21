import { BACKGROUND_REFRESH_MS } from '../../shared/background-refresh';
import { MaintenanceCycle } from '../../shared/maintenance-cycle';
import type { ConfigDocumentStore } from '../../shared/config-repository';
import type {
  GlobalUpdateItem,
  GlobalUpdateSnapshot,
  UpdateKind,
} from '../../shared/global-update';

/** One maintenance clock with explicit version and maintenance scopes. Never restarts an active proxy. */
export class GlobalUpdateService {
  private snapshot: GlobalUpdateSnapshot = { checking: false, lastCheckedAt: null, items: [] };
  private flight: Promise<GlobalUpdateSnapshot> | null = null;
  private versionFlight: Promise<GlobalUpdateSnapshot> | null = null;
  private artifactFlight: Promise<void> | null = null;
  private startup: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private started = false;
  private readonly maintenance: MaintenanceCycle;
  private applying = false;
  constructor(
    private readonly deps: {
      store: ConfigDocumentStore;
      maintenanceError(error: unknown): void;
      prepare: Record<UpdateKind, () => Promise<GlobalUpdateItem>>;
      apply: (kind: UpdateKind) => Promise<void | UpdateKind[]>;
      refreshMeasurements?: () => Promise<void>;
      publish: (snapshot: GlobalUpdateSnapshot) => void;
    }
  ) {
    this.maintenance = new MaintenanceCycle(deps.store);
  }
  getSnapshot(): GlobalUpdateSnapshot {
    return { ...this.snapshot, items: this.snapshot.items.map((item) => ({ ...item })) };
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    const tick = async () => {
      let next = Date.now() + BACKGROUND_REFRESH_MS;
      try {
        next = await this.maintenance.runDue(
          () => this.check(),
          () => generation === this.generation
        );
      } catch (error) {
        try {
          this.deps.maintenanceError(error);
        } catch {
          /* A detached reporting subscriber must not disable the maintenance clock. */
        }
      } finally {
        if (generation === this.generation) {
          this.timer = setTimeout(
            () => {
              void tick();
            },
            Math.max(1, next - Date.now())
          );
          this.timer.unref?.();
        }
      }
    };
    this.startup = setTimeout(() => {
      this.startup = null;
      void tick();
    }, 30_000);
    this.startup.unref?.();
  }
  stop(): void {
    this.started = false;
    ++this.generation;
    if (this.startup) clearTimeout(this.startup);
    if (this.timer) clearTimeout(this.timer);
    this.startup = null;
    this.timer = null;
  }
  private publish(): void {
    this.deps.publish(this.getSnapshot());
  }
  private async prepare(kind: UpdateKind): Promise<void> {
    let item: GlobalUpdateItem;
    try {
      item = await this.deps.prepare[kind]();
    } catch (error) {
      const previous = this.snapshot.items.find(
        (entry) => entry.kind === kind && entry.status === 'ready'
      );
      item = {
        ...(previous ?? { kind, status: 'error' as const }),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.snapshot.items = [...this.snapshot.items.filter((entry) => entry.kind !== kind), item];
    this.publish();
  }
  private artifacts(task: () => Promise<void>): Promise<void> {
    const work = this.artifactFlight ? this.artifactFlight.then(task) : task();
    const flight = work.finally(() => {
      if (this.artifactFlight === flight) this.artifactFlight = null;
    });
    this.artifactFlight = flight;
    return flight;
  }
  /** The settings action checks only software and core versions. */
  checkVersions(): Promise<GlobalUpdateSnapshot> {
    if (this.versionFlight) return this.versionFlight;
    if (this.applying) return Promise.resolve(this.getSnapshot());
    this.snapshot.checking = true;
    this.publish();
    this.versionFlight = this.artifacts(async () => {
      await this.prepare('software');
      await this.prepare('core');
    })
      .finally(() => {
        this.versionFlight = null;
        this.snapshot.lastCheckedAt = Date.now();
        this.snapshot.checking = !!this.flight;
        this.publish();
      })
      .then(() => this.getSnapshot());
    return this.versionFlight;
  }
  /** Startup and six-hour maintenance include data, subscriptions and measurements. */
  check(): Promise<GlobalUpdateSnapshot> {
    if (this.flight) return this.flight;
    if (this.applying) return Promise.resolve(this.getSnapshot());
    this.snapshot.checking = true;
    this.publish();
    this.flight = (async () => {
      await Promise.all([
        (async () => {
          await this.checkVersions();
          await this.artifacts(() => this.prepare('data'));
        })(),
        this.prepare('subscriptions'),
      ]);
      await this.deps.refreshMeasurements?.();
      this.snapshot.lastCheckedAt = Date.now();
    })()
      .finally(() => {
        this.flight = null;
        this.snapshot.checking = !!this.versionFlight;
        this.publish();
      })
      .then(() => this.getSnapshot());
    return this.flight;
  }
  markApplied(kinds: UpdateKind[]): void {
    this.snapshot.items = this.snapshot.items.map((item) =>
      kinds.includes(item.kind) && item.status === 'ready'
        ? { kind: item.kind, status: 'applied', version: item.version }
        : item
    );
    this.publish();
  }
  async apply(kind: UpdateKind): Promise<GlobalUpdateSnapshot> {
    if (this.applying) throw new Error('Update preparation is busy');
    // 已预备的更新独立于在途检查：等待检查结束而非拒绝，避免「待重启」按钮在慢速检查期间不可点或点击报错。
    while (this.flight || this.versionFlight) {
      try {
        await (this.flight ?? this.versionFlight);
      } catch {
        /* A failed check must not block applying an already-prepared update. */
      }
    }
    if (!this.snapshot.items.some((item) => item.kind === kind && item.status === 'ready'))
      throw new Error('No prepared update');
    this.applying = true;
    try {
      const appliedKinds = (await this.deps.apply(kind)) ?? [kind];
      this.markApplied(appliedKinds);
    } finally {
      this.applying = false;
      this.publish();
    }
    return this.getSnapshot();
  }
}
