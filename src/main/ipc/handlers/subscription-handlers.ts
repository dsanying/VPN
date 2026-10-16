import { requestMeasurementRefresh } from '../../services/measurement-refresh';
import { SubscriptionMeasurementService } from '../../services/SubscriptionMeasurementService';
import { ipcEventEmitter } from '../ipc-events';
import { checkSubscriptionConnectivity } from '../../services/subscription-connectivity';
import type { SubscriptionConnectivity } from '../../../shared/subscription-connectivity';
import { IpcMainInvokeEvent, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import type { SubscriptionConfig, ImportParseResult, UserConfig } from '../../../shared/types';
import { registerIpcHandler } from '../ipc-handler';
import { SubscriptionService, SubscriptionUpdateResult } from '../../services/SubscriptionService';
import type { SubscriptionPreviewResult } from '../../../shared/subscription-preview';
import { ConfigManager } from '../../services/ConfigManager';
import { commitSubscriptionResult } from '../../../shared/subscription-commit';
import { mt } from '../../i18n';
import { randomUUID } from 'crypto';

/**
 * @param applyConfigForcingRestart §16.3.4b：手动订阅更新（节点集变化）→ 强制核去抖重启入池（绕 P2-A）。call-time 取
 *   proxyManager（对齐 scheduler 装配、防循环依赖）；缺省=不重启（如单测/无代理实例）。
 */
export function registerSubscriptionHandlers(
  subscriptionService: SubscriptionService,
  configManager: ConfigManager,
  applyConfigForcingRestart?: (config: UserConfig) => void,
  directPortProvider: () => number | null = () => null
): void {
  const measurements =
    typeof configManager.getConfigPath === 'function'
      ? new SubscriptionMeasurementService(
          configManager,
          directPortProvider,
          (records) =>
            ipcEventEmitter.sendToAll(IPC_CHANNELS.EVENT_SUBSCRIPTION_MEASUREMENTS, records),
          (value) =>
            ipcEventEmitter.sendToAll(IPC_CHANNELS.EVENT_SUBSCRIPTION_PROBE_PROGRESS, value)
        )
      : undefined;
  subscriptionMeasurements.set(configManager, measurements);
  registerIpcHandler(
    IPC_CHANNELS.SUBSCRIPTION_MEASUREMENTS,
    async () => measurements?.read() ?? {}
  );
  registerIpcHandler<{ subscriptionId: string }, SubscriptionConnectivity>(
    IPC_CHANNELS.SUBSCRIPTION_CONNECTIVITY,
    async (_event, args) => {
      if (typeof args?.subscriptionId !== 'string') throw new Error('Invalid subscription ID');
      if (measurements) return measurements.check(args.subscriptionId);
      const config = await configManager.loadConfig();
      const subscription = config.subscriptions?.find((item) => item.id === args.subscriptionId);
      if (!subscription) throw new Error('Subscription not found');
      return checkSubscriptionConnectivity(subscription, directPortProvider());
    }
  );
  registerIpcHandler<
    { subscription: Omit<SubscriptionConfig, 'id' | 'createdAt'> },
    SubscriptionConfig
  >(
    IPC_CHANNELS.SUBSCRIPTION_ADD,
    async (
      _event: IpcMainInvokeEvent,
      args: { subscription: Omit<SubscriptionConfig, 'id' | 'createdAt'> }
    ) => {
      const config = await configManager.loadConfig();
      if (!config.subscriptions) {
        config.subscriptions = [];
      }

      const now = new Date().toISOString();
      const newSubscription: SubscriptionConfig = {
        ...args.subscription,
        id: randomUUID(),
        createdAt: now,
      };

      config.subscriptions.push(newSubscription);
      await configManager.saveConfig(config);

      return newSubscription;
    }
  );

  registerIpcHandler<{ subscription: SubscriptionConfig }, void>(
    IPC_CHANNELS.SUBSCRIPTION_UPDATE,
    async (_event: IpcMainInvokeEvent, args: { subscription: SubscriptionConfig }) => {
      const config = await configManager.loadConfig();
      if (!config.subscriptions) return;

      const index = config.subscriptions.findIndex((s) => s.id === args.subscription.id);
      if (index === -1) {
        throw new Error(`订阅不存在: ${args.subscription.id}`);
      }

      const previous = config.subscriptions[index];
      const next = { ...args.subscription };
      if (previous.url !== next.url) {
        delete next.etag;
        delete next.lastModified;
      }
      config.subscriptions[index] = next;
      await configManager.saveConfig(config);
      requestMeasurementRefresh(configManager, { syncGroupIds: [next.id], groupIds: [next.id] });
    }
  );

  registerIpcHandler<{ subscriptionId: string }, void>(
    IPC_CHANNELS.SUBSCRIPTION_DELETE,
    async (_event: IpcMainInvokeEvent, args: { subscriptionId: string }) => {
      const config = await configManager.loadConfig();
      if (!config.subscriptions) return;

      const index = config.subscriptions.findIndex((s) => s.id === args.subscriptionId);
      if (index === -1) {
        throw new Error(`订阅不存在: ${args.subscriptionId}`);
      }

      config.subscriptions.splice(index, 1);

      config.servers = config.servers.filter((s) => s.subscriptionId !== args.subscriptionId);

      if (config.selectedServerId) {
        const stillExists = config.servers.some((s) => s.id === config.selectedServerId);
        if (!stillExists) {
          config.selectedServerId = null;
        }
      }

      await configManager.saveConfig(config);
    }
  );

  const syncFlights = new Map<string, Promise<SubscriptionUpdateResult>>();
  let commitTail = Promise.resolve();
  const commit = <T>(work: () => Promise<T>): Promise<T> => {
    const task = commitTail.then(work);
    commitTail = task.then(
      () => {},
      () => {}
    );
    return task;
  };
  const syncSubscription = async (
    subscriptionId: string,
    options?: { prepareOnly?: boolean }
  ): Promise<SubscriptionUpdateResult> => {
    const existing = syncFlights.get(subscriptionId);
    if (existing) return existing;
    const task = (async (): Promise<SubscriptionUpdateResult> => {
      let config = await configManager.loadConfig();
      if (!config.subscriptions) throw new Error('没有订阅配置');

      const candidate = config.subscriptions.find((s) => s.id === subscriptionId);
      if (!candidate) {
        throw new Error(`订阅不存在: ${subscriptionId}`);
      }

      let subscription = { ...candidate }; // Keep the request source stable across concurrent edits.
      try {
        // §16.3.4：条件 GET——provider 型订阅豁免（主正文 304 会掩盖 provider 独立变化）；否则带上次 validator。
        const conditional = subscription.hasProviders
          ? undefined
          : { etag: subscription.etag, lastModified: subscription.lastModified };
        const result = await subscriptionService.fetchSubscription(
          subscription.url,
          subscription.id,
          'auto',
          undefined,
          conditional
        );

        return await commit(async () => {
          const fresh = await configManager.loadConfig();
          const live = fresh.subscriptions?.find((item) => item.id === subscriptionId);
          if (!live || live.url !== subscription.url) {
            return {
              success: false,
              addedServers: 0,
              updatedServers: 0,
              deletedServers: 0,
              error: 'Subscription changed during synchronization',
            };
          }
          config = fresh;
          subscription = live;

          const committed = commitSubscriptionResult(
            config,
            subscription,
            result,
            new Date().toISOString(),
            SubscriptionService.reconcileServers,
            SubscriptionService.leftoverToKeep
          );
          await configManager.saveConfig(config);
          ipcEventEmitter.sendToAll(IPC_CHANNELS.EVENT_CONFIG_CHANGED, {
            newValue: { ...config, privacyPassword: undefined },
          });
          if (committed.restartRequired && !options?.prepareOnly)
            applyConfigForcingRestart?.(config);
          return committed.result;
        });
      } catch (error: any) {
        return {
          success: false,
          addedServers: 0,
          updatedServers: 0,
          deletedServers: 0,
          error: error.message,
        };
      }
    })();
    syncFlights.set(subscriptionId, task);
    try {
      return await task;
    } finally {
      syncFlights.delete(subscriptionId);
    }
  };
  subscriptionSynchronizers.set(configManager, syncSubscription);
  registerIpcHandler<{ subscriptionId: string }, SubscriptionUpdateResult>(
    IPC_CHANNELS.SUBSCRIPTION_UPDATE_SERVERS,
    async (_event, args) => syncSubscription(args.subscriptionId)
  );

  // 订阅预检（新增订阅前先行，不写 config）：拉取+解析 URL 返回节点数或分类错误，成功才建记录（避免先加后删闪现）。
  registerIpcHandler<
    {
      url: string;
    },
    SubscriptionPreviewResult
  >(
    IPC_CHANNELS.SUBSCRIPTION_PREVIEW,
    async (
      _event: IpcMainInvokeEvent,
      args: {
        url: string;
      }
    ) => {
      return subscriptionService.previewSubscription(args.url);
    }
  );

  // 本地导入解析（不联网）：文件/文本 → 预览（自建节点 + Clash 订阅条目 + 统计）。不可识别格式 throw → 渲染端门控报错。
  registerIpcHandler<{ text: string }, ImportParseResult>(
    IPC_CHANNELS.LOCAL_IMPORT_PARSE,
    async (_event: IpcMainInvokeEvent, args: { text: string }) => {
      return subscriptionService.parseLocalContent(args?.text ?? '');
    }
  );

  // 本地导入选文件：弹系统原生文件对话框 + 读内容回传。替代渲染端 HTML <input type=file>——避开 Chromium 原生
  // 控件英文文案（"Choose File / No file chosen"，受 Chromium app locale 控、非 i18next），系统对话框天然跟随
  // 系统语言、文件名+按钮走 i18next；10 MB 上限与解析门限（local-import-dialog）一致。取消返 canceled，读失败返 error。
  registerIpcHandler<
    void,
    { canceled: boolean; content?: string; fileName?: string; error?: 'too_large' | 'read_failed' }
  >(IPC_CHANNELS.LOCAL_IMPORT_PICK_FILE, async (_event: IpcMainInvokeEvent) => {
    const result = await dialog.showOpenDialog({
      title: mt('localImportPickTitle'),
      filters: [
        { name: mt('localImportFilterConfig'), extensions: ['json', 'yaml', 'yml', 'txt', 'conf'] },
        { name: mt('localImportFilterAll'), extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 10 * 1024 * 1024) {
        return { canceled: false, error: 'too_large' };
      }
      const content = await fs.readFile(filePath, 'utf-8');
      return { canceled: false, content, fileName: path.basename(filePath) };
    } catch {
      return { canceled: false, error: 'read_failed' };
    }
  });

  // 周期更新由 GlobalUpdateService 接管，手动同步共用同一入口，不另设 UPDATE_ALL。
}

const subscriptionMeasurements = new WeakMap<
  ConfigManager,
  SubscriptionMeasurementService | undefined
>();
export function getSubscriptionMeasurements(
  manager: ConfigManager
): SubscriptionMeasurementService | undefined {
  return subscriptionMeasurements.get(manager);
}

const subscriptionSynchronizers = new WeakMap<
  ConfigManager,
  (id: string, options?: { prepareOnly?: boolean }) => Promise<SubscriptionUpdateResult>
>();
export function getSubscriptionSynchronizer(manager: ConfigManager) {
  return subscriptionSynchronizers.get(manager);
}
