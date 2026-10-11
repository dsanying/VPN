import type { ConfigRepository } from './config-repository';
import type { UserConfig } from './types';
import {
  changedMeasurementScope,
  portableMeasurementSnapshot,
  type MeasurementRefreshScope,
} from './measurement-refresh-scope';

export interface PortableRefreshPorts {
  sync(id: string): Promise<unknown>;
  connectivity(id: string): Promise<unknown>;
  measure(ids: string[]): Promise<unknown>;
  applySaved(): Promise<unknown>;
  cleanup(): Promise<unknown>;
  error(operation: string, error: unknown): void;
}
interface PendingScope {
  all: boolean;
  groups: Set<string>;
  sync: Set<string>;
  nodes: Set<string>;
  subscriptions: Set<string>;
  apply: boolean;
}
const emptyScope = (): PendingScope => ({
  all: false,
  groups: new Set(),
  sync: new Set(),
  nodes: new Set(),
  subscriptions: new Set(),
  apply: false,
});
/** Config dependency scheduling, independent of screens and of the host's periodic wake-up mechanism. */
export class PortableRefreshCoordinator {
  private pending = emptyScope();
  private draining?: Promise<void>;
  private syncing = new Set<string>();
  private closed = false;
  constructor(
    private config: ConfigRepository,
    private ports: PortableRefreshPorts
  ) {}

  /** Queue after durable save. Never await a drain from inside a subscription commit callback. */
  saved(previous: UserConfig, next: UserConfig): void {
    this.request(
      changedMeasurementScope(
        portableMeasurementSnapshot(previous),
        portableMeasurementSnapshot(next)
      ),
      true
    );
  }
  subscriptionCommitted(id: string, restartRequired: boolean): void {
    if (this.closed) return;
    if (this.syncing.has(id)) {
      // The active batch reads membership after syncing and already includes this group.
      this.pending.apply ||= restartRequired;
      return;
    }
    this.request({ groupIds: [id], subscriptionIds: [id] }, restartRequired);
  }
  request(scope: MeasurementRefreshScope, apply = false): void {
    if (this.closed) return;
    this.pending.all ||= !!scope.all;
    this.pending.apply ||= apply;
    for (const id of scope.groupIds ?? []) this.pending.groups.add(id);
    for (const id of scope.syncGroupIds ?? []) this.pending.sync.add(id);
    for (const id of scope.nodeIds ?? []) this.pending.nodes.add(id);
    for (const id of scope.subscriptionIds ?? []) this.pending.subscriptions.add(id);
    if (!this.draining) {
      this.draining = Promise.resolve()
        .then(() => this.drain())
        .catch((error) => {
          try {
            this.ports.error('refresh', error);
          } catch {
            /* Host reporting is isolated. */
          }
        })
        .finally(() => {
          this.draining = undefined;
        });
    }
  }
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }
  private hasPending(): boolean {
    const p = this.pending;
    return (
      p.all || p.apply || !!(p.groups.size + p.sync.size + p.nodes.size + p.subscriptions.size)
    );
  }
  private async safely(operation: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      try {
        this.ports.error(operation, error);
      } catch {
        /* Reporting cannot block other work. */
      }
    }
  }
  private async drain(): Promise<void> {
    while (!this.closed && this.hasPending()) {
      const scope = this.pending;
      this.pending = emptyScope();
      const before = await this.config.read();
      const groups = new Set((before.subscriptions ?? []).map((group) => group.id));
      const syncIds = scope.all ? [...groups] : [...scope.sync].filter((id) => groups.has(id));
      // Bounded serial pulls avoid provider bursts; each successful pull precedes its group's probes.
      for (const id of syncIds) {
        if (this.closed) return;
        this.syncing.add(id);
        scope.groups.add(id);
        scope.subscriptions.add(id);
        await this.safely(`subscription:${id}`, () => this.ports.sync(id));
        this.syncing.delete(id);
      }
      if (this.closed) return;
      const saved = await this.config.read();
      const validGroups = new Set((saved.subscriptions ?? []).map((group) => group.id));
      const nodes = saved.servers
        .filter(
          (node) =>
            scope.all ||
            scope.nodes.has(node.id) ||
            (!!node.subscriptionId && scope.groups.has(node.subscriptionId))
        )
        .map((node) => node.id);
      const links = scope.all
        ? [...validGroups]
        : [...scope.subscriptions].filter((id) => validGroups.has(id));
      await this.safely('cleanup', () => this.ports.cleanup());
      if (scope.apply || this.pending.apply) {
        this.pending.apply = false;
        await this.safely('apply', () => this.ports.applySaved());
      }
      // Link checks and independent exact-node probes may overlap; each probe implementation is bounded.
      await Promise.all([
        this.safely('measure', () =>
          nodes.length ? this.ports.measure(nodes) : Promise.resolve()
        ),
        (async () => {
          for (const id of links) {
            if (this.closed) return;
            await this.safely(`connectivity:${id}`, () => this.ports.connectivity(id));
          }
        })(),
      ]);
    }
  }
  close(): void {
    this.closed = true;
    this.pending = emptyScope();
  }
}
