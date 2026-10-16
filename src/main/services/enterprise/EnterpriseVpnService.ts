import type {
  EnterpriseProfileInput,
  EnterpriseSession,
  EnterpriseSnapshot,
  EnterpriseProfile,
} from '../../../shared/enterprise-vpn';
import { normalizeEnterpriseGateway } from '../../../shared/enterprise-vpn';
import type { NodeProbeDetails } from '../../../shared/speed-test';
import type { UserConfig, ServerConfig, Rule } from '../../../shared/types';
import { DIRECT_SERVER_ID } from '../../../shared/direct-selection';
import { referencedServerIds } from '../../../shared/endpoint-routes';
import { EnterpriseDiscovery } from './EnterpriseDiscovery';
import { EnterpriseProfileStore } from './EnterpriseProfileStore';
import { EnterpriseEngine, type EnterpriseBridge } from './EnterpriseEngine';
interface ConfigStore {
  loadConfig(): Promise<UserConfig>;
  saveConfig(config: UserConfig): Promise<void>;
}
interface TunnelOwner {
  stop(): Promise<void>;
  on?(event: 'stopped', listener: () => void): unknown;
  setNodeAdapters(adapter: {
    prepare(config: UserConfig): Promise<boolean>;
    project(config: UserConfig): UserConfig;
    stop(): Promise<void>;
  }): void;
}
/** Authenticated gateways are node adapters, not a second network takeover stack. */
export class EnterpriseVpnService {
  private readonly active = new Map<
    string,
    { engine: EnterpriseEngine; bridge: EnterpriseBridge; revision: string }
  >();
  private readonly sessions = new Map<string, EnterpriseSession>();
  private generation = 0;
  private disposing = false;
  constructor(
    private readonly store: EnterpriseProfileStore,
    readonly discovery: EnterpriseDiscovery,
    private readonly createEngine: () => EnterpriseEngine,
    private readonly proxy: TunnelOwner,
    private readonly configStore: ConfigStore,
    private readonly publish: (snapshot: EnterpriseSnapshot) => void
  ) {
    proxy.on?.('stopped', () => {
      void this.disconnect();
    });
    proxy.setNodeAdapters({
      prepare: (c) => this.prepare(c),
      project: (c) => this.project(c),
      stop: () => this.disconnect(),
    });
  }
  snapshot(): EnterpriseSnapshot {
    const sessions = [...this.sessions.values()];
    return {
      profiles: this.store.list(),
      sessions,
      session: sessions.find((s) => s.challenge) ?? sessions.at(-1) ?? { state: 'idle' },
      supported: true,
    };
  }
  private notify(): void {
    if (!this.disposing) this.publish(this.snapshot());
  }
  private node(profile: EnterpriseProfile): ServerConfig {
    const url = new URL(profile.gateway);
    return {
      id: profile.id,
      name: profile.name,
      protocol: 'enterprise',
      address: url.hostname,
      port: Number(url.port || 443),
      enterpriseSettings: {
        profileId: profile.id,
        gateway: profile.gateway,
        client: profile.protocol,
      },
      createdAt: profile.updatedAt,
      updatedAt: profile.updatedAt,
    };
  }
  /** Idempotently folds the unpublished standalone profiles into ordinary self-built nodes. */
  async initialize(): Promise<void> {
    const config = await this.configStore.loadConfig();
    let changed = false;
    for (const profile of this.store.list())
      if (!config.servers.some((s) => s.enterpriseSettings?.profileId === profile.id)) {
        config.servers.push(this.node(profile));
        changed = true;
      }
    if (changed) await this.configStore.saveConfig(config);
  }
  async save(input: EnterpriseProfileInput): Promise<EnterpriseProfile> {
    if (this.active.has(input.id ?? '') || this.pending.has(input.id ?? ''))
      throw new Error('请先关闭代理后编辑正在使用的节点');
    const gateway = normalizeEnterpriseGateway(input.gateway);
    const detected = await this.discovery.detect(gateway);
    const previous = input.id && this.store.has(input.id) ? this.store.get(input.id) : undefined;
    const saved = this.store.save({ ...input, gateway }, detected);
    const config = await this.configStore.loadConfig();
    const node = this.node(saved);
    const index = config.servers.findIndex((s) => s.id === saved.id);
    if (index >= 0) config.servers[index] = { ...config.servers[index], ...node };
    else config.servers.push(node);
    try {
      await this.configStore.saveConfig(config);
    } catch (error) {
      if (previous)
        this.store.save(previous, {
          gateway: previous.gateway,
          protocol: previous.protocol,
          authentication: 'unknown',
        });
      else this.store.remove(saved.id);
      throw error;
    }
    this.notify();
    return saved;
  }
  async remove(id: string): Promise<void> {
    if (this.active.has(id)) {
      await this.proxy.stop();
      await this.disconnect();
    }
    this.store.remove(id);
    this.sessions.delete(id);
    this.notify();
  }
  /** Start only effective rule/default/detour targets, while preserving the user's mode and rules. */
  private prepareQueue: Promise<boolean> = Promise.resolve(false);
  prepare(config: UserConfig): Promise<boolean> {
    const epoch = this.generation;
    const operation = this.prepareQueue.then(() => {
      if (epoch !== this.generation) throw new Error('代理开启已取消');
      return this.prepareInner(config, epoch);
    });
    this.prepareQueue = operation.catch(() => false);
    return operation;
  }
  private async prepareInner(config: UserConfig, epoch: number): Promise<boolean> {
    const effective =
      config.proxyMode === 'smart'
        ? {
            ...config,
            customRules: config.customRules.filter((r) => r.action === 'proxy'),
            appRules: config.appRoutingEnabled
              ? (config.appRules ?? []).filter((r) => r.action === 'proxy')
              : [],
          }
        : { ...config, customRules: [], appRules: [] };
    const required =
      config.proxyMode === 'direct' ? new Set<string>() : referencedServerIds(effective);
    const explicit = new Set(required);
    if (config.proxyMode === 'smart')
      for (const node of config.servers) if (node.protocol === 'enterprise') required.add(node.id);
    let changed = false;
    for (const [id, adapter] of this.active)
      if (!required.has(id)) {
        this.active.delete(id);
        await adapter.engine.stop();
        this.sessions.set(id, { profileId: id, state: 'idle' });
        changed = true;
      }
    for (const node of config.servers) {
      if (node.protocol !== 'enterprise' || !required.has(node.id)) continue;
      await this.measureFlights.get(node.id);
      const profile = this.store.get(node.enterpriseSettings!.profileId);
      if (
        profile.id !== node.id ||
        profile.gateway !== node.enterpriseSettings!.gateway ||
        profile.protocol !== node.enterpriseSettings!.client
      )
        throw new Error('企业节点与本地身份不一致，请重新编辑');
      const old = this.active.get(node.id);
      if (old?.revision === profile.updatedAt) continue;
      if (old) {
        this.active.delete(node.id);
        await old.engine.stop();
      }
      const engine = this.createEngine();
      let exitedBeforeActivation = false;
      this.pending.set(node.id, engine);
      this.sessions.set(node.id, { profileId: node.id, state: 'connecting', phase: '认证网关' });
      this.notify();
      try {
        const bridge = await engine.start(
          profile,
          (challenge) => {
            if (epoch !== this.generation) return;
            if (!explicit.has(node.id)) {
              void engine.stop();
              return;
            }
            this.sessions.set(node.id, { profileId: node.id, state: 'authenticating', challenge });
            this.notify();
          },
          (reason) => {
            exitedBeforeActivation = true;
            if (this.active.get(node.id)?.engine === engine && !this.disposing) {
              this.active.delete(node.id);
              this.sessions.set(node.id, {
                profileId: node.id,
                state: 'failed',
                error:
                  reason === 'tunnel-backpressure'
                    ? '企业 VPN 数据报通道持续拥塞，代理已关闭，请稍后重试'
                    : '企业 VPN 隧道已中断，代理已关闭',
              });
              this.notify();
              void this.proxy.stop();
            }
          },
          (phase) => {
            if (epoch !== this.generation || this.pending.get(node.id) !== engine) return;
            this.sessions.set(node.id, { profileId: node.id, state: 'connecting', phase });
            this.notify();
          }
        );
        if (exitedBeforeActivation) throw new Error('企业 VPN 隧道在启动过程中已中断');
        if (epoch !== this.generation) {
          await engine.stop();
          throw new Error('代理开启已取消');
        }
        this.pending.delete(node.id);
        this.active.set(node.id, { engine, bridge, revision: profile.updatedAt });
        this.sessions.set(node.id, { profileId: node.id, state: 'connected' });
        changed = true;
        this.notify();
      } catch (error) {
        this.pending.delete(node.id);
        await engine.stop();
        if (epoch === this.generation) {
          this.sessions.set(node.id, {
            profileId: node.id,
            state: 'failed',
            error: error instanceof Error ? error.message : '企业节点认证失败',
          });
          this.notify();
        }
        if (explicit.has(node.id)) throw error;
      }
    }
    return changed;
  }
  /** Authentication checks use a private userspace tunnel, never change OS routes or the default node. */
  private readonly measureFlights = new Map<
    string,
    Promise<Pick<NodeProbeDetails, 'availability' | 'proxyReason'>>
  >();
  measure(
    node: ServerConfig,
    interactive = false
  ): Promise<Pick<NodeProbeDetails, 'availability' | 'proxyReason'>> {
    const old = this.measureFlights.get(node.id);
    if (old) return old;
    const flight = this.measureInner(node, interactive);
    this.measureFlights.set(node.id, flight);
    void flight
      .finally(() => {
        if (this.measureFlights.get(node.id) === flight) this.measureFlights.delete(node.id);
      })
      .catch(() => {});
    return flight;
  }
  private async measureInner(
    node: ServerConfig,
    interactive = false
  ): Promise<Pick<NodeProbeDetails, 'availability' | 'proxyReason'>> {
    const id = node.enterpriseSettings?.profileId;
    if (!id || this.pending.has(id))
      return { availability: 'unknown', proxyReason: 'enterprise-busy' };
    if (this.active.has(id))
      return {
        availability: await this.active.get(id)!.engine.checkHealth(this.active.get(id)!.bridge),
        proxyReason: 'enterprise-target-unsupported',
      };
    const engine = this.createEngine();
    let challengeRequired = false;
    let exited = false;
    this.pending.set(id, engine);
    try {
      const profile = this.store.get(id);
      const bridge = await engine.start(
        profile,
        (challenge) => {
          challengeRequired = true;
          if (!interactive) {
            void engine.stop();
            return;
          }
          this.sessions.set(id, { profileId: id, state: 'authenticating', challenge });
          this.notify();
        },
        () => {
          exited = true;
        }
      );
      return exited
        ? { availability: 'failed', proxyReason: 'enterprise-tunnel-failed' }
        : {
            availability: bridge.availability ?? 'unknown',
            proxyReason: 'enterprise-target-unsupported',
          };
    } catch (error) {
      const localFailure =
        error instanceof Error && /尚未|完整性校验|配置不存在|已取消/.test(error.message);
      return {
        availability: challengeRequired || localFailure ? 'unknown' : 'failed',
        proxyReason: challengeRequired
          ? 'enterprise-auth-required'
          : localFailure
            ? 'enterprise-engine-unavailable'
            : 'enterprise-auth-failed',
      };
    } finally {
      this.pending.delete(id);
      await engine.stop();
      this.sessions.set(id, { profileId: id, state: 'idle' });
      this.notify();
    }
  }
  /** Runtime-only SOCKS projection; saved IDs, rules, default selection and credentials remain untouched. */
  project(config: UserConfig): UserConfig {
    const selected = config.servers.find((s) => s.id === config.selectedServerId);
    const automatic: Rule[] = [];
    if (config.proxyMode === 'smart')
      for (const [id, adapter] of this.active) {
        const resources = adapter.bridge.resources;
        for (const [type, values] of [
          ['domain', resources?.domains ?? []],
          ['domainSuffix', resources?.suffixes ?? []],
          ['ipCidr', resources?.cidrs ?? []],
        ] as const) {
          if (values.length)
            automatic.push({
              id: `enterprise-resource-${id}-${type}`,
              type,
              values: [...values],
              enabled: true,
              action: 'proxy',
              targetServerId: id,
            });
        }
      }
    return {
      ...config,
      customRules: [...config.customRules, ...automatic],
      selectedServerId:
        config.proxyMode === 'direct' && selected?.protocol === 'enterprise'
          ? DIRECT_SERVER_ID
          : config.selectedServerId,
      servers: config.servers.flatMap((node) => {
        if (node.protocol !== 'enterprise') return [node];
        const bridge = this.active.get(node.id)?.bridge;
        // Never emit an unauthenticated gateway or a dummy localhost outbound.
        return bridge
          ? [
              {
                ...node,
                enterpriseSettings: { ...node.enterpriseSettings!, dnsPort: bridge.dnsPort },
                protocol: 'socks' as const,
                address: '127.0.0.1',
                port: bridge.port,
                username: bridge.username,
                password: bridge.password,
              },
            ]
          : [];
      }),
    };
  }

  respond(id: string, value: Parameters<EnterpriseEngine['respond']>[1]): void {
    const session = [...this.sessions.values()].find((s) => s.challenge?.id === id);
    const engine = session?.profileId ? this.pending.get(session.profileId) : undefined;
    if (!engine) throw new Error('认证请求已失效');
    engine.respond(id, value);
    this.sessions.set(session!.profileId!, {
      profileId: session!.profileId,
      state: 'connecting',
      phase: '建立隧道',
    });
    this.notify();
  }
  private readonly pending = new Map<string, EnterpriseEngine>();
  async disconnect(): Promise<void> {
    ++this.generation;
    const engines = [...this.active.values()]
      .map((v) => v.engine)
      .concat([...this.pending.values()]);
    this.active.clear();
    this.pending.clear();
    for (const [id, session] of this.sessions)
      if (session.state !== 'failed') this.sessions.set(id, { profileId: id, state: 'idle' });
    await Promise.all(engines.map((engine) => engine.stop()));
    this.notify();
  }
  async close(): Promise<void> {
    this.disposing = true;
    await this.disconnect();
    this.store.close();
  }
}
