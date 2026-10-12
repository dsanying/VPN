import { observationIsFresh, MEASUREMENT_COALESCE_MS } from '../../shared/background-refresh';
import { createHash } from 'crypto';
import * as path from 'path';
import type { ConfigManager } from './ConfigManager';
import type { SubscriptionConfig } from '../../shared/types';
import type { SubscriptionConnectivity } from '../../shared/subscription-connectivity';
import { checkSubscriptionConnectivity } from './subscription-connectivity';
import { measurementDatabase } from './MeasurementDatabase';
import { subscriptionMeasurementIdentity } from '../../shared/measurement-identity';

type RecordValue = { fingerprint: string; value: SubscriptionConnectivity };
export function subscriptionFingerprint(sub: SubscriptionConfig): string {
  return createHash('sha256').update(subscriptionMeasurementIdentity(sub)).digest('hex');
}
export class SubscriptionMeasurementService {
  private readonly database;
  private flights = new Map<string, Promise<SubscriptionConnectivity>>();
  constructor(
    private readonly manager: ConfigManager,
    private readonly port: () => number | null,
    private readonly publish: (records: Record<string, SubscriptionConnectivity>) => void
  ) {
    this.database = measurementDatabase(
      path.join(path.dirname(manager.getConfigPath()), 'measurements.sqlite')
    );
  }
  async read(): Promise<Record<string, SubscriptionConnectivity>> {
    const config = await this.manager.loadConfig();
    const saved = this.database.read<RecordValue>('subscription');
    const valid = Object.fromEntries(
      (config.subscriptions ?? []).flatMap((sub) =>
        saved[sub.id]?.fingerprint === subscriptionFingerprint(sub) ? [[sub.id, saved[sub.id]]] : []
      )
    );
    if (Object.keys(valid).length !== Object.keys(saved).length)
      this.database.replace('subscription', valid);
    return Object.fromEntries(Object.entries(valid).map(([id, record]) => [id, record.value]));
  }
  async check(id: string): Promise<SubscriptionConnectivity> {
    const config = await this.manager.loadConfig();
    const sub = config.subscriptions?.find((item) => item.id === id);
    if (!sub) throw new Error('Subscription not found');
    const fingerprint = subscriptionFingerprint(sub);
    const key = JSON.stringify([id, fingerprint, this.port()]);
    const existing = this.flights.get(key);
    if (existing) return existing;
    const task = (async () => {
      const value = await checkSubscriptionConnectivity(sub, this.port());
      const latest = await this.manager.loadConfig();
      const current = latest.subscriptions?.find((item) => item.id === id);
      // Deleted or edited while the request was in flight: never resurrect an obsolete record.
      if (current && subscriptionFingerprint(current) === fingerprint) {
        const saved = this.database.read<RecordValue>('subscription');
        if (!saved[id] || Date.parse(saved[id].value.checkedAt) <= Date.parse(value.checkedAt))
          saved[id] = { fingerprint, value };
        this.database.replace('subscription', saved);
      }
      this.publish(await this.read());
      return value;
    })();
    this.flights.set(key, task);
    try {
      return await task;
    } finally {
      this.flights.delete(key);
    }
  }
  async refresh(missingOnly: boolean, requested = new Map<string, number>()): Promise<void> {
    const records = await this.read();
    this.publish(records);
    const config = await this.manager.loadConfig();
    const queue = (config.subscriptions ?? []).filter(
      (sub) =>
        !records[sub.id] ||
        !observationIsFresh(records[sub.id].checkedAt) ||
        (requested.has(sub.id) &&
          Date.parse(records[sub.id].checkedAt) <= requested.get(sub.id)!) ||
        (!missingOnly &&
          Date.now() - Date.parse(records[sub.id].checkedAt) >= MEASUREMENT_COALESCE_MS)
    );
    // Two subscriptions at a time; each checks its two independent routes concurrently.
    await Promise.all(
      Array.from({ length: Math.min(2, queue.length) }, async () => {
        for (let sub = queue.shift(); sub; sub = queue.shift())
          await this.check(sub.id).catch(() => {});
      })
    );
  }
}
