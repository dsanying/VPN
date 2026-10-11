import { IPC_CHANNELS as C, STATS_TOPIC_EVENT, type StatsTopic } from './ipc-channels';
import { aggregateConnections, aggregateSignature } from './connections-aggregate';
import { PortableLiveConnections, type NativeConnectionBatch } from './portable-live-connections';
import type { InstalledApplication, TrafficStats } from './types';
export interface PortableLivePorts {
  subscribe(topics: Array<'logs' | 'stats' | 'connections'>): Promise<void>;
  emit(channel: string, value: unknown): void;
  running(): boolean;
  applications(): Promise<InstalledApplication[]>;
}
/** Native subscriptions are reference counted; event batches trigger frames, never a status timer. */
export class PortableLiveStreams {
  private counts = new Map<StatsTopic, number>();
  private owners = new Map<string, Map<StatsTopic, number>>();
  private tail: Promise<unknown> = Promise.resolve();
  private connections = new PortableLiveConnections();
  private applications: InstalledApplication[] = [];
  private catalogue?: Promise<void>;
  private aggregateKey?: string;
  private stats?: TrafficStats;
  private closed = false;
  constructor(private ports: PortableLivePorts) {}
  async subscription(topic: unknown, enabled: boolean, owner = 'default'): Promise<void> {
    if (this.closed) throw new Error('Streams are closed');
    if (topic !== 'stats' && topic !== 'aggregate' && topic !== 'detail')
      throw new Error('Invalid stream topic');
    const owned = this.owners.get(owner) ?? new Map<StatsTopic, number>();
    const previous = owned.get(topic) ?? 0;
    const next = Math.max(0, previous + (enabled ? 1 : -1));
    owned.set(topic, next);
    this.owners.set(owner, owned);
    this.counts.set(topic, (this.counts.get(topic) ?? 0) + next - previous);
    await this.updateSubscriptions();
    if (enabled && !this.closed) {
      if (topic === 'stats') {
        if (this.stats) this.ports.emit(STATS_TOPIC_EVENT.stats, this.stats);
      } else {
        this.frame(true);
        this.catalogue ??= this.ports
          .applications()
          .then((applications) => {
            this.applications = applications;
            if (!this.closed) this.frame(true);
          })
          .catch(() => {
            this.catalogue = undefined;
          });
      }
    }
  }
  async releaseOwner(owner: string): Promise<void> {
    const owned = this.owners.get(owner);
    if (!owned || this.closed) return;
    this.owners.delete(owner);
    for (const [topic, count] of owned)
      this.counts.set(topic, (this.counts.get(topic) ?? 0) - count);
    await this.updateSubscriptions();
  }
  private async updateSubscriptions(): Promise<void> {
    const topics: Array<'logs' | 'stats' | 'connections'> = ['logs'];
    if (this.counts.get('stats')) topics.push('stats');
    if (this.counts.get('aggregate') || this.counts.get('detail')) topics.push('connections');
    const operation = this.tail.then(() => this.ports.subscribe(topics));
    this.tail = operation.catch(() => undefined);
    await operation;
  }
  event(topic: string, data: unknown): void {
    if (this.closed) return;
    if (
      topic === 'connections' &&
      data &&
      typeof data === 'object' &&
      Array.isArray((data as NativeConnectionBatch).events)
    ) {
      this.connections.apply(data as NativeConnectionBatch);
      this.frame();
    } else if (topic === 'stats' && data && typeof data === 'object') {
      const value = data as {
        trafficAvailable: boolean;
        uploadSpeed: number;
        downloadSpeed: number;
        uploadTotal: number;
        downloadTotal: number;
        connectionCount: number;
      };
      if (
        !value.trafficAvailable ||
        ![
          value.uploadSpeed,
          value.downloadSpeed,
          value.uploadTotal,
          value.downloadTotal,
          value.connectionCount,
        ].every((number) => Number.isFinite(number) && number >= 0)
      )
        return;
      this.stats = {
        source: 'proxy',
        sampledAt: Date.now(),
        uploadSpeed: value.uploadSpeed,
        downloadSpeed: value.downloadSpeed,
        totalUpload: value.uploadTotal,
        totalDownload: value.downloadTotal,
        activeConnections: value.connectionCount,
      };
      if (this.counts.get('stats')) this.ports.emit(C.EVENT_STATS_UPDATED, this.stats);
    }
  }
  stateChanged(): void {
    if (!this.ports.running()) {
      this.connections.apply({ reset: true, events: [] });
      this.stats = undefined;
    }
    this.frame(true);
  }
  private frame(force = false): void {
    if (this.closed || (!this.counts.get('detail') && !this.counts.get('aggregate'))) return;
    const snapshot = this.connections.snapshot(this.applications, this.ports.running());
    if (this.counts.get('detail')) this.ports.emit(C.EVENT_CONNECTIONS_DETAIL, snapshot);
    if (this.counts.get('aggregate')) {
      const aggregate = {
        ...aggregateConnections(snapshot.connections, snapshot.at),
        source: 'proxy' as const,
        applications: this.applications,
      };
      const key = aggregateSignature(aggregate);
      if (force || key !== this.aggregateKey) {
        this.aggregateKey = key;
        this.ports.emit(C.EVENT_CONNECTIONS_AGGREGATE, aggregate);
      }
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.counts.clear();
    this.owners.clear();
    await this.tail;
    await this.ports.subscribe([]);
  }
}
