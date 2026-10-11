import { nodeMeasurementIdentity } from './measurement-identity';
import type { PendingNodeChanges, UserConfig } from './types';
import type { ConfigRepository } from './config-repository';
import { portableSha256 } from './portable-subscription-measurements';

export interface PortableAppliedReceipt {
  configDigest: string;
  nodes: Record<string, string>;
}

export interface PortableCoreStatus {
  running: boolean;
  busy: boolean;
  startTime?: number;
  uptime?: number;
  error?: string;
  appliedReceipt?: PortableAppliedReceipt;
}
export interface PortableCorePort {
  status(): Promise<PortableCoreStatus>;
  checkConfig(options: { config: string }): Promise<void>;
  start(options: { config: string; nodes: Record<string, string> }): Promise<PortableCoreStatus>;
  appliedReceipt?(): Promise<PortableAppliedReceipt | null>;
  stop(): Promise<PortableCoreStatus>;
  subscribe(listener: (status: PortableCoreStatus) => void): Promise<() => void>;
}

/** Commands settle from the native operation result. No confirmation timer or polling. */
export class PortableCoreController {
  private state: PortableCoreStatus = { running: false, busy: false };
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(status: PortableCoreStatus) => void>();
  private detach?: () => void;
  private initialization?: Promise<void>;
  private revision = 0;
  private closed = false;
  private appliedConfig?: string;
  private appliedNodes = new Map<string, string>();

  constructor(
    private readonly repository: ConfigRepository,
    private readonly native: PortableCorePort,
    private readonly compile: (config: UserConfig) => Promise<string>
  ) {}

  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Core controller is closed'));
    if (!this.initialization)
      this.initialization = (async () => {
        this.detach = await this.native.subscribe((status) => this.publish(status));
        if (this.closed) {
          this.detach();
          this.detach = undefined;
          return;
        }
        const revision = this.revision;
        const status = await this.native.status();
        if (revision === this.revision && !this.closed) this.publish(status);
        const receiptRevision = this.revision;
        if (this.state.running && !this.appliedConfig && this.native.appliedReceipt) {
          const receipt = await this.native.appliedReceipt();
          if (!this.closed && this.state.running && receiptRevision === this.revision && receipt) {
            this.adoptReceipt(receipt);
          }
        }
      })().catch((error) => {
        this.detach?.();
        this.detach = undefined;
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }

  snapshot(): PortableCoreStatus {
    return { ...this.state };
  }
  subscribe(listener: (status: PortableCoreStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private adoptReceipt(receipt: PortableAppliedReceipt | null | undefined): boolean {
    if (
      !receipt ||
      typeof receipt.configDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(receipt.configDigest) ||
      !receipt.nodes ||
      typeof receipt.nodes !== 'object' ||
      Array.isArray(receipt.nodes) ||
      !Object.entries(receipt.nodes).every(
        ([id, digest]) =>
          id.length > 0 &&
          id.length <= 256 &&
          typeof digest === 'string' &&
          /^[a-f0-9]{64}$/.test(digest)
      )
    )
      return false;
    this.appliedConfig = receipt.configDigest;
    this.appliedNodes = new Map(Object.entries(receipt.nodes));
    return true;
  }
  private publish(status: PortableCoreStatus): void {
    if (this.closed) return;
    this.revision++;
    this.state = { ...status };
    if (!status.running) {
      this.appliedConfig = undefined;
      this.appliedNodes.clear();
    } else if (status.appliedReceipt) {
      // The native completion snapshot carries its receipt atomically, including external reloads.
      if (!this.adoptReceipt(status.appliedReceipt)) {
        this.appliedConfig = undefined;
        this.appliedNodes.clear();
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot());
      } catch {
        /* A view cannot fail a native command. */
      }
    }
  }
  private command(action: () => Promise<PortableCoreStatus>): Promise<PortableCoreStatus> {
    const result = this.tail.then(async () => {
      await this.initialize();
      if (this.closed) throw new Error('Core controller is closed');
      return action();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async startSaved(onlyIfChanged = false): Promise<PortableCoreStatus> {
    // Read within the serialized operation, never use a stale renderer draft.
    const saved = await this.repository.read();
    const config = await this.compile(saved);
    const digest = await portableSha256(config);
    if (onlyIfChanged && this.state.running && !this.state.error && this.appliedConfig === digest)
      return this.snapshot();
    const nodes = Object.fromEntries(
      await Promise.all(
        saved.servers.map(
          async (node) => [node.id, await portableSha256(nodeMeasurementIdentity(node))] as const
        )
      )
    );
    await this.native.checkConfig({ config });
    const status = await this.native.start({ config, nodes });
    this.publish(status);
    if (!status.running || status.busy || status.error)
      throw new Error(status.error ?? 'VPN did not start');
    this.appliedConfig = digest;
    this.appliedNodes = new Map(Object.entries(nodes));
    return this.snapshot();
  }
  start(): Promise<PortableCoreStatus> {
    return this.command(() => this.startSaved());
  }
  stop(): Promise<PortableCoreStatus> {
    return this.command(async () => {
      const status = await this.native.stop();
      this.publish(status);
      if (status.running || status.busy || status.error)
        throw new Error(status.error ?? 'VPN did not stop');
      return this.snapshot();
    });
  }
  applySaved(): Promise<PortableCoreStatus> {
    return this.command(() =>
      this.state.running ? this.startSaved(true) : Promise.resolve(this.snapshot())
    );
  }
  async pendingNodeChanges(): Promise<PendingNodeChanges> {
    const result: PendingNodeChanges = { added: [], modified: [] };
    if (!this.state.running || !this.appliedConfig) return result;
    for (const node of (await this.repository.read()).servers) {
      const previous = this.appliedNodes.get(node.id);
      if (previous === undefined) result.added.push(node.id);
      else if (previous !== (await portableSha256(nodeMeasurementIdentity(node))))
        result.modified.push(node.id);
    }
    return result;
  }
  close(): void {
    this.closed = true;
    this.detach?.();
    this.detach = undefined;
    this.listeners.clear();
  }
}
