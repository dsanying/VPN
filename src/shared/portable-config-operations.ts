import type { ConfigRepository } from './config-repository';
import type { UserConfig, ServerConfig, SubscriptionConfig, Rule } from './types';
import { validateRule } from './rules';
import { isServerComplete } from './server-completeness';
import { DIRECT_SERVER_ID } from './direct-selection';

export interface PortableConfigEffects {
  saved(previous: UserConfig, next: UserConfig): Promise<void>;
  removeServer(server: ServerConfig): Promise<void>;
  removeSubscription(id: string): void;
}

/** All hosts mutate the durable configuration first, then dispatch scoped dependency work. */
export class PortableConfigOperations {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly repository: ConfigRepository,
    private readonly effects: PortableConfigEffects
  ) {}
  private change<R>(
    mutation: (config: UserConfig) => R,
    cleanup?: (previous: UserConfig, next: UserConfig) => Promise<void>
  ): Promise<R> {
    const result = this.tail.then(async () => {
      const previous = await this.repository.read();
      let value!: R;
      const next = await this.repository.update((draft) => {
        value = mutation(draft);
      });
      if (cleanup) await cleanup(previous, next);
      if (JSON.stringify(previous) !== JSON.stringify(next))
        await this.effects.saved(previous, next);
      return value;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  save(config: UserConfig): Promise<void> {
    return this.change((draft) => {
      for (const key of Object.keys(draft))
        delete (draft as unknown as Record<string, unknown>)[key];
      Object.assign(draft, structuredClone(config));
    });
  }
  setValue<K extends keyof UserConfig>(key: K, value: UserConfig[K]): Promise<void> {
    if (['__proto__', 'constructor', 'prototype'].includes(String(key)))
      return Promise.reject(new Error('Invalid configuration key'));
    return this.change((draft) => {
      draft[key] = structuredClone(value);
    });
  }
  addServers(servers: Array<Omit<ServerConfig, 'id'>>): Promise<ServerConfig[]> {
    if (!servers.length) return Promise.resolve([]);
    return this.change((draft) => {
      const now = new Date().toISOString();
      const added = servers.map((source) => {
        const node = {
          ...structuredClone(source),
          id: crypto.randomUUID(),
          subscriptionId: undefined,
          providerName: undefined,
          createdAt: now,
          updatedAt: now,
        };
        if (!isServerComplete(node)) throw new Error('Incomplete node configuration');
        return node;
      });
      draft.servers.push(...added);
      return added;
    });
  }
  updateServer(server: ServerConfig): Promise<void> {
    if (!isServerComplete(server))
      return Promise.reject(new Error('Incomplete node configuration'));
    return this.change((draft) => {
      const index = draft.servers.findIndex((node) => node.id === server.id);
      if (index < 0) throw new Error('Node not found');
      const previous = draft.servers[index];
      draft.servers[index] = {
        ...structuredClone(server),
        subscriptionId: previous.subscriptionId,
        createdAt: previous.createdAt,
        updatedAt: new Date().toISOString(),
      };
    });
  }
  deleteServers(ids: string[], fallback?: string | null): Promise<number> {
    if (!ids.length) return Promise.resolve(0);
    const removed = new Set(ids);
    return this.change(
      (draft) => {
        const count = draft.servers.filter((node) => removed.has(node.id)).length;
        if (count !== removed.size) throw new Error('Node not found');
        draft.servers = draft.servers.filter((node) => !removed.has(node.id));
        if (draft.selectedServerId && removed.has(draft.selectedServerId))
          draft.selectedServerId =
            fallback && draft.servers.some((node) => node.id === fallback)
              ? fallback
              : DIRECT_SERVER_ID;
        for (const rule of draft.customRules)
          if (rule.targetServerId && removed.has(rule.targetServerId)) {
            rule.enabled = false;
            delete rule.targetServerId;
          }
        for (const rule of draft.appRules ?? [])
          if (rule.targetServerId && removed.has(rule.targetServerId)) {
            rule.enabled = false;
            delete rule.targetServerId;
          }
        return count;
      },
      async (previous) => {
        for (const node of previous.servers)
          if (removed.has(node.id)) await this.effects.removeServer(node);
      }
    );
  }
  switchServer(id: string): Promise<void> {
    return this.change((draft) => {
      if (id !== DIRECT_SERVER_ID && !draft.servers.some((node) => node.id === id))
        throw new Error('Node not found');
      draft.selectedServerId = id;
    });
  }
  addSubscription(
    source: Omit<SubscriptionConfig, 'id' | 'createdAt'>
  ): Promise<SubscriptionConfig> {
    return this.change((draft) => {
      const url = new URL(source.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !source.name.trim()
      )
        throw new Error('Invalid subscription');
      const sub = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      (draft.subscriptions ??= []).push(sub);
      return sub;
    });
  }
  updateSubscription(source: SubscriptionConfig): Promise<void> {
    return this.change((draft) => {
      const index = draft.subscriptions?.findIndex((sub) => sub.id === source.id) ?? -1;
      if (index < 0) throw new Error('Subscription not found');
      const url = new URL(source.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !source.name.trim()
      )
        throw new Error('Invalid subscription');
      const previous = draft.subscriptions![index];
      const next = { ...structuredClone(source), createdAt: previous.createdAt };
      if (next.url !== previous.url) {
        delete next.etag;
        delete next.lastModified;
      }
      draft.subscriptions![index] = next;
    });
  }
  async deleteSubscription(id: string): Promise<void> {
    const config = await this.repository.read();
    if (!config.subscriptions?.some((sub) => sub.id === id))
      throw new Error('Subscription not found');
    this.effects.removeSubscription(id);
    return this.change(
      (draft) => {
        if (!draft.subscriptions?.some((sub) => sub.id === id))
          throw new Error('Subscription not found');
        const removed = new Set(
          draft.servers.filter((node) => node.subscriptionId === id).map((node) => node.id)
        );
        draft.subscriptions = draft.subscriptions.filter((sub) => sub.id !== id);
        draft.servers = draft.servers.filter((node) => !removed.has(node.id));
        if (draft.selectedServerId && removed.has(draft.selectedServerId))
          draft.selectedServerId = DIRECT_SERVER_ID;
        for (const rule of [...draft.customRules, ...(draft.appRules ?? [])])
          if (rule.targetServerId && removed.has(rule.targetServerId)) {
            rule.enabled = false;
            delete rule.targetServerId;
          }
      },
      async (previous) => {
        for (const node of previous.servers)
          if (node.subscriptionId === id) await this.effects.removeServer(node);
      }
    );
  }
  addRule(source: Omit<Rule, 'id'>): Promise<Rule> {
    return this.change((draft) => {
      const rule = { ...structuredClone(source), id: crypto.randomUUID() };
      if (!validateRule(rule)) throw new Error('Invalid routing rule');
      draft.customRules.push(rule);
      return rule;
    });
  }
  updateRule(rule: Rule): Promise<void> {
    if (!validateRule(rule)) return Promise.reject(new Error('Invalid routing rule'));
    return this.change((draft) => {
      const index = draft.customRules.findIndex((item) => item.id === rule.id);
      if (index < 0) throw new Error('Rule not found');
      draft.customRules[index] = structuredClone(rule);
    });
  }
  deleteRule(id: string): Promise<void> {
    return this.change((draft) => {
      const index = draft.customRules.findIndex((rule) => rule.id === id);
      if (index < 0) throw new Error('Rule not found');
      draft.customRules.splice(index, 1);
    });
  }
  reorderRules(ids: string[]): Promise<void> {
    return this.change((draft) => {
      const byId = new Map(draft.customRules.map((rule) => [rule.id, rule]));
      if (
        ids.length !== byId.size ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !byId.has(id))
      )
        throw new Error('Rule order must contain every existing rule exactly once');
      draft.customRules = ids.map((id) => byId.get(id)!);
    });
  }
}
