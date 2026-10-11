import type { ConfigRepository, ConfigDocumentStore } from './config-repository';
import type { ServerConfig } from './types';
import { PortableMeasurementRepository } from './portable-measurement-repository';
import { portableSha256 } from './portable-subscription-measurements';
import { nodeMeasurementIdentity } from './measurement-identity';
import {
  DEFAULT_SPEED_TEST_URL,
  type NodeProbeDetails,
  type SpeedTestInvokeResult,
} from './speed-test';

export interface PortableNodeObservation {
  latency: number;
  testedAt: number;
  detail: NodeProbeDetails;
}
export interface PortableNodeProbe {
  /** Full TLS-verified HTTP request through this exact node, independent of selected exit. */
  measure(
    node: ServerConfig,
    target: string,
    signal: AbortSignal
  ): Promise<PortableNodeObservation>;
}
export interface PortableNodeEvents {
  progress(value: {
    tested: number;
    ok: number;
    total: number;
    serverIds: string[];
    active: boolean;
  }): void;
  result(id: string, value: PortableNodeObservation): void;
}
function validObservation(value: unknown): value is PortableNodeObservation {
  if (!value || typeof value !== 'object') return false;
  const record = value as PortableNodeObservation;
  return (
    Number.isFinite(record.latency) &&
    (record.latency === -1 || record.latency >= 0) &&
    Number.isFinite(record.testedAt) &&
    record.testedAt >= 0 &&
    !!record.detail &&
    !!record.detail.entry &&
    ['ok', 'failed', 'timeout', 'unavailable', 'unsupported'].includes(record.detail.entry.status)
  );
}
/** Persist before publishing; edits/deletions invalidate in-flight results by transport fingerprint. */
export class PortableNodeMeasurements {
  private records;
  private tail: Promise<unknown> = Promise.resolve();
  private flights = new Map<string, Promise<SpeedTestInvokeResult>>();
  private abort = new AbortController();
  constructor(
    private config: ConfigRepository,
    store: ConfigDocumentStore,
    private probe: PortableNodeProbe,
    private events: PortableNodeEvents,
    private hash = portableSha256,
    private concurrency = 4
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
      throw new Error('Invalid probe concurrency');
    this.records = new PortableMeasurementRepository(
      store,
      'node-measurements',
      async () =>
        new Map(
          await Promise.all(
            (await config.read()).servers.map(
              async (node) =>
                [
                  node.id,
                  await hash(nodeMeasurementIdentity(node, DEFAULT_SPEED_TEST_URL)),
                ] as const
            )
          )
        ),
      validObservation
    );
  }
  async read(): Promise<Record<string, PortableNodeObservation>> {
    return Object.fromEntries(
      Object.entries(await this.records.read()).map(([id, record]) => [id, record.value])
    );
  }
  async test(ids?: string[]): Promise<SpeedTestInvokeResult> {
    if (this.abort.signal.aborted) throw new Error('Measurements are closed');
    const saved = await this.config.read();
    const selected = ids ? new Set(ids) : new Set(saved.servers.map((node) => node.id));
    if (
      ids &&
      (!ids.length ||
        selected.size !== ids.length ||
        ids.some((id) => !saved.servers.some((node) => node.id === id)))
    )
      throw new Error('Invalid measurement scope');
    const nodes = saved.servers.filter((node) => selected.has(node.id));
    const fingerprints = await Promise.all(
      nodes.map((node) => this.hash(nodeMeasurementIdentity(node, DEFAULT_SPEED_TEST_URL)))
    );
    const key = JSON.stringify(nodes.map((node, index) => [node.id, fingerprints[index]]));
    const existing = this.flights.get(key);
    if (existing) return existing;
    const task = this.tail.then(() => this.run(nodes, fingerprints));
    this.tail = task.catch(() => undefined);
    this.flights.set(key, task);
    try {
      return await task;
    } finally {
      if (this.flights.get(key) === task) this.flights.delete(key);
    }
  }
  private async run(nodes: ServerConfig[], fingerprints: string[]): Promise<SpeedTestInvokeResult> {
    const outcome: SpeedTestInvokeResult = {
      results: {},
      outcome: 'completed',
      notInPool: [],
      tsNotReady: [],
      details: {},
    };
    let index = 0,
      tested = 0,
      ok = 0;
    const progress = (active: boolean) => {
      try {
        this.events.progress({
          tested,
          ok,
          total: nodes.length,
          serverIds: nodes.map((node) => node.id),
          active,
        });
      } catch {
        /* Detached views cannot interrupt native work. */
      }
    };
    progress(true);
    try {
      const workers = Array.from({ length: Math.min(this.concurrency, nodes.length) }, async () => {
        while (index < nodes.length) {
          if (this.abort.signal.aborted) {
            outcome.outcome = 'interrupted';
            return;
          }
          const position = index++,
            node = nodes[position];
          try {
            // A queued request may have been edited before its worker starts.
            const current = (await this.config.read()).servers.find((item) => item.id === node.id);
            if (
              !current ||
              (await this.hash(nodeMeasurementIdentity(current, DEFAULT_SPEED_TEST_URL))) !==
                fingerprints[position]
            ) {
              outcome.outcome = 'interrupted';
              continue;
            }
            const value = await this.probe.measure(
              structuredClone(node),
              DEFAULT_SPEED_TEST_URL,
              this.abort.signal
            );
            if (this.abort.signal.aborted) {
              outcome.outcome = 'interrupted';
              return;
            }
            if (!validObservation(value)) throw new Error('Invalid native measurement');
            const accepted = await this.records.save(node.id, {
              fingerprint: fingerprints[position],
              observedAt: value.testedAt,
              value,
            });
            if (!accepted) {
              outcome.outcome = 'interrupted';
              continue;
            }
            outcome.results[node.id] = value.latency;
            outcome.details![node.id] = value.detail;
            tested++;
            if (value.latency >= 0) ok++;
            try {
              this.events.result(node.id, value);
            } catch {
              /* The result is already committed; notification failures do not change it. */
            }
            progress(true);
          } catch {
            // Runtime/permission/storage failures are not evidence that a node is unavailable.
            outcome.outcome = 'interrupted';
          }
        }
      });
      await Promise.all(workers);
      return outcome;
    } finally {
      progress(false);
    }
  }
  close(): void {
    this.abort.abort();
  }
}
