import type { UserConfig } from './types';
import { isDirectSelection } from './direct-selection';
import { validateUserConfig } from './config-validation';

export interface ConfigDocumentStore {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
}

/** Serialize mutations and publish only after durable storage succeeds. */
export class ConfigRepository {
  private tail: Promise<unknown> = Promise.resolve();
  private current?: UserConfig;
  private listeners = new Set<(config: UserConfig) => void>();

  constructor(
    private readonly store: ConfigDocumentStore,
    private readonly initialize: () => UserConfig,
    private readonly migrate: (config: UserConfig) => void,
    private readonly hostPolicy: (config: UserConfig) => void = () => {}
  ) {}

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<UserConfig> {
    if (this.current) return this.current;
    const content = await this.store.read('config');
    let config: UserConfig;
    if (content === null) config = this.initialize();
    else {
      const document = JSON.parse(content);
      if (document.schema !== 1) throw new Error('Unsupported configuration schema');
      config = document.value;
      this.validate(config);
    }
    const before = JSON.stringify(config);
    this.migrate(config);
    validateUserConfig(config);
    this.hostPolicy(config);
    this.validate(config);
    if (content === null || JSON.stringify(config) !== before) await this.persist(config);
    this.current = structuredClone(config);
    return this.current;
  }

  private validate(config: UserConfig): void {
    if (!config || !Array.isArray(config.servers) || !Array.isArray(config.customRules))
      throw new Error('Invalid stored configuration');
    const ids = config.servers.map((server) => server.id);
    if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
      throw new Error('Invalid or duplicate server identity');
    if (
      config.selectedServerId !== null &&
      !isDirectSelection(config.selectedServerId) &&
      !ids.includes(config.selectedServerId)
    )
      throw new Error('Selected server does not exist');
    if (!['global', 'smart', 'direct'].includes(config.proxyMode))
      throw new Error('Invalid routing mode');
  }

  private persist(config: UserConfig): Promise<void> {
    return this.store.write('config', JSON.stringify({ schema: 1, value: config }));
  }

  read(): Promise<UserConfig> {
    return this.enqueue(async () => structuredClone(await this.load()));
  }

  update(mutation: (config: UserConfig) => void | UserConfig): Promise<UserConfig> {
    return this.enqueue(async () => {
      const draft = structuredClone(await this.load());
      const next = mutation(draft) ?? draft;
      this.validate(next);
      this.migrate(next);
      validateUserConfig(next);
      this.hostPolicy(next);
      this.validate(next);
      try {
        await this.persist(next);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'CONFIG_WRITE_CONFLICT'
        )
          this.current = undefined;
        throw error;
      }
      this.current = structuredClone(next);
      for (const listener of this.listeners) {
        try {
          listener(structuredClone(next));
        } catch {
          /* Storage success must not depend on a view. */
        }
      }
      return structuredClone(next);
    });
  }

  subscribe(listener: (config: UserConfig) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
