/**
 * 速度测试服务
 * 通过临时 sing-box 实例测试代理服务器的真实延迟
 */

import * as net from 'net';
import type { ServerConfig } from '../../shared/types';
import type { LogManager } from './LogManager';

export interface SpeedTestResult {
  serverId: string;
  latency: number | null; // null 表示超时或失败
  error?: string;
}

export class SpeedTestService {
  private logManager: LogManager;
  private readonly MAX_CONCURRENT = 5; // 最多同时测试 5 个

  constructor(logManager: LogManager) {
    this.logManager = logManager;
  }

  /**
   * 测试所有服务器
   */
  async testAllServers(servers: ServerConfig[]): Promise<Map<string, number | null>> {
    if (servers.length === 0) {
      return new Map();
    }

    this.logManager.addLog('info', `开始测速 ${servers.length} 个服务器`, 'SpeedTest');

    const results = new Map<string, number | null>();

    // 分批并发测试，避免资源耗尽
    for (let i = 0; i < servers.length; i += this.MAX_CONCURRENT) {
      const batch = servers.slice(i, i + this.MAX_CONCURRENT);
      const batchResults = await Promise.all(batch.map((server) => this.testServer(server)));

      batchResults.forEach((result) => {
        results.set(result.serverId, result.latency);
        if (result.error) {
          this.logManager.addLog(
            'warn',
            `测速失败 ${result.serverId}: ${result.error}`,
            'SpeedTest'
          );
        }
      });
    }

    this.logManager.addLog('info', '测速完成', 'SpeedTest');
    return results;
  }

  /**
   * 测试单个服务器 (TCP Ping)
   */
  private async testServer(server: ServerConfig): Promise<SpeedTestResult> {
    const start = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        const timeout = 5000; // 5秒超时

        socket.setTimeout(timeout);

        socket.on('connect', () => {
          socket.destroy();
          resolve();
        });

        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('Timeout'));
        });

        socket.on('error', (err) => {
          socket.destroy();
          reject(err);
        });

        // 如果是 IPv6 且带有中括号，去除中括号以供 net.Socket 使用
        const isIpv6 = server.address.includes(':');
        const connectAddress =
          isIpv6 && server.address.startsWith('[') && server.address.endsWith(']')
            ? server.address.slice(1, -1)
            : server.address;

        socket.connect({
          port: server.port,
          host: connectAddress,
          family: isIpv6 ? 6 : 0, // 明确指定为 IPv6，避免被系统误当作 IPv4 解析抛出超时
        });
      });

      const latency = Date.now() - start;
      return {
        serverId: server.id,
        latency,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isConnectionRefused = errorMessage.includes('ECONNREFUSED');

      // 对于基于 UDP 的协议 (如 TUIC, Hysteria2)，目标服务器通常不会监听 TCP 端口
      // 因此会立即返回 ECONNREFUSED (TCP RST)。我们正好利用这个拒绝响应的 RTT 作为真实的延迟。
      if (isConnectionRefused && (server.protocol === 'tuic' || server.protocol === 'hysteria2')) {
        return {
          serverId: server.id,
          latency: Date.now() - start,
        };
      }

      return {
        serverId: server.id,
        latency: null,
        error: errorMessage,
      };
    }
  }
}
