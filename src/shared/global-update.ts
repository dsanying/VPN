export type UpdateKind = 'software' | 'core' | 'data' | 'subscriptions';
export interface GlobalUpdateItem {
  kind: UpdateKind;
  status: 'latest' | 'applied' | 'ready' | 'error' | 'unsupported' | 'incompatible';
  version?: string;
  revision?: string;
  restart?: 'software' | 'proxy';
  error?: string;
}
export interface GlobalUpdateSnapshot {
  checking: boolean;
  lastCheckedAt: number | null;
  items: GlobalUpdateItem[];
}
