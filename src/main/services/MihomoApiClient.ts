import * as http from 'http';
import * as net from 'net';
import type { CoreManagementClient } from './core-management';
import type {
  SingBoxConnection,
  SingBoxConnectionEvents,
  SingBoxStatus,
} from './singbox-api-client';

interface Connection {
  id: string;
  metadata: {
    network?: string;
    type?: string;
    sourceIP?: string;
    sourcePort?: string;
    destinationIP?: string;
    destinationPort?: string;
    host?: string;
    processPath?: string;
    uid?: number;
  };
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload?: string;
}
interface Snapshot {
  uploadTotal: number;
  downloadTotal: number;
  connections: Connection[];
  memory?: number;
}
const address = (ip = '', port = '') => `${net.isIP(ip) === 6 ? `[${ip}]` : ip}:${port}`;

/** Authenticated loopback controller. One snapshot poll supplies both subscriptions. */
export class MihomoApiClient implements CoreManagementClient {
  private timer?: NodeJS.Timeout;
  private running = false;
  private generation = 0;
  private requestInFlight = false;
  private readonly requests = new Set<http.ClientRequest>();
  private readonly statusListeners = new Set<(status: SingBoxStatus) => void>();
  private readonly connectionListeners = new Set<(events: SingBoxConnectionEvents) => void>();
  private previous?: { at: number; up: number; down: number };

  constructor(
    private readonly port: number,
    private readonly secret: string
  ) {}

  async request<T>(method: string, route: string, body?: unknown, timeoutMs = 5000): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<T>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: route,
          method,
          headers: {
            Authorization: `Bearer ${this.secret}`,
            ...(payload
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
              : {}),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
            if (data.length > 16 * 1024 * 1024)
              req.destroy(new Error('Controller response too large'));
          });
          res.on('error', reject);
          res.on('end', () => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`Mihomo controller returned HTTP ${res.statusCode ?? 0}`));
              return;
            }
            try {
              resolve((data ? JSON.parse(data) : undefined) as T);
            } catch {
              reject(new Error('Invalid controller response'));
            }
          });
        }
      );
      this.requests.add(req);
      req.once('close', () => this.requests.delete(req));
      req.once('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('Mihomo controller timed out')));
      req.end(payload);
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.ensurePolling();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.previous = undefined;
    for (const req of this.requests) req.destroy(new Error('Controller stopped'));
    this.statusListeners.clear();
    this.connectionListeners.clear();
  }

  async probe(timeoutMs = 5000): Promise<void> {
    await this.request('GET', '/version', undefined, timeoutMs);
  }
  async readConnections(timeoutMs = 5000): Promise<SingBoxConnection[]> {
    const snapshot = await this.request<Snapshot>('GET', '/connections', undefined, timeoutMs);
    if (!Array.isArray(snapshot.connections)) throw new Error('Invalid core connection snapshot');
    return snapshot.connections.map(toCoreConnection);
  }
  async selectOutbound(group: string, member: string): Promise<void> {
    await this.request('PUT', `/proxies/${encodeURIComponent(group)}`, { name: member });
  }
  async closeConnection(id: string): Promise<void> {
    await this.request('DELETE', `/connections/${encodeURIComponent(id)}`);
  }
  async closeAllConnections(): Promise<void> {
    await this.request('DELETE', '/connections');
  }

  subscribeStatus(_intervalNs: number, receive: (status: SingBoxStatus) => void): () => void {
    this.statusListeners.add(receive);
    this.ensurePolling();
    return () => {
      this.statusListeners.delete(receive);
      this.stopIdlePolling();
    };
  }
  subscribeConnections(
    _intervalNs: number,
    receive: (events: SingBoxConnectionEvents) => void
  ): () => void {
    this.connectionListeners.add(receive);
    this.ensurePolling();
    return () => {
      this.connectionListeners.delete(receive);
      this.stopIdlePolling();
    };
  }

  private stopIdlePolling(): void {
    if (this.statusListeners.size || this.connectionListeners.size) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  private ensurePolling(): void {
    if (
      !this.running ||
      this.timer ||
      (!this.statusListeners.size && !this.connectionListeners.size)
    )
      return;
    this.timer = setInterval(() => {
      void this.poll();
    }, 1000);
    this.timer.unref();
    void this.poll();
  }
  private async poll(): Promise<void> {
    if (!this.running || this.requestInFlight) return;
    const generation = this.generation;
    this.requestInFlight = true;
    try {
      const snapshot = await this.request<Snapshot>('GET', '/connections');
      if (!this.running || generation !== this.generation) return;
      const at = Date.now();
      const previous = this.previous;
      const seconds = previous ? Math.max((at - previous.at) / 1000, 0.001) : 1;
      const up = snapshot.uploadTotal;
      const down = snapshot.downloadTotal;
      if (!Number.isFinite(up) || !Number.isFinite(down) || !Array.isArray(snapshot.connections))
        return;
      this.previous = { at, up, down };
      const status: SingBoxStatus = {
        trafficAvailable: true,
        uplink: String(previous ? Math.max(0, up - previous.up) / seconds : 0),
        downlink: String(previous ? Math.max(0, down - previous.down) / seconds : 0),
        uplinkTotal: String(up),
        downlinkTotal: String(down),
        memory: snapshot.memory === undefined ? undefined : String(snapshot.memory),
        connectionsIn: snapshot.connections.length,
      };
      for (const receive of this.statusListeners) receive(status);
      const events: SingBoxConnectionEvents = {
        reset: true,
        events: snapshot.connections.map((c) => ({
          type: 'NEW',
          id: c.id,
          connection: toCoreConnection(c),
        })),
      };
      for (const receive of this.connectionListeners) receive(events);
    } catch {
      // A failed read produces no fabricated zero sample; the next poll reconnects.
    } finally {
      this.requestInFlight = false;
    }
  }
}

function toCoreConnection(c: Connection): SingBoxConnection {
  return {
    id: c.id,
    network: c.metadata.network,
    inboundType: c.metadata.type,
    source: address(c.metadata.sourceIP, c.metadata.sourcePort),
    destination: address(c.metadata.destinationIP, c.metadata.destinationPort),
    domain: c.metadata.host,
    createdAt: Number.isFinite(Date.parse(c.start)) ? String(Date.parse(c.start)) : undefined,
    uplinkTotal: String(c.upload),
    downlinkTotal: String(c.download),
    chainList: c.chains,
    outbound: c.chains[0],
    rule: c.rule,
    processInfo: { processPath: c.metadata.processPath, userId: c.metadata.uid },
  };
}
