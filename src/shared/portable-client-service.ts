import { IPC_CHANNELS as C } from './ipc-channels';
import type { ConfigRepository } from './config-repository';
import type { PortableConfigOperations } from './portable-config-operations';
import type { PortableCoreController } from './portable-core-controller';
import type { PortableSubscriptionManager } from './portable-subscription-manager';
import type { PortableSubscriptionMeasurements } from './portable-subscription-measurements';
import { PortableImportParser } from './import-parser';
import type { SubscriptionPreviewResult } from './subscription-preview';
import type {
  ApiResponse,
  InstalledApplication,
  LogEntry,
  Rule,
  ServerConfig,
  SubscriptionConfig,
  UserConfig,
} from './types';

export interface PortableClientPorts {
  config: ConfigRepository;
  operations: PortableConfigOperations;
  core: PortableCoreController;
  subscriptions: PortableSubscriptionManager;
  links: PortableSubscriptionMeasurements;
  preview(url: string): Promise<SubscriptionPreviewResult>;
  applications(): Promise<InstalledApplication[]>;
  nodeMeasurements(): Promise<unknown>;
  speedTest(ids?: string[]): Promise<unknown>;
  version(): Promise<unknown>;
  logs(): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
  recordOperation?(entry: LogEntry): Promise<void>;
  /** Native operations are explicitly supplied; unavailable commands never fabricate success. */
  commands?: ReadonlyMap<string, (args: unknown) => Promise<unknown>>;
}

/** One business dispatcher for a portable host; the wire envelope matches the desktop contract. */
export class PortableClientService {
  private listeners = new Map<string, Set<(data: unknown) => void>>();
  private detach: Array<() => void> = [];
  private initialization?: Promise<void>;
  private closed = false;
  private importer = new PortableImportParser();
  constructor(private readonly ports: PortableClientPorts) {}

  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Client service is closed'));
    return (this.initialization ??= (async () => {
      this.detach.push(
        this.ports.config.subscribe((config) =>
          this.emit(C.EVENT_CONFIG_CHANGED, { newValue: config })
        )
      );
      let previous = this.ports.core.snapshot();
      this.detach.push(
        this.ports.core.subscribe((status) => {
          if (status.error && status.error !== previous.error)
            this.emit(C.EVENT_PROXY_ERROR, { message: status.error });
          if (status.running !== previous.running)
            this.emit(status.running ? C.EVENT_PROXY_STARTED : C.EVENT_PROXY_STOPPED, {});
          previous = status;
        })
      );
      await this.ports.config.read();
      await this.ports.core.initialize();
    })().catch((error) => {
      this.detach.splice(0).forEach((off) => off());
      this.initialization = undefined;
      throw error;
    }));
  }
  on(channel: string, listener: (data: unknown) => void): () => void {
    if (this.closed) throw new Error('Client service is closed');
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(channel);
    };
  }
  emit(channel: string, data: unknown): void {
    if (this.closed) return;
    for (const listener of this.listeners.get(channel) ?? []) {
      try {
        listener(structuredClone(data));
      } catch {
        /* A view cannot fail committed work. */
      }
    }
  }
  async invoke(channel: string, args?: unknown): Promise<ApiResponse<unknown>> {
    const traceId = globalThis.crypto?.randomUUID?.().replace(/-/g, '');
    const started = Date.now();
    const readOnly = /:(?:get|read|is|has|stateExists|measurements)/i.test(channel);
    const record = async (phase: 'start' | 'success' | 'failure', message = '') => {
      if (readOnly && phase !== 'failure') return;
      try {
        await this.ports.recordOperation?.({
          timestamp: new Date().toISOString(),
          level: phase === 'failure' ? 'error' : 'info',
          source: 'Operation',
          message: `operation=${channel}; phase=${phase}; ${message}`,
          traceId,
          operation: channel,
          phase,
          durationMs: Math.round(Date.now() - started),
        });
      } catch {
        /* A log sink failure must not change the result of committed work. */
      }
    };
    await record('start');
    try {
      await this.initialize();
      if (this.closed) throw new Error('Client service is closed');
      const data = await this.dispatch(channel, args);
      const failed =
        !!data &&
        typeof data === 'object' &&
        (('success' in data && data.success === false) || ('error' in data && !!data.error));
      await record(failed ? 'failure' : 'success');
      return { success: true, data };
    } catch (error) {
      await record('failure', error instanceof Error ? error.message : 'Operation failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Operation failed',
        code:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'CLIENT_OPERATION_FAILED',
      };
    }
  }
  private async dispatch(channel: string, args?: unknown): Promise<unknown> {
    const { config, operations, core, subscriptions, links } = this.ports;
    const input = (args ?? {}) as Record<string, unknown>;
    switch (channel) {
      case C.ENTERPRISE_GET:
        return { profiles: [], session: { state: 'idle' }, supported: false };
      case C.CONFIG_GET:
        return config.read();
      case C.CONFIG_SAVE:
        return operations.save(args as UserConfig);
      case C.CONFIG_GET_VALUE:
        return (await config.read())[input.key as keyof UserConfig];
      case C.CONFIG_SET_VALUE:
        return operations.setValue(input.key as keyof UserConfig, input.value as never);
      case C.CONFIG_UPDATE_MODE:
        return operations.setValue('proxyMode', input.mode as UserConfig['proxyMode']);
      case C.CONFIG_GET_PRIVACY_MODE:
        return false; // No desktop privacy-lock subsystem in a mobile host.
      case C.SERVER_GET_ALL:
        return (await config.read()).servers;
      case C.SERVER_ADD:
        return (await operations.addServers([args as Omit<ServerConfig, 'id'>]))[0];
      case C.SERVER_ADD_BULK:
        return { added: (await operations.addServers(input.servers as ServerConfig[])).length };
      case C.SERVER_UPDATE:
        return operations.updateServer(args as ServerConfig);
      case C.SERVER_DELETE:
        await operations.deleteServers(
          [input.serverId as string],
          input.fallbackSelectedId as string | undefined
        );
        return;
      case C.SERVER_DELETE_BATCH:
        return operations.deleteServers(
          input.serverIds as string[],
          input.fallbackSelectedId as string | undefined
        );
      case C.SERVER_SWITCH:
        return operations.switchServer(input.serverId as string);
      case C.SERVER_MEASUREMENTS:
        return this.ports.nodeMeasurements();
      case C.SERVER_SPEED_TEST:
        return this.ports.speedTest(input.serverIds as string[] | undefined);
      case C.SUBSCRIPTION_ADD:
        return operations.addSubscription(args as Omit<SubscriptionConfig, 'id' | 'createdAt'>);
      case C.SUBSCRIPTION_UPDATE:
        return operations.updateSubscription(args as SubscriptionConfig);
      case C.SUBSCRIPTION_DELETE:
        return operations.deleteSubscription(input.subscriptionId as string);
      case C.SUBSCRIPTION_UPDATE_SERVERS:
        return subscriptions.sync(input.subscriptionId as string);
      case C.SUBSCRIPTION_CONNECTIVITY:
        return links.check(input.subscriptionId as string);
      case C.SUBSCRIPTION_MEASUREMENTS:
        return links.read();
      case C.SUBSCRIPTION_PREVIEW:
        return this.ports.preview(input.url as string);
      case C.LOCAL_IMPORT_PARSE:
        return this.importer.parseLocalContent(input.text as string);
      case C.RULES_GET_ALL:
        return (await config.read()).customRules;
      case C.RULES_ADD:
        return operations.addRule(args as Omit<Rule, 'id'>);
      case C.RULES_UPDATE:
        return operations.updateRule(args as Rule);
      case C.RULES_DELETE:
        return operations.deleteRule(input.ruleId as string);
      case C.RULES_REORDER:
        return operations.reorderRules(input.orderedIds as string[]);
      case C.PROXY_START:
        await core.start();
        return;
      case C.PROXY_STOP:
        await core.stop();
        return;
      case C.PROXY_RESTART:
        await core.applySaved();
        return;
      case C.PROXY_GET_PENDING_CHANGES:
        return core.pendingNodeChanges();
      case C.PROXY_APPLY_PENDING_CHANGES:
        await core.applySaved();
        return;
      case C.PROXY_GET_STATUS: {
        const state = core.snapshot(),
          saved = await config.read();
        return {
          ...state,
          startTime: state.startTime ? new Date(state.startTime) : undefined,
          currentServer: saved.servers.find((node) => node.id === saved.selectedServerId),
        };
      }
      case C.VERSION_GET_INFO:
        return this.ports.version();
      case C.SYSTEM_LIST_APPLICATIONS:
        return this.ports.applications();
      case C.LOGS_GET:
        return this.ports.logs();
      case C.LOGS_CLEAR:
        return this.ports.clearLogs();
      default: {
        const operation = this.ports.commands?.get(channel);
        if (operation) return operation(args);
        throw Object.assign(new Error('当前平台尚未提供此操作'), {
          code: 'HOST_CAPABILITY_UNAVAILABLE',
        });
      }
    }
  }
  close(): void {
    this.closed = true;
    this.detach.splice(0).forEach((off) => off());
    this.listeners.clear();
    this.ports.subscriptions.close();
    this.ports.links.close();
    this.ports.core.close();
  }
}
