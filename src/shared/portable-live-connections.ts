import type { ConnectionEntry, InstalledApplication, ConnectionsSnapshot } from './types';
interface NativeConnection {
  source: string;
  destination: string;
  domain?: string;
  network?: string;
  protocol?: string;
  outbound?: string;
  rule?: string;
  createdAt?: number;
  uploadTotal?: number;
  downloadTotal?: number;
  packages?: string[];
  uid?: number;
}
export interface NativeConnectionBatch {
  reset: boolean;
  events: Array<{
    type: number;
    id: string;
    uploadDelta?: number;
    downloadDelta?: number;
    connection?: NativeConnection;
  }>;
}
function socket(value: string): { address: string; port?: string } {
  const ipv6 = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6) return { address: ipv6[1], port: ipv6[2] };
  const ipv4 = value.match(/^([^:]+):(\d+)$/);
  return ipv4 ? { address: ipv4[1], port: ipv4[2] } : { address: value };
}
/** Keeps only active connections. Missing ownership and exit information stay unknown. */
export class PortableLiveConnections {
  private entries = new Map<string, ConnectionEntry>();
  private limited = false;
  constructor(private maximum = 20000) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error('Invalid connection bound');
  }
  apply(batch: NativeConnectionBatch): void {
    if (batch.reset) {
      this.entries.clear();
      this.limited = false;
    }
    for (const event of batch.events) {
      if (!event || typeof event.id !== 'string' || !event.id) continue;
      if (event.type === 2) {
        this.entries.delete(event.id);
        continue;
      }
      if (event.type === 1) {
        const previous = this.entries.get(event.id);
        if (previous) {
          if (Number.isFinite(event.uploadDelta) && event.uploadDelta! >= 0)
            previous.upload = (previous.upload ?? 0) + event.uploadDelta!;
          if (Number.isFinite(event.downloadDelta) && event.downloadDelta! >= 0)
            previous.download = (previous.download ?? 0) + event.downloadDelta!;
        }
        continue;
      }
      const value = event.connection;
      if (
        event.type !== 0 ||
        !value ||
        typeof value.source !== 'string' ||
        typeof value.destination !== 'string'
      )
        continue;
      if (!this.entries.has(event.id) && this.entries.size >= this.maximum) {
        this.limited = true;
        continue;
      }
      const from = socket(value.source),
        to = socket(value.destination);
      const packageName = value.packages?.find(
        (name) => typeof name === 'string' && /^[a-zA-Z0-9_.]+$/.test(name)
      );
      this.entries.set(event.id, {
        id: event.id,
        chains: value.outbound ? [value.outbound] : [],
        outbound: value.outbound,
        rule: value.rule ?? '',
        rulePayload: '',
        upload: Number.isFinite(value.uploadTotal) ? value.uploadTotal : undefined,
        download: Number.isFinite(value.downloadTotal) ? value.downloadTotal : undefined,
        start:
          Number.isFinite(value.createdAt) && value.createdAt! > 0 && value.createdAt! <= 8.64e15
            ? new Date(value.createdAt!).toISOString()
            : undefined,
        metadata: {
          host: value.domain,
          destinationIP: to.address,
          destinationPort: to.port,
          sourceIP: from.address,
          sourcePort: from.port,
          network: value.network,
          type: value.protocol,
          ...(packageName
            ? { processPath: `android-package:${packageName}`, processName: packageName }
            : Number.isInteger(value.uid) && value.uid! >= 0
              ? { processName: `UID ${value.uid}` }
              : {}),
        },
      });
    }
  }
  snapshot(applications: InstalledApplication[] = [], running = true): ConnectionsSnapshot {
    return {
      source: 'proxy',
      connections: structuredClone([...this.entries.values()]),
      at: Date.now(),
      applications,
      ...(this.limited ? { limited: true } : {}),
      ...(!running ? { unavailable: true } : {}),
    };
  }
}
