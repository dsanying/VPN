import { DEFAULT_SPEED_TEST_URL } from '../../../shared/speed-test';
import {
  measurementRefreshEvents,
  measurementConfigSnapshot,
  changedMeasurementScope,
  type MeasurementConfigSnapshot,
  type MeasurementRefreshScope,
} from '../../services/measurement-refresh';
import type { UserConfig } from '../../../shared/types';
import { measurementExpired } from '../../../shared/node-availability';
import { MEASUREMENT_COALESCE_MS } from '../../../shared/background-refresh';
/**
 * 测速相关 IPC 处理器。
 *
 * 复用唯一编排器 runSpeedTest——与托盘入口同源传播（渲染逐节点广播 + 进度 + 托盘回写 + 测速态），
 * 修复历史漂移「服务器页/首页测速不同步到托盘服务器列表」（旧实现此处只广播、漏了 trayManager 回写）。
 */

import { mainEventEmitter, MAIN_EVENTS } from '../main-events';
import { getSubscriptionMeasurements, getSubscriptionSynchronizer } from './subscription-handlers';
import { isSpeedTestable } from '../../../shared/endpoint-routes';
import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import type { SpeedTestInvokeResult } from '../../../shared/speed-test';
import { registerIpcHandler } from '../ipc-handler';
import {
  runSpeedTest,
  getNodeMeasurementStore,
  type SpeedTestRunnerDeps,
} from '../../services/speed-test-runner';

export function registerSpeedTestHandlers(
  deps: SpeedTestRunnerDeps
): (missingOnly?: boolean) => Promise<void> {
  deps.speedTestService.enableRegionDetection();
  registerIpcHandler(IPC_CHANNELS.SERVER_MEASUREMENTS, async () => {
    const config = await deps.configManager.loadConfig();
    return (
      (await getNodeMeasurementStore(deps.configManager)?.get(
        config.servers,
        DEFAULT_SPEED_TEST_URL
      )) ?? {}
    );
  });
  let flight: Promise<void> | undefined;
  let pendingMissing = false;
  let pendingAll = false;
  let previous: MeasurementConfigSnapshot | undefined;
  const pendingGroups = new Map<string, number>();
  const pendingNodes = new Map<string, number>();
  const pendingLinks = new Map<string, number>();
  const pendingSync = new Set<string>();
  let pendingForcedAll: number | undefined;
  const mergeScope = (scope: MeasurementRefreshScope) => {
    const requestedAt = Date.now();
    if (scope.all) pendingForcedAll = requestedAt;
    for (const id of scope.syncGroupIds ?? []) {
      pendingSync.add(id);
      pendingGroups.set(id, requestedAt);
      pendingLinks.set(id, requestedAt);
    }
    for (const id of scope.groupIds ?? []) pendingGroups.set(id, requestedAt);
    for (const id of scope.nodeIds ?? []) pendingNodes.set(id, requestedAt);
    for (const id of scope.subscriptionIds ?? []) pendingLinks.set(id, requestedAt);
  };
  const refresh = (missingOnly = true): Promise<void> => {
    pendingMissing = true;
    if (!missingOnly) pendingAll = true;
    if (flight) return flight;
    flight = (async () => {
      while (pendingMissing) {
        const all = pendingAll;
        pendingMissing = false;
        pendingAll = false;
        // Capture one batch. Events arriving during I/O remain pending for the next batch.
        const groups = new Map(pendingGroups);
        const requestedNodes = new Map(pendingNodes);
        const requestedLinks = new Map(pendingLinks);
        const forcedAll = pendingForcedAll;
        const syncGroups = [...pendingSync];
        pendingSync.clear();
        pendingGroups.clear();
        pendingNodes.clear();
        pendingLinks.clear();
        pendingForcedAll = undefined;
        const before = await deps.configManager.loadConfig();
        previous ??= measurementConfigSnapshot(before);
        const synchronize = getSubscriptionSynchronizer(deps.configManager);
        if (synchronize) {
          const queue = syncGroups.filter((id) =>
            before.subscriptions?.some((sub) => sub.id === id)
          );
          await Promise.all(
            Array.from({ length: Math.min(2, queue.length) }, async () => {
              for (let id = queue.shift(); id; id = queue.shift()) {
                try {
                  const result = await synchronize(id);
                  if (!result.success)
                    deps.logManager.addLog(
                      'warn',
                      `Automatic subscription synchronization failed: ${result.error ?? 'unknown'}`,
                      'Subscription'
                    );
                } catch (error) {
                  deps.logManager.addLog(
                    'warn',
                    `Automatic subscription synchronization failed: ${String(error)}`,
                    'Subscription'
                  );
                }
              }
            })
          );
        }
        if (forcedAll !== undefined)
          for (const sub of before.subscriptions ?? []) requestedLinks.set(sub.id, forcedAll);
        for (const [id, time] of groups) requestedLinks.set(id, time);
        const links = getSubscriptionMeasurements(deps.configManager);
        await links?.refresh(!all, requestedLinks);
        const config = await deps.configManager.loadConfig();
        const store = getNodeMeasurementStore(deps.configManager);
        await store?.save(config.servers, DEFAULT_SPEED_TEST_URL, {});
        const records = (await store?.get(config.servers, DEFAULT_SPEED_TEST_URL)) ?? {};
        const nodes = config.servers.filter(
          (node) =>
            isSpeedTestable(node, { mainCorePool: !!deps.isTunActive?.() }) &&
            (((forcedAll !== undefined ||
              requestedNodes.has(node.id) ||
              (node.subscriptionId && groups.has(node.subscriptionId))) &&
              (!records[node.id] ||
                records[node.id].testedAt <=
                  Math.max(
                    forcedAll ?? -1,
                    requestedNodes.get(node.id) ?? -1,
                    groups.get(node.subscriptionId ?? '') ?? -1
                  ))) ||
              (all && Date.now() - records[node.id]?.testedAt >= MEASUREMENT_COALESCE_MS) ||
              !records[node.id] ||
              measurementExpired(records[node.id].testedAt, Date.now()) ||
              records[node.id].detail?.entry.reason === 'ENTRY_RECHECK_REQUIRED')
        );
        if (nodes.length) await runSpeedTest(deps, { serverIds: nodes.map((node) => node.id) });
      }
    })()
      .catch((error) =>
        deps.logManager.addLog(
          'warn',
          `Background measurements failed: ${error instanceof Error ? error.message : String(error)}`,
          'SpeedTest'
        )
      )
      .finally(() => {
        flight = undefined;
      });
    return flight;
  };
  const saved = (manager: object, config: UserConfig) => {
    if (manager !== deps.configManager) return;
    const next = measurementConfigSnapshot(config);
    if (previous) mergeScope(changedMeasurementScope(previous, next));
    previous = next; // Immutable projection: ConfigManager callers may mutate the same object later.
    void refresh();
  };
  measurementRefreshEvents.on('saved', saved);
  measurementRefreshEvents.on('refresh', (manager: object, scope: MeasurementRefreshScope) => {
    if (manager !== deps.configManager) return;
    mergeScope(scope);
    void refresh();
  });
  const changed = () => void refresh();
  mainEventEmitter.on(MAIN_EVENTS.CONFIG_CHANGED, changed);
  void refresh();
  // 服务器测速（serverIds 缺省=全部；逐节点结果/进度由 runSpeedTest 广播，托盘同步回写）
  registerIpcHandler<{ serverIds?: string[] }, SpeedTestInvokeResult>(
    IPC_CHANNELS.SERVER_SPEED_TEST,
    async (_event: IpcMainInvokeEvent, args?: { serverIds?: string[] }) => {
      const runResult = await runSpeedTest(deps, { serverIds: args?.serverIds });
      const results: Record<string, number> = {};
      for (const [id, latency] of runResult.results.entries()) {
        results[id] = latency === null ? -1 : latency;
      }
      // §16.2/§16.3.3：outcome（interrupted → toast「测速中断」）+ 波前缺席两列表（notInPool 徽标信号 + tsNotReady，
      // 合计供 toast 副行「N 未纳入」）随结果回传。
      return {
        results,
        details: runResult.details,
        outcome: runResult.outcome,
        notInPool: runResult.skipped.notInPool,
        tsNotReady: runResult.skipped.tsNotReady,
      };
    }
  );
  return refresh;
}
