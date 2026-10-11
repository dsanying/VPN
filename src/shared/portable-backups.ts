import type { ConfigRepository } from './config-repository';
import type { PortableConfigOperations } from './portable-config-operations';
import {
  BACKUP_CATEGORIES,
  countCategory,
  detectCategories,
  mergeCategories,
  pickCategories,
  type BackupCategory,
} from './backup-categories';
import { buildBackupInfo, parseBackupContent, sanitizeCrossPlatformRules } from './backup-format';
export interface BackupDocumentHost {
  exportDocument(options: { name: string; content: string }): Promise<{ canceled: boolean }>;
  importDocument(): Promise<{ canceled: boolean; content?: string }>;
  clientInfo(): Promise<{ appVersion: string; platform: string }>;
}
/** One-shot imported content stays in memory until apply; callers receive no arbitrary file path. */
export class PortableBackups {
  private picked?: {
    token: string;
    parsed: Exclude<ReturnType<typeof parseBackupContent>, { error: string }>;
  };
  constructor(
    private config: ConfigRepository,
    private operations: PortableConfigOperations,
    private host: BackupDocumentHost
  ) {}
  async export(categories?: BackupCategory[]) {
    const selected = this.categories(categories?.length ? categories : [...BACKUP_CATEGORIES]);
    const version = await this.host.clientInfo();
    const response = await this.host.exportDocument({
      name: `shadowvpn-backup-${new Date().toISOString().slice(0, 10)}.json`,
      content: JSON.stringify(
        {
          version: '1.0',
          appVersion: version.appVersion,
          platform: version.platform,
          exportedAt: new Date().toISOString(),
          config: pickCategories(await this.config.read(), selected),
        },
        null,
        2
      ),
    });
    return response.canceled ? { success: false, error: 'cancelled' } : { success: true };
  }
  async pick() {
    this.picked = undefined;
    const result = await this.host.importDocument();
    if (result.canceled) return { canceled: true };
    if (
      typeof result.content !== 'string' ||
      new TextEncoder().encode(result.content).length > 16 * 1024 * 1024
    )
      throw new Error('无效备份文件');
    const parsed = parseBackupContent(result.content);
    if ('error' in parsed) throw new Error('无法识别备份文件');
    const available = detectCategories(parsed.config);
    const token = crypto.randomUUID();
    this.picked = { token, parsed };
    return {
      canceled: false,
      filePath: token,
      available,
      counts: Object.fromEntries(
        available.map((category) => [category, countCategory(parsed.config, category)])
      ),
    };
  }
  async apply(token: unknown, categories: unknown) {
    if (!this.picked || token !== this.picked.token) throw new Error('请重新选择备份文件');
    const selected = this.categories(categories);
    const imported = this.picked;
    this.picked = undefined;
    const version = await this.host.clientInfo();
    const { config, skipped } = mergeCategories(
      await this.config.read(),
      imported.parsed.config,
      selected
    );
    const disabled = selected.includes('customRules')
      ? sanitizeCrossPlatformRules(config, imported.parsed.platform ?? 'unknown', version.platform)
      : 0;
    await this.operations.save(config);
    return {
      success: true,
      info: buildBackupInfo(await this.config.read(), disabled),
      ...(skipped.length ? { skipped } : {}),
    };
  }
  info() {
    return this.config.read().then((config) => buildBackupInfo(config));
  }
  private categories(value: unknown): BackupCategory[] {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.some((category) => !BACKUP_CATEGORIES.includes(category))
    )
      throw new Error('无效备份分类');
    return [...new Set(value)] as BackupCategory[];
  }
  close(): void {
    this.picked = undefined;
  }
}
