/**
 * 速度测试服务
 * 通过临时 sing-box 实例测试代理服务器的真实延迟
 */

import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import { SocksClient } from 'socks';
import type { ServerConfig } from '../../shared/types';
import type { LogManager } from './LogManager';

export interface SpeedTestResult {
  serverId: string;
  latency: number | null; // null 表示超时或失败
  error?: string;
}

export class SpeedTestService {
  private logManager: LogManager;
  private readonly TEST_URL = 'http://cp.cloudflare.com/';
  private readonly TIMEOUT_MS = 10000; // 10 秒超时
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
      const batchResults = await Promise.all(
        batch.map((server) => this.testServer(server))
      );

      batchResults.forEach((result) => {
        results.set(result.serverId, result.latency);
        if (result.error) {
          this.logManager.addLog('warn', `测速失败 ${result.serverId}: ${result.error}`, 'SpeedTest');
        }
      });
    }

    this.logManager.addLog('info', '测速完成', 'SpeedTest');
    return results;
  }

  /**
   * 测试单个服务器
   */
  private async testServer(server: ServerConfig): Promise<SpeedTestResult> {
    const port = this.getRandomPort();
    let process: ChildProcess | null = null;

    try {
      // 1. 生成临时配置
      const config = this.generateTempConfig(server, port);

      // 2. 启动临时 sing-box 进程
      process = await this.startTempSingbox(config);

      // 3. 等待端口就绪
      await this.waitForPort(port, 3000);

      // 4. 通过 SOCKS5 代理发送 HTTP 请求并测量延迟
      const startTime = Date.now();
      await this.httpGetViaSocks(this.TEST_URL, '127.0.0.1', port, this.TIMEOUT_MS);
      const latency = Date.now() - startTime;

      this.logManager.addLog('info', `${server.name}: ${latency}ms`, 'SpeedTest');

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
    } finally {
      // 5. 清理进程
      if (process && !process.killed) {
        process.kill('SIGTERM');
      }
    }
  }

  /**
   * 生成临时 sing-box 配置
   */
  private generateTempConfig(server: ServerConfig, port: number): any {
    const protocol = server.protocol.toLowerCase();

    // 构建出站配置
    let outbound: any = {
      type: protocol,
      tag: 'proxy',
      server: server.address,
      server_port: server.port,
    };

    // 根据协议添加特定配置
    if (protocol === 'vless') {
      outbound.uuid = server.uuid;
      outbound.flow = server.flow || '';
      
      if (server.network) {
        outbound.transport = {
          type: server.network,
        };

        if (server.network === 'ws' && server.wsSettings) {
          outbound.transport.path = server.wsSettings.path || '/';
          if (server.wsSettings.headers?.Host) {
            outbound.transport.headers = { Host: server.wsSettings.headers.Host };
          }
        }
      }
    } else if (protocol === 'trojan') {
      outbound.password = server.password;

      if (server.network) {
        outbound.transport = {
          type: server.network,
        };

        if (server.network === 'ws' && server.wsSettings) {
          outbound.transport.path = server.wsSettings.path || '/';
          if (server.wsSettings.headers?.Host) {
            outbound.transport.headers = { Host: server.wsSettings.headers.Host };
          }
        }
      }
    } else if (protocol === 'hysteria2') {
      outbound.password = server.password;
      
      if (server.hysteria2Settings?.obfs) {
        outbound.obfs = {
          type: server.hysteria2Settings.obfs.type,
          password: server.hysteria2Settings.obfs.password,
        };
      }
    } else if (protocol === 'shadowsocks') {
      outbound.method = server.shadowsocksSettings?.method || 'aes-256-gcm';
      outbound.password = server.shadowsocksSettings?.password || '';
    }

    // TLS 配置
    if (server.security === 'tls' || server.security === 'reality') {
      outbound.tls = {
        enabled: true,
        server_name: server.tlsSettings?.serverName || server.address,
        insecure: server.tlsSettings?.allowInsecure || false,
      };

      if (server.tlsSettings?.alpn) {
        outbound.tls.alpn = server.tlsSettings.alpn;
      }

      if (server.security === 'reality' && server.realitySettings) {
        outbound.tls.reality = {
          enabled: true,
          public_key: server.realitySettings.publicKey,
          short_id: server.realitySettings.shortId || '',
        };
      }
    }

    // 完整配置
    return {
      log: {
        level: 'error',
      },
      inbounds: [
        {
          type: 'socks',
          tag: 'socks-in',
          listen: '127.0.0.1',
          listen_port: port,
        },
      ],
      outbounds: [outbound],
    };
  }

  /**
   * 启动临时 sing-box 进程
   */
  private async startTempSingbox(config: any): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const configStr = JSON.stringify(config);

      // 启动 sing-box，使用 stdin 传递配置
      const proc = spawn('sing-box', ['run', '-c', 'stdin'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // 写入配置到 stdin
      proc.stdin?.write(configStr);
      proc.stdin?.end();

      let started = false;

      proc.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('started') || output.includes('listening')) {
          if (!started) {
            started = true;
            resolve(proc);
          }
        }
      });

      proc.stderr?.on('data', (data) => {
        if (!started) {
          reject(new Error(`sing-box 启动失败: ${data.toString()}`));
        }
      });

      proc.on('error', (error) => {
        if (!started) {
          reject(new Error(`无法启动 sing-box: ${error.message}`));
        }
      });

      proc.on('exit', (code) => {
        if (!started && code !== 0) {
          reject(new Error(`sing-box 退出，代码: ${code}`));
        }
      });

      // 2 秒后仍未启动则超时
      setTimeout(() => {
        if (!started) {
          proc.kill();
          reject(new Error('sing-box 启动超时'));
        }
      }, 2000);
    });
  }

  /**
   * 等待端口就绪
   */
  private async waitForPort(port: number, timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        await this.checkPort(port);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw new Error(`端口 ${port} 超时未就绪`);
  }

  /**
   * 检查端口是否可连接
   */
  private checkPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(500);

      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('超时'));
      });

      socket.on('error', (error) => {
        socket.destroy();
        reject(error);
      });

      socket.connect(port, '127.0.0.1');
    });
  }

  /**
   * 通过 SOCKS5 代理发送 HTTP GET 请求
   */
  private async httpGetViaSocks(
    url: string,
    socksHost: string,
    socksPort: number,
    timeoutMs: number
  ): Promise<void> {
    const urlObj = new URL(url);
    const targetHost = urlObj.hostname;
    const targetPort = parseInt(urlObj.port) || 80;

    // 通过 SOCKS5建立连接
    const info = await SocksClient.createConnection({
      proxy: {
        host: socksHost,
        port: socksPort,
        type: 5,
      },
      command: 'connect',
      destination: {
        host: targetHost,
        port: targetPort,
      },
      timeout: timeoutMs,
    });

    const socket = info.socket;

    return new Promise((resolve, reject) => {
      let responseReceived = false;

      // 设置超时
      const timeout = setTimeout(() => {
        if (!responseReceived) {
          socket.destroy();
          reject(new Error('HTTP 请求超时'));
        }
      }, timeoutMs);

      // 发送 HTTP 请求
      const request = `GET ${urlObj.pathname || '/'} HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`;
      socket.write(request);

      socket.on('data', (data) => {
        const response = data.toString();
        // 简单检查是否收到 HTTP 响应
        if (response.startsWith('HTTP/')) {
          responseReceived = true;
          clearTimeout(timeout);
          socket.destroy();
          resolve();
        }
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      socket.on('close', () => {
        clearTimeout(timeout);
        if (!responseReceived) {
          reject(new Error('连接关闭，未收到响应'));
        }
      });
    });
  }

  /**
   * 获取随机端口（60000-65000）
   */
  private getRandomPort(): number {
    return 60000 + Math.floor(Math.random() * 5000);
  }
}
