/**
 * 速度测试服务
 * TCP 协议使用 TCP Ping（极速），UDP 协议 (Hysteria2/TUIC) 使用临时 sing-box HTTP 代理测速
 *
 * 设计理念：
 * - TCP 节点：直接 Socket 握手测延迟，1-2 秒出全部结果
 * - UDP 节点：spawn 单个临时 sing-box 进程，为每个节点创建独立的 HTTP 代理入口，
 *   通过 HTTP 请求测量真实全链路延迟（与 NekoBox 的 urltest 机制等效）
 */

import * as net from 'net';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import type { ServerConfig } from '../../shared/types';
import type { LogManager } from './LogManager';
import { resourceManager } from './ResourceManager';
import { getUserDataPath } from '../utils/paths';

/** 基于 UDP/QUIC 的协议，需要走真实代理测速 */
const UDP_PROTOCOLS = new Set(['hysteria2', 'tuic']);

export interface SpeedTestResult {
  serverId: string;
  latency: number | null; // null 表示超时或失败
  error?: string;
}

export class SpeedTestService {
  private logManager: LogManager;
  private readonly MAX_CONCURRENT = 5; // TCP 并发数

  constructor(logManager: LogManager) {
    this.logManager = logManager;
  }

  /**
   * 测试所有服务器（混合策略）
   */
  async testAllServers(servers: ServerConfig[]): Promise<Map<string, number | null>> {
    if (servers.length === 0) {
      return new Map();
    }

    // 按协议分组
    const tcpServers = servers.filter((s) => !UDP_PROTOCOLS.has(s.protocol.toLowerCase()));
    const udpServers = servers.filter((s) => UDP_PROTOCOLS.has(s.protocol.toLowerCase()));

    this.logManager.addLog(
      'info',
      `开始测速: TCP=${tcpServers.length} 个, UDP=${udpServers.length} 个`,
      'SpeedTest'
    );

    const results = new Map<string, number | null>();

    // TCP 和 UDP 并行测试
    const [tcpResults, udpResults] = await Promise.all([
      this.testTcpServers(tcpServers),
      udpServers.length > 0
        ? this.testUdpServersViaProxy(udpServers)
        : new Map<string, number | null>(),
    ]);

    for (const [id, latency] of tcpResults) results.set(id, latency);
    for (const [id, latency] of udpResults) results.set(id, latency);

    this.logManager.addLog('info', '测速完成', 'SpeedTest');
    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TCP Ping（原有逻辑，保持不变）
  // ═══════════════════════════════════════════════════════════════

  private async testTcpServers(servers: ServerConfig[]): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    if (servers.length === 0) return results;

    for (let i = 0; i < servers.length; i += this.MAX_CONCURRENT) {
      const batch = servers.slice(i, i + this.MAX_CONCURRENT);
      const batchResults = await Promise.all(batch.map((server) => this.testTcpServer(server)));

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

    return results;
  }

  /**
   * 测试单个服务器 (TCP Ping)
   */
  private async testTcpServer(server: ServerConfig): Promise<SpeedTestResult> {
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
          family: isIpv6 ? 6 : 0,
        });
      });

      const latency = Date.now() - start;
      return {
        serverId: server.id,
        latency,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        serverId: server.id,
        latency: null,
        error: errorMessage,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  UDP/QUIC 测速：通过临时 sing-box HTTP 代理
  // ═══════════════════════════════════════════════════════════════

  /**
   * 使用临时 sing-box 实例测试 UDP 协议节点
   *
   * 工作流程：
   * 1. 为每个 UDP 节点分配一个 HTTP 代理入站端口
   * 2. 生成 sing-box 配置：N 个 HTTP inbound + N 个 outbound + 路由规则
   * 3. spawn 单个临时 sing-box 进程
   * 4. 通过各自的 HTTP 代理发送 HTTP 请求测量延迟
   * 5. 清理临时进程和配置文件
   */
  private async testUdpServersViaProxy(
    servers: ServerConfig[]
  ): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    let singboxProcess: ChildProcess | null = null;
    let configFilePath: string | null = null;

    try {
      // 1. 为每个节点分配端口
      const ports = await this.findFreePorts(servers.length);
      const serverPortMap = new Map<string, number>(); // serverId → HTTP proxy port
      servers.forEach((server, idx) => {
        serverPortMap.set(server.id, ports[idx]);
      });

      this.logManager.addLog(
        'info',
        `为 ${servers.length} 个 UDP 节点分配了 HTTP 代理端口: ${ports.join(', ')}`,
        'SpeedTest'
      );

      // 2. 生成临时 sing-box 配置
      const config = this.generateProxyTestConfig(servers, serverPortMap);

      // 3. 写入临时配置文件
      const userDataPath = getUserDataPath();
      configFilePath = path.join(userDataPath, `speedtest_${Date.now()}.json`);
      await fs.writeFile(configFilePath, JSON.stringify(config, null, 2));

      this.logManager.addLog('info', `临时测速配置已写入: ${configFilePath}`, 'SpeedTest');

      // 4. 启动临时 sing-box 进程
      const singboxPath = resourceManager.getSingBoxPath();
      singboxProcess = spawn(singboxPath, ['run', '-c', configFilePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 收集 stderr 用于调试
      let stderrOutput = '';
      singboxProcess.stderr?.on('data', (data: Buffer) => {
        stderrOutput += data.toString();
      });

      // 监听进程异常退出
      let processExited = false;
      singboxProcess.on('exit', (code) => {
        processExited = true;
        if (code !== null && code !== 0) {
          this.logManager.addLog(
            'warn',
            `临时 sing-box 进程退出 (code=${code}): ${stderrOutput.slice(0, 500)}`,
            'SpeedTest'
          );
        }
      });

      // 5. 等待 sing-box 就绪（尝试连接第一个 HTTP 代理端口）
      // 超时设为 10s，因为如果主进程有应用分流规则（如 Twitter），
      // sing-box 启动时需要下载对应的 rule_set，在网络较慢时可能耗时 5-8s。
      const firstPort = ports[0];
      const ready = await this.waitForPortReady(firstPort, 10000);

      if (!ready || processExited) {
        this.logManager.addLog(
          'warn',
          `sing-box 测速进程未就绪: ${stderrOutput.slice(0, 500)}`,
          'SpeedTest'
        );
        for (const server of servers) results.set(server.id, null);
        return results;
      }

      this.logManager.addLog('info', 'sing-box 测速进程已就绪，开始测速...', 'SpeedTest');

      // 6. 预热阶段：并发为每个节点建立 QUIC 连接 + DNS 缓存
      //    第一次请求包含 DNS 解析 + QUIC 握手的冷启动开销，不计入延迟
      this.logManager.addLog('info', '预热中（建立连接）...', 'SpeedTest');
      const warmupPromises = servers.map(async (server) => {
        const proxyPort = serverPortMap.get(server.id)!;
        await this.sendHttpProxyRequest(proxyPort, 8000);
      });
      await Promise.all(warmupPromises);

      // 7. 正式测速：连接已建立，测量纯 HTTP 往返延迟（与 NekoBox urltest 一致）
      this.logManager.addLog('info', '开始正式测速...', 'SpeedTest');
      const testPromises = servers.map(async (server) => {
        const proxyPort = serverPortMap.get(server.id)!;
        try {
          const latency = await this.sendHttpProxyRequest(proxyPort, 5000);
          results.set(server.id, latency);
          if (latency !== null) {
            this.logManager.addLog('info', `[${server.name}] 延迟: ${latency}ms`, 'SpeedTest');
          } else {
            this.logManager.addLog('warn', `[${server.name}] 测速超时`, 'SpeedTest');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logManager.addLog('warn', `[${server.name}] 测速失败: ${msg}`, 'SpeedTest');
          results.set(server.id, null);
        }
      });

      await Promise.all(testPromises);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logManager.addLog('error', `UDP 测速异常: ${msg}`, 'SpeedTest');
      for (const server of servers) {
        if (!results.has(server.id)) results.set(server.id, null);
      }
    } finally {
      // 清理临时进程
      if (singboxProcess && !singboxProcess.killed) {
        singboxProcess.kill('SIGTERM');
        const forceKillTimer = setTimeout(() => {
          try {
            singboxProcess?.kill('SIGKILL');
          } catch {
            // 进程可能已退出
          }
        }, 2000);
        singboxProcess.on('exit', () => clearTimeout(forceKillTimer));
      }
      // 清理临时配置文件
      if (configFilePath) {
        try {
          await fs.unlink(configFilePath);
        } catch {
          // ignore
        }
      }
    }

    return results;
  }

  /**
   * 生成用于测速的 sing-box 配置
   * 每个 UDP 节点有独立的 HTTP 代理入站 + 路由规则
   */
  private generateProxyTestConfig(
    servers: ServerConfig[],
    serverPortMap: Map<string, number>
  ): Record<string, unknown> {
    const inbounds: Record<string, unknown>[] = [];
    const outbounds: Record<string, unknown>[] = [];
    const routeRules: Record<string, unknown>[] = [];

    for (const server of servers) {
      const port = serverPortMap.get(server.id);
      if (!port) continue;

      const inboundTag = `http-in-${server.id.slice(0, 8)}`;
      const outboundTag = `out-${server.id.slice(0, 8)}`;

      // HTTP 代理入站
      inbounds.push({
        type: 'http',
        tag: inboundTag,
        listen: '127.0.0.1',
        listen_port: port,
      });

      // 代理出站
      outbounds.push(this.buildOutbound(server, outboundTag));

      // 路由规则：将该入站的流量路由到对应的出站
      routeRules.push({
        inbound: [inboundTag],
        action: 'route',
        outbound: outboundTag,
      });
    }

    // 必须有 direct 出站（sing-box 启动要求）
    outbounds.push({ type: 'direct', tag: 'direct' });

    return {
      log: { level: 'warn' },
      dns: {
        servers: [
          {
            // sing-box 1.13+ 要求显式 type 字段，不能用旧的 address 格式
            tag: 'dns-direct',
            type: 'udp',
            server: '223.5.5.5',
            server_port: 53,
          },
        ],
      },
      inbounds,
      outbounds,
      route: {
        rules: routeRules,
        auto_detect_interface: true,
        // sing-box 1.13+ 需要 default_domain_resolver 来解析 outbound 的 server 域名
        default_domain_resolver: 'dns-direct',
      },
    };
  }

  /**
   * 为单个 UDP 服务器生成 sing-box outbound 配置
   */
  private buildOutbound(server: ServerConfig, tag: string): Record<string, unknown> {
    const protocol = server.protocol.toLowerCase();

    const outbound: Record<string, unknown> = {
      type: protocol,
      tag,
      server: server.address,
      server_port: server.port,
    };

    // ── Hysteria2 ──
    if (protocol === 'hysteria2') {
      outbound.password = server.password;

      if (server.hysteria2Settings?.upMbps) {
        outbound.up_mbps = server.hysteria2Settings.upMbps;
      }
      if (server.hysteria2Settings?.downMbps) {
        outbound.down_mbps = server.hysteria2Settings.downMbps;
      }
      if (server.hysteria2Settings?.obfs?.type && server.hysteria2Settings?.obfs?.password) {
        outbound.obfs = {
          type: server.hysteria2Settings.obfs.type,
          password: server.hysteria2Settings.obfs.password,
        };
      }
      if (server.hysteria2Settings?.network) {
        outbound.network = server.hysteria2Settings.network;
      }
    }

    // ── TUIC ──
    if (protocol === 'tuic') {
      outbound.uuid = server.uuid;
      outbound.password = server.password;

      if (server.tuicSettings) {
        if (server.tuicSettings.congestionControl) {
          outbound.congestion_control = server.tuicSettings.congestionControl;
        }
        if (server.tuicSettings.udpRelayMode) {
          outbound.udp_relay_mode = server.tuicSettings.udpRelayMode;
        }
        if (server.tuicSettings.zeroRttHandshake !== undefined) {
          outbound.zero_rtt_handshake = server.tuicSettings.zeroRttHandshake;
        }
        if (server.tuicSettings.heartbeat) {
          outbound.heartbeat = server.tuicSettings.heartbeat;
        }
      }
    }

    // ── TLS（hysteria2 和 tuic 都强制开启）──
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: server.tlsSettings?.serverName || server.address,
      insecure: server.tlsSettings?.allowInsecure || false,
    };
    if (server.tlsSettings?.alpn) {
      tls.alpn = server.tlsSettings.alpn;
    }
    outbound.tls = tls;

    return outbound;
  }

  // ═══════════════════════════════════════════════════════════════
  //  工具方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 通过 HTTP 代理发送请求并测量延迟
   * 返回从发起请求到收到响应头的时间（TTFB）
   */
  private sendHttpProxyRequest(proxyPort: number, timeout: number): Promise<number | null> {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setTimeout(() => {
        resolve(null);
      }, timeout);

      const req = http.get(
        {
          hostname: '127.0.0.1',
          port: proxyPort,
          path: 'http://cp.cloudflare.com/',
          headers: {
            Host: 'cp.cloudflare.com',
            Connection: 'close',
          },
          timeout,
        },
        (res) => {
          // 收到响应头即刻计算延迟（不等 body），与 NekoBox urltest 一致
          clearTimeout(timer);
          const latency = Date.now() - start;
          res.resume(); // 排空响应体，防止内存泄漏
          resolve(latency);
        }
      );

      req.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });

      req.on('timeout', () => {
        clearTimeout(timer);
        req.destroy();
        resolve(null);
      });
    });
  }

  /**
   * 找到多个系统可用的空闲端口
   */
  private async findFreePorts(count: number): Promise<number[]> {
    const servers: net.Server[] = [];
    const ports: number[] = [];

    try {
      // 同时绑定所有端口，确保不冲突
      for (let i = 0; i < count; i++) {
        const srv = net.createServer();
        await new Promise<void>((resolve, reject) => {
          srv.listen(0, '127.0.0.1', () => resolve());
          srv.on('error', reject);
        });
        ports.push((srv.address() as net.AddressInfo).port);
        servers.push(srv);
      }
    } finally {
      // 关闭所有临时服务器，释放端口给 sing-box 使用
      await Promise.all(
        servers.map((srv) => new Promise<void>((resolve) => srv.close(() => resolve())))
      );
    }

    return ports;
  }

  /**
   * 等待端口可连接（表示 sing-box 已就绪）
   */
  private async waitForPortReady(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(500);
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
        socket.connect(port, '127.0.0.1');
      });

      if (ok) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }
}
