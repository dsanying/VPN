import extraCatalog from '../log-extra-catalog.json';
import nativeCatalog from '../log-native-catalog.json';
import catalog from '../log-catalog.json';
import {
  identifyLogMessage,
  presentLog,
  mergeLogEntries,
  logLevelLabel,
} from '../log-presentation';
import { redactLogText } from '../log-redact';
import type { LogEntry } from '../types';
const log: LogEntry = {
  timestamp: '2026-10-08T00:00:00Z',
  level: 'info',
  message: 'Application started',
  source: 'Main',
};
describe('Bilingual log presentation', () => {
  it.each(catalog.map((entry) => [entry.id, entry] as const))(
    '%s preserves template arguments and both languages',
    (_id, entry) => {
      const args = Array.from({ length: entry.parts.length - 1 }, (_, i) => `example-${i}`);
      const message = entry.parts.map((part, index) => part + (args[index] ?? '')).join('');
      expect(identifyLogMessage(message)?.eventId).toBe(entry.id);
      const event = { ...log, message, eventId: entry.id, eventArgs: args };
      for (const language of ['zh-CN', 'en-US']) {
        const expected = (language === 'en-US' ? entry.en : entry.zh).replace(
          /\{(\d+)\}/g,
          (_match, index: string) => args[Number(index)]
        );
        expect(presentLog(event, language).message).toBe(expected);
      }
    }
  );
  it('all owned log English prose is free of untranslated Chinese literals', () => {
    for (const item of [...catalog, ...extraCatalog, ...nativeCatalog])
      expect(item.en).not.toMatch(/[\u3400-\u9fff]/);
  });
  it('translates nested owned error prose without changing a user node name', () => {
    const message = '1 个节点解析失败: 节点 "示例节点" 映射异常: 不支持的传输层类型: xhttp';
    const presented = presentLog({ ...log, message }, 'en-US').message;
    expect(presented).toContain('示例节点');
    expect(presented).toContain('xhttp');
    expect(presented).not.toMatch(/解析失败|映射异常|不支持/);
  });
  it('translates compatibility errors while preserving the node identifier and raw diagnostic', () => {
    const message =
      'Compatibility node unavailable: fixture-node: Unsupported Xray transport mapping: http';
    expect(presentLog({ ...log, message }, 'zh-CN').message).toBe(
      '兼容节点不可用：fixture-node：无法映射 Xray 传输：http'
    );
    expect(presentLog({ ...log, message }, 'en-US').message).toBe(message);
  });
  it('switches language without replacing original diagnostic data', () => {
    expect(presentLog(log, 'zh-CN')).toEqual({ message: '应用已启动', source: '主进程' });
    expect(presentLog(log, 'en-US')).toEqual({ message: 'Application started', source: 'Main' });
    expect(log.message).toBe('Application started');
    expect(logLevelLabel('error', 'zh-CN')).toBe('错误');
  });
  it('merges snapshot/live overlap and enforces bounded tail while preserving order', () => {
    const entries = [1, 2, 3].map((sequence) => ({ ...log, id: `session:${sequence}`, sequence }));
    expect(mergeLogEntries(entries.slice(0, 2), entries.slice(1), 2)).toEqual(entries.slice(1));
    expect(mergeLogEntries([log], [log])).toHaveLength(1);
  });
  it('keeps arbitrary third-party output and error codes unchanged', () => {
    const entry = {
      ...log,
      source: 'sing-box',
      message: 'example kernel diagnostic: ECONNRESET errno=54',
    };
    expect(presentLog(entry, 'zh-CN').message).toBe(entry.message);
  });
});
describe('Free-form diagnostic credential protection', () => {
  it.each([
    'https://example.com/subscribe?token=fake-token&key=fake-key',
    'Authorization: Bearer fake-token',
    'Cookie: session=fake-token',
    'https://example.com/fake-token',
    'privacyPassword=fake-token; obfs-password=fake-key; clashApiSecret=fake-token',
    'password="fake-token"; uuid=fake-key',
    'vless://fake-token@example.com:443',
    '-----BEGIN PRIVATE KEY-----\nfake-token\n-----END PRIVATE KEY-----',
  ])('redacts credentials: %s', (value) => {
    expect(redactLogText(value)).not.toMatch(/fake-token|fake-key/);
  });
  it('keeps useful destination, status and port fields', () => {
    expect(redactLogText('HTTP 403; example.com:443; ECONNRESET')).toBe(
      'HTTP 403; example.com:443; ECONNRESET'
    );
  });
});

it.each([
  'IconProtocol',
  'StatsWorker',
  'ExitProbeLatency',
  'Unlock',
  'AutoStart',
  'CoreUpdateService',
  'Helper',
  'ProtocolParser',
  'ResourceManager',
  'SystemDns',
  'SystemProxy',
  'WarpDeregisterQueue',
  'WarpService',
  'CoreDownloader',
])('owned log source %s follows display language without changing diagnostics', (source) => {
  const entry = { ...log, source };
  expect(presentLog(entry, 'zh-CN').source).not.toBe(source);
  expect(presentLog(entry, 'en-US').source).toBe(source);
  expect(entry.source).toBe(source);
});
