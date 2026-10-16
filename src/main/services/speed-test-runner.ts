import { isIP } from 'net';
import { isGeolocatableAddress, NodeRegionService } from './NodeRegionService';
import { nodeRegionCode, nodeRegionEvidence } from '../../shared/node-identity';
import { DEFAULT_SPEED_TEST_URL } from '../../shared/speed-test';
import { NodeMeasurementStore, measurementFingerprint } from './NodeMeasurementStore';
import * as path from 'path';
import { probeNodeEntry, probeBoundEntry, quicEntryObfs } from './entry-probe';
import { SPEED_TEST_CONCURRENCY, type NodeProbeDetails } from '../../shared/speed-test';
/**
 * 测速编排单一入口（根治：托盘 + 渲染 IPC 两入口都只调它）。
 *
 * 历史病灶：托盘 onSpeedTest 与渲染 IPC speed-test-handlers 各自手写「testAllServers + 广播 + 回写托盘」，
 * 必然漂移——IPC 入口漏了 `trayManager.updateSpeedTestResults`，导致服务器页测速不同步到托盘列表。
 * 此函数把全部传播副作用（渲染逐节点广播 + 进度广播 + 托盘回写 + 测速态）收敛在唯一一处，
 * 结构上杜绝再次漂移；新增入口只需调它，自动获得一致传播。
 */
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { SpeedTestRunResult } from '../../shared/speed-test';
import type { ConfigManager } from './ConfigManager';
import type { SpeedTestService } from './SpeedTestService';
import type { TrayManager } from './TrayManager';
import type { LogManager } from './LogManager';
import type { UserConfig, ServerConfig } from '../../shared/types';

export interface SpeedTestRunnerDeps {
  configManager: ConfigManager;
  speedTestService: SpeedTestService;
  /** call-time 取当前主窗口（广播逐节点结果/进度到渲染层 latencyMap）。 */
  getMainWindow: () => BrowserWindow | null;
  /** call-time 取托盘管理器（回写测速结果与测速态；可能尚未创建/已销毁）。 */
  getTrayManager: () => TrayManager | null;
  logManager: LogManager;
  enterpriseProbe?: (
    node: ServerConfig,
    interactive?: boolean
  ) => Promise<Pick<NodeProbeDetails, 'availability' | 'proxyReason'>>;
  regionLookup?: (ip?: string) => Promise<NodeProbeDetails['gateway']>;
  entryProbe?: typeof probeNodeEntry;
  entryHelperPath?: string;
  /** Read runtime takeover, not a saved preference; stopped TUN must not disable direct probes. */
  isTunActive?: () => boolean;
}

const measurementStores = new WeakMap<ConfigManager, NodeMeasurementStore>();
export function getNodeMeasurementStore(manager: ConfigManager): NodeMeasurementStore | undefined {
  if (typeof manager.getConfigPath !== 'function') return undefined;
  let store = measurementStores.get(manager);
  if (!store) {
    store = new NodeMeasurementStore(
      path.join(path.dirname(manager.getConfigPath()), 'node-measurements.json')
    );
    measurementStores.set(manager, store);
  }
  return store;
}

/**
 * 运行一次测速并统一传播结果。
 * @param opts.serverIds 限定测速子集（缺省=全部 servers）；不可测节点由 SpeedTestService 内部按 isSpeedTestable 剔除。
 * @returns SpeedTestRunResult（结果 Map + outcome completed/interrupted + 波前缺席集 §16.2）。
 */
const runnerRuns = new WeakMap<
  ConfigManager,
  { key: string; promise: Promise<SpeedTestRunResult> }
>();
export async function runSpeedTest(
  deps: SpeedTestRunnerDeps,
  opts: { serverIds?: string[]; notifyTrayToast?: boolean; interactive?: boolean } = {}
): Promise<SpeedTestRunResult> {
  const config = await deps.configManager.loadConfig();
  const requested = opts.serverIds
    ? config.servers.filter((node) => opts.serverIds!.includes(node.id))
    : config.servers;
  const key = JSON.stringify({
    nodes: requested
      .map((node) => [node.id, measurementFingerprint(node, DEFAULT_SPEED_TEST_URL)])
      .sort(),
    toast: !!opts.notifyTrayToast,
    interactive: !!opts.interactive,
  });
  const previous = runnerRuns.get(deps.configManager);
  if (previous?.key === key) return previous.promise;
  // Include entry probes, cache writes and tray propagation in the single-flight lifetime.
  const promise = previous
    ? previous.promise
        .catch(() => {})
        .then(async () => runSpeedTestInternal(deps, opts, await deps.configManager.loadConfig()))
    : runSpeedTestInternal(deps, opts, config);
  runnerRuns.set(deps.configManager, { key, promise });
  const clear = () => {
    if (runnerRuns.get(deps.configManager)?.promise === promise)
      runnerRuns.delete(deps.configManager);
  };
  void promise.then(clear, clear);
  return promise;
}
async function runSpeedTestInternal(
  deps: SpeedTestRunnerDeps,
  opts: { serverIds?: string[]; notifyTrayToast?: boolean; interactive?: boolean },
  config: UserConfig
): Promise<SpeedTestRunResult> {
  const { configManager, speedTestService, getMainWindow, getTrayManager, logManager } = deps;
  const servers = opts.serverIds
    ? config.servers.filter((s) => opts.serverIds!.includes(s.id))
    : config.servers;

  // 无节点可测：早退。本函数自身不置测速态（避免菜单闪一下「测速中」），但托盘入口 handleSpeedTest 在调用前
  // 已无条件置 isSpeedTesting=true → 必须在此复位，否则 0 节点时托盘永久卡「测速中」。复位幂等：渲染入口未置态时 no-op。
  if (servers.length === 0) {
    logManager.addLog('info', 'Speed test skipped: no servers', 'SpeedTest');
    getTrayManager()?.setSpeedTesting(false);
    return { results: new Map(), outcome: 'completed', skipped: { notInPool: [], tsNotReady: [] } };
  }

  const send = (channel: string, payload: unknown) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // 任意入口触发都让托盘菜单进入「测速中」态（与 UI 一致；幂等，已是该态则 no-op）。
  getTrayManager()?.setSpeedTesting(true);
  send(IPC_CHANNELS.EVENT_SPEED_TEST_PROGRESS, {
    tested: 0,
    ok: 0,
    total: servers.length,
    serverIds: servers.map((node) => node.id),
    active: true,
  });
  const details: Record<string, NodeProbeDetails> = {};
  const offMeasurement = speedTestService.onNodeMeasurement?.((id, value) => {
    if (!details[id] || !servers.some((node) => node.id === id)) return;
    details[id] = {
      ...details[id],
      proxyTarget: value.target,
      proxyReason: value.reason,
      ...(value.exit ? { exit: value.exit } : {}),
    };
    send(IPC_CHANNELS.EVENT_SPEED_TEST_DETAILS, { serverId: id, detail: details[id] });
  });
  try {
    const regionService = new NodeRegionService();
    const lookupRegion = async (ip?: string) => {
      const observation = await (
        deps.regionLookup ?? ((value?: string) => regionService.lookup(value))
      )(ip);
      return (
        observation ??
        (ip && isIP(ip)
          ? {
              ip,
              measuredAt: 0,
              provider: 'unavailable',
              reason: isGeolocatableAddress(ip)
                ? ('lookup-failed' as const)
                : ('non-public-address' as const),
            }
          : undefined)
      );
    };
    const entryJobs: Promise<void>[] = [];
    const gatewayJobs: Promise<void>[] = [];
    const entryQueue: (() => Promise<void>)[] = [];
    let activeEntries = 0;
    const drainEntries = () => {
      while (activeEntries < SPEED_TEST_CONCURRENCY && entryQueue.length > 0) {
        const task = entryQueue.shift()!;
        activeEntries++;
        void task().finally(() => {
          activeEntries--;
          drainEntries();
        });
      }
    };
    const enqueueEntry = (task: () => Promise<void>) =>
      new Promise<void>((resolve, reject) => {
        // 每个排队任务都有完成 Promise；不等一个固定 lane 的慢任务。
        entryQueue.push(() => Promise.resolve().then(task).then(resolve, reject));
        drainEntries();
      });
    const runResult = await speedTestService.testAllServers(
      servers.filter((node) => node.protocol !== 'enterprise'),
      (serverId, latency) => {
        send(IPC_CHANNELS.EVENT_SPEED_TEST_RESULT, {
          serverId,
          latency: latency === null ? -1 : latency,
        });
        const server = servers.find((server) => server.id === serverId);
        if (!server) return;
        const job = enqueueEntry(async () => {
          let entry;
          let gatewayIp: string | undefined;
          try {
            entry = await (deps.entryProbe ?? probeNodeEntry)(server, !deps.isTunActive?.(), {
              onAddress: (ip) => {
                gatewayIp = ip;
              },
              ...(deps.entryHelperPath
                ? {
                    boundProbe: (address: string, port: number, signal?: AbortSignal) =>
                      probeBoundEntry(address, port, deps.entryHelperPath!, signal),
                    boundQUICProbe: (address: string, port: number, signal?: AbortSignal) =>
                      probeBoundEntry(
                        address,
                        port,
                        deps.entryHelperPath!,
                        signal,
                        'quic',
                        quicEntryObfs(server)
                      ),
                  }
                : {}),
            });
          } catch {
            entry = { status: 'unavailable' as const, reason: 'ENTRY_PROBE_FAILED' };
          }
          const measured = speedTestService.getNodeMeasurement(serverId);
          const detail = {
            entry,
            proxyTarget: measured?.target,
            proxyReason: measured?.reason,
            ...(measured?.exit ? { exit: measured.exit } : {}),
          };
          details[serverId] = detail;
          send(IPC_CHANNELS.EVENT_SPEED_TEST_DETAILS, { serverId, detail });
          if (gatewayIp && !measured?.exit?.countryCode) {
            const gateway = await lookupRegion(gatewayIp);
            details[serverId] = { ...details[serverId], gateway };
            send(IPC_CHANNELS.EVENT_SPEED_TEST_DETAILS, { serverId, detail: details[serverId] });
          }
        });
        // 主测速仍进行时可能已有入口任务失败；最终 Promise.all 负责传播错误。
        void job.catch(() => {});
        entryJobs.push(job);
      },
      (tested, ok) =>
        send(IPC_CHANNELS.EVENT_SPEED_TEST_PROGRESS, { tested, ok, total: servers.length }),
      DEFAULT_SPEED_TEST_URL
    );
    // Enterprise authentication is serialized to avoid simultaneous login prompts and account retries.
    for (const node of servers.filter((node) => node.protocol === 'enterprise')) {
      let gatewayIp: string | undefined;
      const entry = await (deps.entryProbe ?? probeNodeEntry)(node, !deps.isTunActive?.(), {
        onAddress: (ip) => {
          gatewayIp = ip;
        },
        ...(deps.entryHelperPath
          ? {
              boundProbe: (address, port, signal) =>
                probeBoundEntry(address, port, deps.entryHelperPath!, signal),
            }
          : {}),
      }).catch(() => ({ status: 'unavailable' as const, reason: 'ENTRY_PROBE_FAILED' }));
      details[node.id] = { entry };
      send(IPC_CHANNELS.EVENT_SPEED_TEST_DETAILS, { serverId: node.id, detail: details[node.id] });
      const gatewayTask = lookupRegion(gatewayIp).then((gateway) => {
        details[node.id] = { ...details[node.id], gateway };
        send(IPC_CHANNELS.EVENT_SPEED_TEST_DETAILS, {
          serverId: node.id,
          detail: details[node.id],
        });
      });
      void gatewayTask.catch(() => {});
      gatewayJobs.push(gatewayTask);
      const evidence =
        entry.status === 'ok' && deps.enterpriseProbe
          ? await deps.enterpriseProbe(node, opts.interactive)
          : {
              availability:
                entry.status === 'failed' || entry.status === 'timeout'
                  ? ('failed' as const)
                  : ('unknown' as const),
              proxyReason:
                entry.status === 'ok' ? 'enterprise-engine-unavailable' : 'enterprise-entry-failed',
            };
      const detail: NodeProbeDetails = { ...details[node.id], entry, ...evidence };
      details[node.id] = detail;
      runResult.results.set(node.id, null); // No invented proxy latency: availability is independent evidence.
      send(IPC_CHANNELS.EVENT_SPEED_TEST_RESULT, { serverId: node.id, latency: -1 });
      send(IPC_CHANNELS.EVENT_SPEED_TEST_DETAILS, { serverId: node.id, detail });
      send(IPC_CHANNELS.EVENT_SPEED_TEST_PROGRESS, {
        tested: runResult.results.size,
        ok:
          [...runResult.results.values()].filter((value) => value !== null && value >= 0).length +
          Object.values(details).filter((detail) => detail.availability === 'available').length,
        total: servers.length,
      });
    }
    await Promise.all([...entryJobs, ...gatewayJobs]);
    let nodeRegions: Record<string, string | undefined> | undefined;
    let nodeRegionSources: Record<string, 'gateway' | 'exit' | undefined> | undefined;
    const store = getNodeMeasurementStore(configManager);
    if (store) {
      try {
        const measuredAt = Date.now();
        const latest = await configManager.loadConfig();
        await store.save(
          latest.servers,
          DEFAULT_SPEED_TEST_URL,
          Object.fromEntries(
            [...runResult.results]
              .filter(([id]) => servers.some((node) => node.id === id))
              .map(([id, latency]) => [
                id,
                {
                  fingerprint: measurementFingerprint(
                    servers.find((node) => node.id === id)!,
                    DEFAULT_SPEED_TEST_URL
                  ),
                  latency: latency ?? -1,
                  testedAt: measuredAt,
                  detail: details[id],
                },
              ])
          )
        );
        const saved = await store.get(latest.servers, DEFAULT_SPEED_TEST_URL);
        nodeRegions = Object.fromEntries(
          Object.entries(saved).map(([id, record]) => [id, nodeRegionCode(record.detail)])
        );
        nodeRegionSources = Object.fromEntries(
          Object.entries(saved).map(([id, record]) => [
            id,
            nodeRegionEvidence(record.detail)?.source,
          ])
        );
        for (const id of Object.keys(details))
          if (saved[id]?.detail) {
            details[id] = saved[id].detail!;
            send(IPC_CHANNELS.EVENT_SPEED_TEST_DETAILS, { serverId: id, detail: details[id] });
          }
      } catch {
        logManager.addLog('warn', 'Node measurement cache could not be saved', 'SpeedTest');
      }
    }
    const result = { ...runResult, details: { ...runResult.details, ...details } };
    // 唯一回写托盘点：合并入托盘延迟显示（不替换 → 子集/单节点测速不塌缩）+ isSpeedTesting=false + 菜单重建。
    // toast 仅托盘入口（notifyTrayToast=true）触发——渲染入口（服务器页/首页）测速由 use-speed-test 自弹，避免双 toast。
    // §16.2：outcome + 波前缺席数透传给托盘 toast（interrupted → 「测速中断」；skipped → 副行「N 未纳入」，见 App.tsx）。
    getTrayManager()?.updateSpeedTestResults(runResult.results, config.servers, {
      ...(nodeRegions ? { nodeRegions, nodeRegionSources } : {}),
      toast: opts.notifyTrayToast,
      outcome: runResult.outcome,
      skipped: runResult.skipped.notInPool.length + runResult.skipped.tsNotReady.length,
    });
    return result;
  } catch (error) {
    logManager.addLog(
      'error',
      `Speed test failed: ${error instanceof Error ? error.message : String(error)}`,
      'SpeedTest'
    );
    getTrayManager()?.setSpeedTesting(false); // 仅复位测速态、保留已有托盘延迟（不清空）
    throw error;
  } finally {
    offMeasurement?.();
    send(IPC_CHANNELS.EVENT_SPEED_TEST_PROGRESS, { active: false });
  }
}
