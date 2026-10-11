import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import type { ConnectionEntry, ConnectionsSnapshot } from '../../shared/types';

const exec = promisify(execFile);
const options = { timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true };

function endpoint(text: string): { ip: string; port: string } | undefined {
  const match = text.match(/^(?:\[([^\]]+)\]|(.+)):(\d+)$/);
  if (!match || !isIP(match[1] || match[2]) || Number(match[3]) > 65535) return;
  return { ip: match[1] || match[2], port: match[3] };
}

function connection(
  pid: number,
  key: string,
  local: string,
  remote: string,
  network: string,
  processPath?: string,
  processName?: string
): ConnectionEntry | undefined {
  const source = endpoint(local);
  const target = endpoint(remote);
  if (!source || !target || !Number.isSafeInteger(pid) || pid < 0) return;
  return {
    id: `device:${pid}:${key}:${network}:${local}:${remote}`,
    chains: [],
    rule: '',
    rulePayload: '',
    outbound: 'system-network',
    metadata: {
      sourceIP: source.ip,
      sourcePort: source.port,
      destinationIP: target.ip,
      destinationPort: target.port,
      network,
      processId: pid || undefined,
      processPath,
      processName,
    },
  };
}

export function parseProcessPaths(text: string): Map<number, string> {
  const paths = new Map<number, string>();
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\/.*)$/);
    if (match) paths.set(Number(match[1]), match[2].trim());
  }
  return paths;
}

/** lsof NUL fields preserve application names containing spaces. No reverse-DNS guesses. */
export function parseLsofConnections(text: string, paths: Map<number, string>): ConnectionEntry[] {
  let pid = 0;
  let processName = '';
  let fd = '';
  let protocol = '';
  let address = '';
  let state = '';
  const entries: ConnectionEntry[] = [];
  const flush = () => {
    if (protocol !== 'UDP' && !(protocol === 'TCP' && state === 'ESTABLISHED')) return;
    const pair = address.split('->');
    if (pair.length !== 2) return; // Listening/unconnected UDP sockets have no observed target.
    const entry = connection(
      pid,
      fd,
      pair[0],
      pair[1],
      protocol.toLowerCase(),
      paths.get(pid),
      processName
    );
    if (entry) entries.push(entry);
  };
  for (const field of text.split('\0')) {
    const value = field.replace(/^\n+/, '');
    if (value.startsWith('p')) {
      flush();
      pid = Number(value.slice(1));
      processName = '';
      fd = '';
      address = '';
      state = '';
      protocol = '';
    } else if (value.startsWith('c')) processName = value.slice(1);
    else if (value.startsWith('f')) {
      flush();
      fd = value.slice(1);
      address = '';
      state = '';
      protocol = '';
    } else if (value.startsWith('P')) protocol = value.slice(1);
    else if (value.startsWith('n')) address = value.slice(1);
    else if (value.startsWith('TST=')) state = value.slice(4);
  }
  flush();
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

export function parseSsConnections(text: string): ConnectionEntry[] {
  return text.split('\n').flatMap((line, index) => {
    const cells = line.trim().split(/\s+/);
    if (!['tcp', 'udp'].includes(cells[0]) || cells[1] !== 'ESTAB') return [];
    const pid = Number(line.match(/pid=(\d+)/)?.[1] || 0);
    const entry = connection(
      pid,
      String(index),
      cells[4],
      cells[5],
      cells[0],
      undefined,
      line.match(/users:\(\("([^"]+)"/)?.[1]
    );
    return entry ? [entry] : [];
  });
}

export function parseWindowsConnections(text: string): ConnectionEntry[] {
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('Invalid system connection list');
  return rows.flatMap((row, index) => {
    if (!row || typeof row !== 'object') return [];
    const value = row as Record<string, unknown>;
    const local = String(value.LocalAddress);
    const remote = String(value.RemoteAddress);
    const entry = connection(
      Number(value.OwningProcess),
      String(index),
      `${isIP(local) === 6 ? `[${local}]` : local}:${value.LocalPort}`,
      `${isIP(remote) === 6 ? `[${remote}]` : remote}:${value.RemotePort}`,
      'tcp',
      typeof value.ProcessPath === 'string' ? value.ProcessPath : undefined,
      typeof value.ProcessName === 'string' ? value.ProcessName : undefined
    );
    return entry ? [entry] : [];
  });
}

export async function readDeviceConnections(): Promise<ConnectionEntry[]> {
  if (process.platform === 'darwin') {
    const [sockets, processes] = await Promise.all([
      exec('/usr/sbin/lsof', ['-nP', '+c', '0', '-iTCP', '-iUDP', '-F0pcfnPT'], options).catch(
        (error) => {
          if (error.code === 1 && !error.stdout && !error.stderr) return { stdout: '' };
          throw error;
        }
      ),
      exec('/bin/ps', ['-axo', 'pid=,comm='], options),
    ]);
    return parseLsofConnections(sockets.stdout, parseProcessPaths(processes.stdout));
  }
  if (process.platform === 'linux') {
    const { stdout } = await exec('ss', ['-Htunap'], options);
    const entries = parseSsConnections(stdout);
    const paths = new Map(
      await Promise.all(
        [
          ...new Set(
            entries.map((entry) => entry.metadata?.processId).filter((pid): pid is number => !!pid)
          ),
        ].map(async (pid) => {
          try {
            return [pid, await readlink(`/proc/${pid}/exe`)] as const;
          } catch {
            return [pid, undefined] as const;
          }
        })
      )
    );
    return entries.map((entry) => ({
      ...entry,
      metadata: { ...entry.metadata, processPath: paths.get(entry.metadata!.processId!) },
    }));
  }
  if (process.platform === 'win32') {
    const { stdout } = await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference="Stop"; $paths=@{}; Get-CimInstance Win32_Process | ForEach-Object { $paths[[int]$_.ProcessId]=$_ }; ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Established | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess,@{Name="ProcessPath";Expression={$paths[[int]$_.OwningProcess].ExecutablePath}},@{Name="ProcessName";Expression={$paths[[int]$_.OwningProcess].Name}})',
      ],
      options
    );
    return parseWindowsConnections(stdout);
  }
  throw new Error('System connection collection unsupported');
}

/** Passive, unprivileged, demand-driven collection. Never starts a proxy or changes routes. */
export class DeviceConnectionsService {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private enabled = false;
  private pending: Promise<void> | undefined;
  constructor(
    private readonly update: (snapshot: ConnectionsSnapshot) => void,
    private readonly read = readDeviceConnections
  ) {}
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    if (!enabled) return;
    const loop = async () => {
      await this.pending;
      if (generation !== this.generation) return;
      const task = this.sample(generation);
      this.pending = task;
      await task;
      if (this.pending === task) this.pending = undefined;
      if (generation === this.generation) {
        this.timer = setTimeout(() => void loop(), 3000);
        this.timer.unref();
      }
    };
    void loop();
  }
  private async sample(generation: number): Promise<void> {
    try {
      const connections = await this.read();
      if (generation === this.generation)
        this.update({ connections, at: Date.now(), source: 'device' });
    } catch {
      if (generation === this.generation)
        this.update({ connections: [], at: Date.now(), source: 'device', unavailable: true });
    }
  }
}
