import { requestMeasurementRefresh } from '../../services/measurement-refresh';
/**
 * 数据备份与恢复 IPC 处理器（选择性导入导出）
 * 导出：按勾选类别 pickCategories；导入：①PICK 弹文件返回类目录 → ②APPLY 按勾选 mergeCategories（整类替换+空跳过）。
 */

import { IpcMainInvokeEvent, dialog, app } from 'electron';
import * as fs from 'fs/promises';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { isEndpointProtocol } from '../../../shared/endpoint-routes';
import {
  pickCategories,
  mergeCategories,
  detectCategories,
  countCategory,
  BACKUP_CATEGORIES,
  type BackupCategory,
} from '../../../shared/backup-categories';
import { registerIpcHandler } from '../ipc-handler';
import { ConfigManager } from '../../services/ConfigManager';
import { ipcEventEmitter } from '../ipc-events';
import { mainEventEmitter, MAIN_EVENTS } from '../main-events';

import {
  parseBackupContent,
  sanitizeCrossPlatformRules,
  buildBackupInfo,
  type BackupFileFormat,
  type BackupInfo,
} from '../../../shared/backup-format';
const IMPORT_FILTERS = [
  { name: 'FlowZ 备份文件', extensions: ['flowz-backup'] },
  { name: 'JSON 文件', extensions: ['json'] },
  { name: '所有文件', extensions: ['*'] },
];

export function registerBackupHandlers(
  configManager: ConfigManager,
  prepareRoutingData: () => Promise<void>
): void {
  // ── 导出备份（按勾选类别）──────────────────────────────────────────────────
  registerIpcHandler<
    { categories?: BackupCategory[] },
    { success: boolean; filePath?: string; error?: string }
  >(IPC_CHANNELS.BACKUP_EXPORT, async (_event: IpcMainInvokeEvent, args) => {
    try {
      const config = await configManager.loadConfig();
      const selected = args?.categories?.length ? args.categories : [...BACKUP_CATEGORIES];
      const picked = pickCategories(config, selected);

      const backup: BackupFileFormat = {
        version: '1.0',
        appVersion: app.getVersion(),
        platform: process.platform,
        exportedAt: new Date().toISOString(),
        config: picked,
      };

      const result = await dialog.showSaveDialog({
        title: '导出 FlowZ 配置备份',
        defaultPath: `flowz-backup-${new Date().toISOString().slice(0, 10)}.flowz-backup`,
        filters: [
          { name: 'FlowZ 备份文件', extensions: ['flowz-backup'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'cancelled' };
      }

      await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf-8');
      return { success: true, filePath: result.filePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[BackupHandlers] Export failed:', message);
      return { success: false, error: message };
    }
  });

  // ── 导入①PICK：弹文件框 + 解析 → 返回备份含哪些类 + 各类数量（不 apply）──────────
  registerIpcHandler<
    void,
    {
      canceled: boolean;
      filePath?: string;
      available?: BackupCategory[];
      counts?: Partial<Record<BackupCategory, number>>;
      error?: string;
    }
  >(IPC_CHANNELS.BACKUP_IMPORT_PICK, async (_event: IpcMainInvokeEvent) => {
    const result = await dialog.showOpenDialog({
      title: '导入 FlowZ 配置备份',
      filters: IMPORT_FILTERS,
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch {
      return { canceled: false, error: 'read_failed' };
    }
    const parsed = parseBackupContent(raw);
    if ('error' in parsed) {
      return { canceled: false, error: parsed.error };
    }
    const available = detectCategories(parsed.config);
    const counts: Partial<Record<BackupCategory, number>> = {};
    for (const cat of available) counts[cat] = countCategory(parsed.config, cat);
    return { canceled: false, filePath, available, counts };
  });

  // ── 导入②APPLY：按所选类整类替换 + 空跳过 + 跨平台 sanitize + 保存 ─────────────
  registerIpcHandler<
    { filePath: string; categories: BackupCategory[] },
    { success: boolean; info?: BackupInfo; skipped?: BackupCategory[]; error?: string }
  >(IPC_CHANNELS.BACKUP_IMPORT_APPLY, async (_event: IpcMainInvokeEvent, args) => {
    try {
      if (!args?.filePath || !args.categories?.length) {
        return { success: false, error: 'invalid_args' };
      }
      let raw: string;
      try {
        raw = await fs.readFile(args.filePath, 'utf-8');
      } catch {
        return { success: false, error: 'read_failed' };
      }
      const parsed = parseBackupContent(raw);
      if ('error' in parsed) {
        return { success: false, error: parsed.error };
      }

      const current = await configManager.loadConfig();
      const { config: merged, skipped } = mergeCategories(current, parsed.config, args.categories);

      // 仅当导入了自定义规则才需 sanitize（其余类无进程规则）。
      let crossPlatformDisabledRules = 0;
      if (args.categories.includes('customRules')) {
        crossPlatformDisabledRules = sanitizeCrossPlatformRules(
          merged,
          parsed.platform,
          process.platform
        );
        if (crossPlatformDisabledRules > 0) {
          console.log(
            `[BackupHandlers] 跨平台导入（${parsed.platform}→${process.platform}）：禁用 ${crossPlatformDisabledRules} 条进程规则（保留供重映射）`
          );
        }
      }

      // 通过 ConfigManager 保存（内部 validateConfig 校验）。失效 selectedServerId 已在 mergeCategories
      // 末尾归零（validateConfig 对失效引用是 throw、非归零，否则整份导入失败）。
      await configManager.saveConfig(merged);

      // 重新 loadConfig 让迁移（含 FakeIP-TUN 待纠正评估）对导入配置即时生效，再广播 fresh——否则导入的 systemProxy
      // 冻结态直接广播 merged（flag 未评估）会漏掉 FakeIP-TUN 纠正窗口、被同会话切 TUN 永久消费。
      const fresh = await configManager.loadConfig();
      ipcEventEmitter.sendToAll('event:configChanged', { newValue: fresh });
      mainEventEmitter.emit(MAIN_EVENTS.CONFIG_CHANGED, fresh);
      const importedGroups = args.categories.includes('subscriptions')
        ? (fresh.subscriptions ?? []).map((sub) => sub.id)
        : [];
      requestMeasurementRefresh(configManager, {
        all: ['manualNodes', 'meshNodes', 'subscriptions'].every((category) =>
          args.categories.includes(category as BackupCategory)
        ),
        groupIds: importedGroups,
        syncGroupIds: importedGroups,
        nodeIds: fresh.servers
          .filter(
            (node) =>
              !node.subscriptionId &&
              args.categories.includes(
                isEndpointProtocol(node.protocol) ? 'meshNodes' : 'manualNodes'
              )
          )
          .map((node) => node.id),
      });

      // Prepare only internal geographic and LAN routing data after restoring settings.
      void prepareRoutingData().catch(() =>
        console.warn('[BackupHandlers] Routing data restore failed')
      );

      const info = buildBackupInfo(merged, crossPlatformDisabledRules);
      return { success: true, info, skipped: skipped.length ? skipped : undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[BackupHandlers] Import apply failed:', message);
      return { success: false, error: message };
    }
  });

  // ── 获取当前配置摘要 ──────────────────────────────────────────────────────
  registerIpcHandler<void, BackupInfo>(
    IPC_CHANNELS.BACKUP_GET_INFO,
    async (_event: IpcMainInvokeEvent) => {
      const config = await configManager.loadConfig();
      return buildBackupInfo(config);
    }
  );
}
