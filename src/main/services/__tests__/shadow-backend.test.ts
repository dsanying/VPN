jest.mock('electron', () => ({ app: { getVersion: () => '0.1.0' }, net: {}, session: {} }));
import { SubscriptionService, defaultSubscriptionUserAgent } from '../SubscriptionService';
import { ProtocolParser } from '../ProtocolParser';
import { SpeedTestService } from '../SpeedTestService';
import { parseClashProxies } from '../ClashSubscriptionParser';
import { resolveSpeedTestTarget } from '../../../shared/speed-test';
import type { ServerConfig } from '../../../shared/types';
const log = { addLog: jest.fn() } as never;

describe('暗影VPN 后端兼容修复', () => {
  it('默认协商 Clash Meta，避免供应商返回未支持客户端的提示页', () => {
    expect(defaultSubscriptionUserAgent()).toBe('clash.meta');
  });
  it('sing-box HTTP/WS 导入保留 host、method 和全部 headers', () => {
    const service = new SubscriptionService(new ProtocolParser(), log) as unknown as {
      parseSingboxOutbounds(items: unknown[], sub: string): ServerConfig[];
    };
    const base = { type: 'vmess', server: 'example.com', server_port: 443, uuid: 'test-id' };
    const servers = service.parseSingboxOutbounds(
      [
        {
          ...base,
          tag: 'http',
          transport: {
            type: 'http',
            host: ['a.example', 'b.example'],
            path: '/path',
            method: 'POST',
            headers: { 'X-Auth': 'fixture' },
          },
        },
        {
          ...base,
          tag: 'ws',
          transport: {
            type: 'ws',
            host: 'a.example',
            headers: { 'X-Auth': 'fixture', Host: 'old.example' },
          },
        },
      ],
      'sub'
    );
    expect(servers[0].httpSettings).toEqual({
      host: ['a.example', 'b.example'],
      path: '/path',
      method: 'POST',
      headers: { 'X-Auth': ['fixture'] },
    });
    expect(servers[1].wsSettings?.headers).toEqual({ 'X-Auth': 'fixture', Host: 'a.example' });
  });
  it('Clash HTTP Host 数组、method 和额外 headers 完整保留', () => {
    const result = parseClashProxies(
      [
        {
          name: 'fixture',
          type: 'vmess',
          server: 'example.com',
          port: 80,
          uuid: 'fixture',
          network: 'http',
          'http-opts': {
            path: ['/probe'],
            method: 'GET',
            headers: { Host: ['a.example', 'b.example'], 'X-Test': ['one', 'two'] },
          },
        },
      ],
      'sub',
      new Date().toISOString()
    );
    expect(result.servers[0].httpSettings).toEqual({
      path: '/probe',
      host: ['a.example', 'b.example'],
      method: 'GET',
      headers: { 'X-Test': ['one', 'two'] },
    });
  });
  it('默认站点失败后独立复核，备用站点成功不能被误记超时', async () => {
    const svc = new SpeedTestService(log) as unknown as {
      measureViaTunnel: jest.Mock;
      measureWithFallback(port: number, timeout: number, target: unknown): Promise<unknown>;
    };
    svc.measureViaTunnel = jest
      .fn()
      .mockResolvedValueOnce({ latency: null, reason: 'http-403' })
      .mockResolvedValueOnce({ latency: 90 });
    expect(await svc.measureWithFallback(1234, 8000, resolveSpeedTestTarget())).toEqual({
      latency: 90,
    });
    expect(svc.measureViaTunnel.mock.calls[1][2].host).toBe('cp.cloudflare.com');
  });
  it('自定义站点失败保留真实原因，不更改用户目标', async () => {
    const svc = new SpeedTestService(log) as unknown as {
      measureViaTunnel: jest.Mock;
      measureWithFallback(port: number, timeout: number, target: unknown): Promise<unknown>;
    };
    svc.measureViaTunnel = jest.fn().mockResolvedValue({ latency: null, reason: 'http-403' });
    expect(
      await svc.measureWithFallback(1234, 8000, resolveSpeedTestTarget('https://example.com/probe'))
    ).toEqual({ latency: null, reason: 'http-403' });
    expect(svc.measureViaTunnel).toHaveBeenCalledTimes(1);
  });
  it('显式 HTTP 目标失败时不擅自切换 HTTPS', async () => {
    const svc = new SpeedTestService(log) as unknown as {
      measureViaTunnel: jest.Mock;
      measureWithFallback(port: number, timeout: number, target: unknown): Promise<unknown>;
    };
    svc.measureViaTunnel = jest.fn().mockResolvedValue({ latency: null, reason: 'http-403' });
    await svc.measureWithFallback(
      1234,
      8000,
      resolveSpeedTestTarget('http://www.gstatic.com/generate_204')
    );
    expect(svc.measureViaTunnel).toHaveBeenCalledTimes(1);
  });
  it('测速报错清理后可重试，不残留被拒绝的在飞 Promise', async () => {
    const svc = new SpeedTestService(log) as unknown as {
      testAllServers: SpeedTestService['testAllServers'];
      doTestAllServers: jest.Mock;
    };
    svc.doTestAllServers = jest
      .fn()
      .mockRejectedValueOnce(new Error('fixture failure'))
      .mockResolvedValue({
        results: new Map(),
        outcome: 'completed',
        skipped: { notInPool: [], tsNotReady: [] },
      });
    const server = {
      id: 'one',
      protocol: 'vmess',
      address: 'example.com',
      port: 443,
    } as ServerConfig;
    await expect(svc.testAllServers([server])).rejects.toThrow('fixture failure');
    await expect(svc.testAllServers([server])).resolves.toMatchObject({ outcome: 'completed' });
  });
});
