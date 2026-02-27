import type { ServerConfig, SubscriptionConfig } from '../../shared/types';
import { ProtocolParser } from './ProtocolParser';
import { LogManager } from './LogManager';

export interface SubscriptionUpdateResult {
  success: boolean;
  addedServers: number;
  updatedServers: number;
  deletedServers: number;
  error?: string;
  userInfo?: SubscriptionConfig['userInfo'];
}

export class SubscriptionService {
  private protocolParser: ProtocolParser;
  private logManager: LogManager;

  constructor(protocolParser: ProtocolParser, logManager: LogManager) {
    this.protocolParser = protocolParser;
    this.logManager = logManager;
  }

  /**
   * 解析 Subscription-UserInfo header
   * 格式: upload=xxx; download=xxx; total=xxx; expire=xxx
   */
  private parseUserInfo(header: string | null): SubscriptionConfig['userInfo'] | undefined {
    if (!header) return undefined;
    const result: SubscriptionConfig['userInfo'] = {};
    const parts = header.split(';').map((s) => s.trim());
    for (const part of parts) {
      const [key, value] = part.split('=').map((s) => s.trim());
      const num = parseInt(value, 10);
      if (isNaN(num)) continue;
      if (key === 'upload') result.upload = num;
      else if (key === 'download') result.download = num;
      else if (key === 'total') result.total = num;
      else if (key === 'expire') result.expire = num;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * Fetches and parses a subscription URL, returning a list of ServerConfig objects.
   * Also returns userInfo if available in the response headers.
   */
  async fetchSubscription(
    url: string,
    subscriptionId: string,
  ): Promise<{ servers: ServerConfig[]; userInfo?: SubscriptionConfig['userInfo'] }> {
    try {
      this.logManager.addLog('info', `正在拉取订阅: ${url}`, 'Subscription');

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'FlowZ-Client',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      // 解析流量信息（来自 Subscription-UserInfo header）
      const userInfo = this.parseUserInfo(response.headers.get('subscription-userinfo'));
      if (userInfo) {
        this.logManager.addLog('info', `订阅流量信息已获取`, 'Subscription');
      }

      const text = await response.text();
      let decodedContent = text.trim();

      // Try base64 decode if the content is not a plain URL list
      if (!decodedContent.includes('://')) {
        try {
          decodedContent = Buffer.from(decodedContent, 'base64').toString('utf-8');
        } catch (e) {
          this.logManager.addLog('warn', `尝试 Base64 解码失败，可能原本就是明文`, 'Subscription');
        }
      }

      const lines = decodedContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const servers: ServerConfig[] = [];

      for (const line of lines) {
        if (this.protocolParser.isSupported(line)) {
          try {
            const server = this.protocolParser.parseUrl(line);
            server.subscriptionId = subscriptionId;
            const now = new Date().toISOString();
            server.createdAt = now;
            server.updatedAt = now;
            servers.push(server);
          } catch (e: any) {
            this.logManager.addLog('warn', `解析订阅中的节点失败: ${e.message}`, 'Subscription');
          }
        }
      }

      this.logManager.addLog('info', `成功从订阅解析了 ${servers.length} 个节点`, 'Subscription');
      return { servers, userInfo };
    } catch (error: any) {
      this.logManager.addLog('error', `拉取订阅失败 (${url}): ${error.message}`, 'Subscription');
      throw error;
    }
  }
}
