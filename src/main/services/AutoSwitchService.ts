/**
 * 自动换节点服务
 *
 * 工作机制（方案 B）：
 * 1. 进程崩溃触发：监听 ProxyManager 的 'error' 事件，sing-box 崩溃时立即触发
 * 2. 心跳检测触发：每 30 秒对当前节点做 TCP Ping，连续 3 次失败则触发
 *
 * 换节点逻辑：
 * - 对所有其他节点做 TCP Ping 测速（快，1-2s 出结果）
 * - 选出延迟最低的可用节点
 * - 切换配置 → 重启代理 → 通知渲染进程显示 toast
 *
 * 注意：同一时刻只允许一个换节点操作在进行，防止并发切换。
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import type { BrowserWindow } from 'electron';
import type { ConfigManager } from './ConfigManager';
import type { LogManager } from './LogManager';
import type { ProxyManager } from './ProxyManager';
import { IPC_CHANNELS } from '../../shared/ipc-channels';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 秒检测一次
const MAX_CONSECUTIVE_FAILURES = 3; // 连续 3 次失败触发换节点
const PING_TIMEOUT_MS = 4_000; // 单次 ping 超时 4 秒
const SWITCH_COOLDOWN_MS = 60_000; // 换节点冷却 60 秒，防止频繁切换

export class AutoSwitchService extends EventEmitter {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private isSwitching = false;
  private lastSwitchTime = 0;
  private enabled = false;

  constructor(
    private readonly configManager: ConfigManager,
    private readonly proxyManager: ProxyManager,
    private readonly logManager: LogManager,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {
    super();
  }

  // ─── 启用 / 禁用 ─────────────────────────────────────────────────────────

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.consecutiveFailures = 0;
    this.startHeartbeat();
    this.logManager.addLog('info', '自动换节点已启用（心跳检测 + 崩溃监听）', 'AutoSwitch');
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.stopHeartbeat();
    this.logManager.addLog('info', '自动换节点已禁用', 'AutoSwitch');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ─── 外部触发（进程崩溃）────────────────────────────────────────────────

  /**
   * 由主进程在 proxyManager.on('error') 时调用
   * 只有在自动换节点已启用时才响应
   */
  async onProxyError(errorMessage: string): Promise<void> {
    if (!this.enabled) return;
    this.logManager.addLog('warn', `代理进程崩溃，触发自动换节点: ${errorMessage}`, 'AutoSwitch');
    await this.triggerSwitch('崩溃检测');
  }

  // ─── 心跳检测 ────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeat().catch((e) => {
        this.logManager.addLog('warn', `心跳检测异常: ${e}`, 'AutoSwitch');
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async runHeartbeat(): Promise<void> {
    if (!this.enabled || this.isSwitching) return;

    // 代理没在运行时不需要检测
    const status = this.proxyManager.getStatus();
    if (!status?.running) {
      this.consecutiveFailures = 0;
      return;
    }

    const config = await this.configManager.loadConfig().catch(() => null);
    if (!config?.selectedServerId) return;

    const server = config.servers.find((s) => s.id === config.selectedServerId);
    if (!server) return;

    const alive = await this.tcpPing(server.address, server.port, PING_TIMEOUT_MS);

    if (alive) {
      if (this.consecutiveFailures > 0) {
        this.logManager.addLog(
          'info',
          `心跳恢复正常（此前连续失败 ${this.consecutiveFailures} 次）`,
          'AutoSwitch'
        );
      }
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
      this.logManager.addLog(
        'warn',
        `心跳检测失败 [${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}]: ${server.name} (${server.address}:${server.port})`,
        'AutoSwitch'
      );

      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.consecutiveFailures = 0;
        await this.triggerSwitch('心跳检测');
      }
    }
  }

  // ─── 换节点逻辑 ──────────────────────────────────────────────────────────

  private async triggerSwitch(reason: string): Promise<void> {
    if (this.isSwitching) {
      this.logManager.addLog('info', '换节点操作已在进行中，跳过', 'AutoSwitch');
      return;
    }

    // 冷却期检查
    const now = Date.now();
    if (now - this.lastSwitchTime < SWITCH_COOLDOWN_MS) {
      const remaining = Math.ceil((SWITCH_COOLDOWN_MS - (now - this.lastSwitchTime)) / 1000);
      this.logManager.addLog('info', `自动换节点冷却中，${remaining}s 后可再次触发`, 'AutoSwitch');
      return;
    }

    this.isSwitching = true;
    this.lastSwitchTime = now;

    try {
      const config = await this.configManager.loadConfig();
      const currentId = config.selectedServerId;

      // 过滤出其他可用节点（排除当前节点）
      const candidates = config.servers.filter((s) => s.id !== currentId);
      if (candidates.length === 0) {
        this.logManager.addLog('warn', '没有其他可用节点，无法自动切换', 'AutoSwitch');
        return;
      }

      this.logManager.addLog(
        'info',
        `[${reason}] 开始对 ${candidates.length} 个候选节点测速...`,
        'AutoSwitch'
      );

      // 并行对所有候选节点做 TCP Ping + 延迟测量
      const results = await Promise.all(
        candidates.map(async (server) => {
          const latency = await this.measureLatency(server.address, server.port);
          return { server, latency };
        })
      );

      // 过滤掉不可达的节点，按延迟排序
      const available = results
        .filter((r) => r.latency !== null)
        .sort((a, b) => (a.latency as number) - (b.latency as number));

      if (available.length === 0) {
        this.logManager.addLog('warn', '所有候选节点均不可达，无法自动切换', 'AutoSwitch');
        return;
      }

      const best = available[0];
      this.logManager.addLog(
        'info',
        `选中最优节点: ${best.server.name} (${best.latency}ms)`,
        'AutoSwitch'
      );

      // 切换配置
      const newConfig = { ...config, selectedServerId: best.server.id };
      await this.configManager.saveConfig(newConfig);

      // 重启代理
      await this.proxyManager.restart(newConfig);

      this.logManager.addLog('info', `✅ 自动换节点成功: ${best.server.name}`, 'AutoSwitch');

      // 通知渲染进程
      const mainWindow = this.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.EVENT_AUTO_NODE_SWITCHED, {
          reason,
          newServerName: best.server.name,
          latency: best.latency,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logManager.addLog('error', `自动换节点失败: ${msg}`, 'AutoSwitch');
    } finally {
      this.isSwitching = false;
    }
  }

  // ─── 工具方法 ────────────────────────────────────────────────────────────

  /**
   * TCP Ping：仅检测是否可达（不计时）
   */
  private tcpPing(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });
  }

  /**
   * 测量延迟（毫秒）
   */
  private measureLatency(host: string, port: number): Promise<number | null> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(PING_TIMEOUT_MS);
      socket.on('connect', () => {
        socket.destroy();
        resolve(Date.now() - start);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(null);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(null);
      });
      socket.connect(port, host);
    });
  }

  destroy(): void {
    this.disable();
  }
}
