import * as net from 'net';
import { performance } from 'perf_hooks';
import { execFile } from 'child_process';
import { lookup } from 'dns/promises';
import type { ServerConfig } from '../../shared/types';
import type { EntryProbeResult } from '../../shared/speed-test';
/** One-shot socket probe through a physical interface in the bundled platform helper. */
export function probeBoundEntry(
  address: string,
  port: number,
  helperPath: string,
  signal?: AbortSignal,
  transport: 'tcp' | 'quic' = 'tcp',
  obfs?: EntryObfs
): Promise<EntryProbeResult> {
  return new Promise((resolve) => {
    const child = execFile(
      helperPath,
      ['--entry-probe'],
      { timeout: 5000, maxBuffer: 4096, signal },
      (error, stdout) => {
        if (error) {
          resolve({
            status: 'unavailable',
            reason: signal?.aborted ? 'ENTRY_ABORTED' : 'ENTRY_HELPER_UNAVAILABLE',
          });
          return;
        }
        try {
          const result = JSON.parse(stdout) as EntryProbeResult;
          if (
            !['ok', 'timeout', 'failed', 'unavailable'].includes(result.status) ||
            (result.status === 'ok' &&
              (!Number.isFinite(result.latencyMs) || result.latencyMs! < 0))
          )
            throw new Error();
          resolve({
            status: result.status,
            ...(result.status === 'ok' ? { latencyMs: result.latencyMs } : {}),
            ...(result.reason && /^[A-Z0-9_]+$/.test(result.reason)
              ? { reason: result.reason }
              : {}),
          });
        } catch {
          resolve({ status: 'unavailable', reason: 'ENTRY_HELPER_UNAVAILABLE' });
        }
      }
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({ address, port, transport, obfs }));
  });
}

/** A macOS kernel route on en* bypasses utun. Other platforms fail closed:
 * Linux policy/nftables and Windows WFP can intercept despite a physical route. */
export function hasDirectEntryRoute(address: string): Promise<boolean> {
  if (process.platform !== 'darwin' || !net.isIP(address)) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      '/sbin/route',
      ['-n', 'get', ...(net.isIP(address) === 6 ? ['-inet6'] : []), address],
      { timeout: 2000, maxBuffer: 8192 },
      (error, stdout) => {
        resolve(!error && /^\s*interface:\s*en\d+\s*$/m.test(stdout));
      }
    );
  });
}

/** Measure the actual remote TCP connect event. CONNECT acknowledgements can be optimistic and are never RTT evidence. */
export async function probeNodeEntry(
  server: ServerConfig,
  directAvailable = true,
  deps: {
    directRoute?: (address: string) => Promise<boolean>;
    boundProbe?: (address: string, port: number, signal?: AbortSignal) => Promise<EntryProbeResult>;
    boundQUICProbe?: (
      address: string,
      port: number,
      signal?: AbortSignal
    ) => Promise<EntryProbeResult>;
    signal?: AbortSignal;
    resolve?: (host: string) => Promise<{ address: string }[]>;
  } = {}
): Promise<EntryProbeResult> {
  if (deps.signal?.aborted) return { status: 'unavailable', reason: 'ENTRY_ABORTED' };
  const transport = entryTransport(server);
  const boundProbe =
    transport === 'udp' && supportsQUICEntry(server)
      ? deps.boundQUICProbe
      : transport === 'tcp'
        ? deps.boundProbe
        : undefined;
  if (transport !== 'tcp' && !boundProbe)
    return {
      status: 'unsupported',
      reason: transport === 'udp' ? 'NO_TCP_ENTRY' : 'ENTRY_UNSUPPORTED',
    };
  const raw = server.compatibilitySettings?.outbound ?? server.customSettings?.outbound;
  const settings = raw?.settings as
    | {
        vnext?: { address?: string; port?: number }[];
        servers?: { address?: string; port?: number }[];
      }
    | undefined;
  const destination = settings?.vnext?.[0] ?? settings?.servers?.[0];
  const host = server.address || raw?.server || destination?.address;
  const ports = entryPortCandidates(
    server,
    server.port || raw?.server_port || raw?.port || destination?.port
  );
  const port = ports[0];
  if (
    typeof host !== 'string' ||
    !host ||
    /[\s\r\n]/.test(host) ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return { status: 'failed', reason: 'ENTRY_INVALID_ENDPOINT' };
  let address = host.replace(/^\[([^\]]+)\]$/, '$1');
  if (!directAvailable || boundProbe) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = net.isIP(address)
        ? [{ address }]
        : await Promise.race([
            (deps.resolve ?? ((host) => lookup(host, { all: true })))(address),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(Object.assign(new Error(), { code: 'ETIMEDOUT' })),
                4000
              );
            }),
          ]);
      const candidates = [
        ...new Set(addresses.map((item) => item.address).filter((ip) => net.isIP(ip))),
      ];
      if (!candidates.length) return { status: 'failed', reason: 'ENOTFOUND' };
      if (deps.signal?.aborted) return { status: 'unavailable', reason: 'ENTRY_ABORTED' };
      if (boundProbe) {
        // Race address families; do not wait for a broken family after a successful dial.
        // Bound child processes share cancellation and a fixed deadline.
        const controller = new AbortController();
        const cancel = () => controller.abort();
        deps.signal?.addEventListener('abort', cancel, { once: true });
        const deadline = setTimeout(cancel, 5000);
        const results: EntryProbeResult[] = [];
        const endpoints = candidates.flatMap((address) => ports.map((port) => ({ address, port })));
        let next = 0;
        try {
          return await Promise.any(
            Array.from({ length: Math.min(2, endpoints.length) }, async () => {
              while (next < endpoints.length && !controller.signal.aborted) {
                const endpoint = endpoints[next++];
                const result = await boundProbe(endpoint.address, endpoint.port, controller.signal);
                if (result.status === 'ok') return result;
                results.push(result);
              }
              throw new Error('ENTRY_FAILED');
            })
          ).catch(() =>
            deps.signal?.aborted
              ? { status: 'unavailable' as const, reason: 'ENTRY_ABORTED' }
              : (results[0] ?? { status: 'timeout' as const })
          );
        } finally {
          cancel();
          clearTimeout(deadline);
          deps.signal?.removeEventListener('abort', cancel);
        }
      }
      const routes = await Promise.all(
        candidates.map(async (address) => ({
          address,
          direct: await (deps.directRoute ?? hasDirectEntryRoute)(address),
        }))
      );
      const direct = routes.find((item) => item.direct);
      if (!direct) return { status: 'unavailable', reason: 'ROUTE_UNVERIFIED' };
      // Pin the verified IP: resolving the hostname again could select a captured address.
      address = direct.address;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        status: code === 'ETIMEDOUT' ? 'timeout' : 'failed',
        ...(code && /^[A-Z0-9_]+$/.test(code) ? { reason: code } : {}),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return new Promise((resolve) => {
    let settled = false;
    let socket: net.Socket | undefined;
    const start = performance.now();
    const finish = (status: EntryProbeResult['status'], reason?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deps.signal?.removeEventListener('abort', abort);
      socket?.destroy();
      resolve(
        status === 'ok'
          ? { status, latencyMs: Math.round(performance.now() - start) }
          : { status, ...(reason ? { reason } : {}) }
      );
    };
    const abort = () => finish('unavailable', 'ENTRY_ABORTED');
    const timer = setTimeout(() => finish('timeout'), 4000);
    deps.signal?.addEventListener('abort', abort, { once: true });
    if (deps.signal?.aborted) {
      abort();
      return;
    }
    try {
      socket = net.createConnection({ host: address, port });
      socket.on('connect', () => finish('ok'));
      socket.on('error', (error: NodeJS.ErrnoException) => finish('failed', error.code));
    } catch {
      finish('failed');
    }
  });
}

/** Classify the node's actual transport, including retained core-native subscriptions. */
export function entryTransport(server: ServerConfig): 'tcp' | 'udp' | 'unknown' {
  const raw = server.compatibilitySettings?.outbound ?? server.customSettings?.outbound;
  const engine = server.compatibilitySettings?.engine;
  const protocol = String(
    server.protocol === 'custom'
      ? (raw?.[engine === 'xray' ? 'protocol' : 'type'] ?? '')
      : server.protocol
  ).toLowerCase();
  const stream = raw?.streamSettings as Record<string, unknown> | undefined;
  const nativeTransport = raw?.transport as Record<string, unknown> | undefined;
  const network = String(
    stream?.network ?? raw?.network ?? nativeTransport?.type ?? server.network ?? 'tcp'
  ).toLowerCase();
  if (
    ['hysteria', 'hysteria2', 'tuic', 'wireguard', 'tailscale'].includes(protocol) ||
    (protocol === 'naive' && (server.naiveSettings?.useHttp3 || raw?.quic === true)) ||
    ['quic', 'kcp', 'mkcp', 'h3'].includes(network)
  )
    return 'udp';
  if (
    ![
      'tcp',
      'raw',
      'ws',
      'websocket',
      'grpc',
      'http',
      'h2',
      'httpupgrade',
      'xhttp',
      'splithttp',
    ].includes(network)
  )
    return 'unknown';
  return [
    'ss',
    'ssr',
    'shadowsocks',
    'shadowsocksr',
    'vmess',
    'vless',
    'trojan',
    'socks',
    'socks5',
    'http',
    'naive',
    'anytls',
    'snell',
    'ssh',
  ].includes(protocol)
    ? 'tcp'
    : 'unknown';
}

export interface EntryObfs {
  type: 'salamander' | 'gecko';
  password: string;
  minPacketSize?: number;
  maxPacketSize?: number;
}
export function quicEntryObfs(server: ServerConfig): EntryObfs | undefined {
  const raw = server.compatibilitySettings?.outbound ?? server.customSettings?.outbound;
  const obfs = server.hysteria2Settings?.obfs ?? raw?.obfs;
  if (!obfs) return undefined;
  const value =
    typeof obfs === 'string'
      ? { type: obfs, password: raw?.['obfs-password'] }
      : (obfs as Record<string, unknown>);
  return {
    type: value.type as EntryObfs['type'],
    password: value.password as string,
    minPacketSize: (value.minPacketSize ?? value.min_packet_size) as number | undefined,
    maxPacketSize: (value.maxPacketSize ?? value.max_packet_size) as number | undefined,
  };
}
/** QUIC response probing measures entry RTT, not authenticated proxy usability. */
export function supportsQUICEntry(server: ServerConfig): boolean {
  const raw = server.compatibilitySettings?.outbound ?? server.customSettings?.outbound;
  const protocol = String(
    server.protocol === 'custom' ? (raw?.type ?? '') : server.protocol
  ).toLowerCase();
  const obfs = quicEntryObfs(server);
  if (
    obfs &&
    (!['salamander', 'gecko'].includes(obfs.type) ||
      typeof obfs.password !== 'string' ||
      !obfs.password ||
      Buffer.byteLength(obfs.password) > 1024)
  )
    return false;
  return (
    ['hysteria', 'hysteria2', 'tuic'].includes(protocol) ||
    (protocol === 'naive' && !!(server.naiveSettings?.useHttp3 || raw?.quic))
  );
}

/** Sample hopping ranges without scanning every port or extending the shared deadline. */
export function entryPortCandidates(server: ServerConfig, fallback: unknown): number[] {
  const raw = server.compatibilitySettings?.outbound ?? server.customSettings?.outbound;
  const protocol = String(
    server.protocol === 'custom' ? (raw?.type ?? '') : server.protocol
  ).toLowerCase();
  const ranges =
    protocol === 'hysteria2'
      ? (server.hysteria2Settings?.serverPorts ??
        (Array.isArray(raw?.server_ports) ? raw.server_ports.join(',') : undefined))
      : undefined;
  if (!ranges)
    return typeof fallback === 'number' &&
      Number.isInteger(fallback) &&
      fallback > 0 &&
      fallback <= 65535
      ? [fallback]
      : [];
  if (typeof ranges !== 'string' || ranges.length > 4096) return [];
  const result: number[] = [];
  for (const range of ranges.split(',')) {
    const match = /^\s*(\d{1,5})(?:(?::|-)(\d{1,5}))?\s*$/.exec(range);
    if (!match) return [];
    const low = Number(match[1]),
      high = Number(match[2] ?? match[1]);
    if (low < 1 || high > 65535 || low > high) return [];
    result.push(low, high, Math.floor((low + high) / 2));
  }
  return [...new Set(result)].slice(0, 4);
}
