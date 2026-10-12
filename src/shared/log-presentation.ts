import baseCatalog from './log-catalog.json';
import extraCatalog from './log-extra-catalog.json';
import nativeCatalog from './log-native-catalog.json';
const catalog = [...baseCatalog, ...extraCatalog, ...nativeCatalog];
import type { LogEntry, LogLevel } from './types';

const english = (language: string) => language.toLowerCase().startsWith('en');
const exact = new Map(catalog.filter((e) => e.parts.length === 1).map((e) => [e.parts[0], e]));
const templates = catalog
  .filter((e) => e.parts.length > 1)
  .sort((a, b) => b.parts[0].length - a.parts[0].length);

// Delimiter matching is bounded and linear; hostile long error strings cannot trigger regex backtracking.
function captureParts(message: string, parts: string[]): string[] | undefined {
  if (!message.startsWith(parts[0]) || !message.endsWith(parts[parts.length - 1])) return;
  const args: string[] = [];
  let offset = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const end = last ? message.length - parts[i].length : message.indexOf(parts[i], offset);
    if (end < offset) return;
    args.push(message.slice(offset, end));
    offset = end + parts[i].length;
  }
  return offset === message.length ? args : undefined;
}
const byId = new Map(catalog.map((e) => [e.id, e]));

/** Application-owned prose is translated; protocol fields, error codes and original core output stay intact. */
export function identifyLogMessage(
  message: string
): { eventId: string; args: string[] } | undefined {
  const constant = exact.get(message);
  if (constant) return { eventId: constant.id, args: [] };
  for (const entry of templates) {
    const args = captureParts(message, entry.parts);
    if (args) return { eventId: entry.id, args };
  }
  return undefined;
}

export function translateLogMessage(message: string, language: string): string {
  const event = identifyLogMessage(message);
  if (!event) return message;
  return renderLogEvent(event.eventId, event.args, language, message);
}

function renderLogEvent(
  id: string,
  args: string[],
  language: string,
  original: string,
  depth = 0
): string {
  const entry = byId.get(id);
  if (!entry) return original;
  return (english(language) ? entry.en : entry.zh).replace(/\{(\d+)\}/g, (_, index: string) => {
    const value = args[Number(index)] ?? '';
    // Only known error argument slots are prose; node names and identifiers stay unchanged.
    const errorSlot =
      (id === 'extra.32babf6f7d23' || id === 'extra.ebefe55a9e76' || id === 'extra.fb4ad514a1e9') &&
      Number(index) === 1;
    if (!errorSlot || depth >= 4) return value;
    const nested = identifyLogMessage(value);
    return nested ? renderLogEvent(nested.eventId, nested.args, language, value, depth + 1) : value;
  });
}

const levels: Record<LogLevel, [string, string]> = {
  debug: ['调试', 'DEBUG'],
  info: ['信息', 'INFO'],
  warn: ['警告', 'WARN'],
  error: ['错误', 'ERROR'],
  fatal: ['致命', 'FATAL'],
};
export const logLevelLabel = (level: LogLevel, language: string): string =>
  levels[level][english(language) ? 1 : 0];
const sources: Record<string, string> = {
  Main: '主进程',
  Renderer: '界面',
  TrayManager: '托盘',
  Subscription: '订阅',
  SubScheduler: '订阅更新',
  SpeedTest: '测速',
  ProxyManager: '代理管理',
  ConfigManager: '配置',
  RoutingData: '分流数据',
  AutoSwitch: '自动切换',
  HelperManager: '提权助手',
  CoreUpdate: '内核更新',
  UpdateService: '应用更新',
  IpcHandlerRegistry: 'IPC',
  Diagnostic: '诊断',
  SmartRouting: '智能分流',
  CompatibilityCore: '兼容内核',
  IconProtocol: '应用图标',
  StatsWorker: '网络统计',
  ExitProbeLatency: '出口延迟',
  Unlock: '网站连通性',
  AutoStart: '开机启动',
  CoreUpdateService: '内核更新',
  Helper: '提权助手',
  ProtocolParser: '协议解析',
  ResourceManager: '资源管理',
  SystemDns: '系统 DNS',
  SystemProxy: '系统代理',
  WarpDeregisterQueue: 'WARP 注销',
  WarpService: 'WARP 服务',
  CoreDownloader: '内核下载',
};
export const logSourceLabel = (source: string, language: string): string =>
  english(language) ? source : (sources[source] ?? source);

export function presentLog(log: LogEntry, language: string): { message: string; source: string } {
  return {
    message: log.eventId
      ? renderLogEvent(log.eventId, log.eventArgs ?? [], language, log.message)
      : translateLogMessage(log.message, language),
    source: logSourceLabel(log.source, language),
  };
}

/** Stable ids merge overlapping snapshots/live batches. Older records retain their complete tuple identity. */
export function mergeLogEntries(
  previous: LogEntry[],
  incoming: LogEntry[],
  limit = 2000
): LogEntry[] {
  const entries = new Map<string, LogEntry>();
  for (const log of [...previous, ...incoming]) {
    const key =
      log.id ?? JSON.stringify([log.timestamp, log.level, log.source, log.message, log.stack]);
    entries.set(key, log);
  }
  return [...entries.values()].slice(-limit);
}
