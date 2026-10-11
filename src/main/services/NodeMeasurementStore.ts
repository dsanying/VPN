import * as path from 'path';
import { measurementDatabase } from './MeasurementDatabase';
import { createHash } from 'crypto';
import { BACKGROUND_REFRESH_MS } from '../../shared/background-refresh';
import { supportsQUICEntry } from './entry-probe';
import * as fs from 'fs/promises';
import type { ServerConfig } from '../../shared/types';
import type { NodeProbeDetails } from '../../shared/speed-test';
import { nodeMeasurementIdentity } from '../../shared/measurement-identity';

export interface NodeMeasurementRecord {
  fingerprint: string;
  latency: number;
  testedAt: number;
  detail?: NodeProbeDetails;
}
export type NodeMeasurements = Record<string, NodeMeasurementRecord>;
/** Names and subscription refresh timestamps do not change a node's transport identity. */
export function measurementFingerprint(node: ServerConfig, target?: string): string {
  return createHash('sha256').update(nodeMeasurementIdentity(node, target)).digest('hex');
}
/** Separate private cache, never written into subscription/configuration or exported backups. */
export class NodeMeasurementStore {
  private records: NodeMeasurements = Object.create(null);
  private loaded?: Promise<void>;
  private readonly database;
  constructor(private readonly file: string) {
    this.database = measurementDatabase(path.join(path.dirname(file), 'measurements.sqlite'));
  }
  private load(): Promise<void> {
    return (this.loaded ??= (async () => {
      let data = this.database.read<NodeMeasurementRecord>('node');
      if (!Object.keys(data).length) {
        try {
          data = JSON.parse(await fs.readFile(this.file, 'utf8'));
        } catch {
          /* no legacy cache */
        }
      }
      for (const [id, record] of Object.entries(data)) {
        if (
          record &&
          /^[a-f0-9]{64}$/.test(record.fingerprint) &&
          Number.isFinite(record.latency) &&
          Number.isFinite(record.testedAt) &&
          record.testedAt >= 0
        )
          this.records[id] = record;
      }
      this.database.replace('node', this.records);
      await fs.rm(this.file, { force: true });
    })());
  }

  async get(nodes: ServerConfig[], target?: string): Promise<NodeMeasurements> {
    await this.load();
    return Object.fromEntries(
      nodes.flatMap((node) => {
        let record = this.records[node.id];
        if (
          record?.fingerprint === measurementFingerprint(node, target) &&
          record.detail?.entry.status === 'unsupported' &&
          record.detail.entry.reason === 'NO_TCP_ENTRY' &&
          supportsQUICEntry(node)
        ) {
          // Recheck newly supported UDP entries, retaining the measured exit identity.
          record = this.records[node.id] = {
            ...record,
            testedAt: 0,
            detail: {
              ...record.detail,
              entry: { status: 'unavailable', reason: 'ENTRY_RECHECK_REQUIRED' },
            },
          };
        }
        return record?.fingerprint === measurementFingerprint(node, target)
          ? [[node.id, record]]
          : [];
      })
    );
  }
  async save(
    nodes: ServerConfig[],
    target: string | undefined,
    measured: NodeMeasurements
  ): Promise<void> {
    await this.load();
    const valid = new Map(nodes.map((node) => [node.id, measurementFingerprint(node, target)]));
    for (const id of Object.keys(this.records))
      if (this.records[id].fingerprint !== valid.get(id)) delete this.records[id];
    for (const [id, record] of Object.entries(measured))
      if (
        Number.isFinite(record.latency) &&
        Number.isFinite(record.testedAt) &&
        record.testedAt >= 0 &&
        record.fingerprint === valid.get(id) &&
        (!this.records[id] || record.testedAt >= this.records[id].testedAt)
      ) {
        // A failed country lookup does not erase a previously measured exit region.
        this.records[id] = {
          ...record,
          detail: record.detail
            ? { ...record.detail, exit: record.detail.exit ?? this.records[id]?.detail?.exit }
            : this.records[id]?.detail,
        };
      }
    this.database.replace('node', this.records);
  }
}
/** All due nodes enter the same bounded-concurrency run; freshness matches the UI. */
export function dueMeasurements(
  nodes: ServerConfig[],
  records: NodeMeasurements,
  selected: string | null | undefined,
  now: number
): ServerConfig[] {
  return nodes
    .filter((node) => {
      const record = records[node.id];
      return (
        !record ||
        record.detail?.entry.reason === 'ENTRY_RECHECK_REQUIRED' ||
        !Number.isFinite(record.testedAt) ||
        record.testedAt > now ||
        now - record.testedAt >= BACKGROUND_REFRESH_MS
      );
    })
    .sort(
      (a, b) =>
        Number(b.id === selected) - Number(a.id === selected) ||
        (records[a.id]?.testedAt ?? 0) - (records[b.id]?.testedAt ?? 0)
    );
}
