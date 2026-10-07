import * as http from 'http';
import { JSONRPCClient } from 'json-rpc-2.0';

export interface HelperRpcResult {
  state: string;
  pid?: number;
  uid?: number;
  detail?: string;
  version?: string;
  capabilities?: string[];
}

/** JSON-RPC 2.0 over HTTP on a local socket/pipe; no legacy line protocol fallback. */
export async function requestHelper(
  socketPath: string,
  token: string | null,
  method: string,
  params: string[],
  timeoutMs: number
): Promise<HelperRpcResult> {
  const client = new JSONRPCClient(async (message) => {
    const body = JSON.stringify(message);
    const response = await new Promise<unknown>((resolve, reject) => {
      const request = http.request(
        {
          socketPath,
          path: '/rpc',
          method: 'POST',
          agent: false,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let length = 0;
          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 64 * 1024) request.destroy(new Error('helper response too large'));
            else chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => {
            clearTimeout(timer);
            if (res.statusCode !== 200) {
              reject(new Error(`helper HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
              reject(new Error('helper invalid JSON response'));
            }
          });
        }
      );
      const timer = setTimeout(
        () => request.destroy(new Error('helper request timeout')),
        timeoutMs
      );
      request.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      request.end(body);
    });
    client.receive(response as Parameters<typeof client.receive>[0]);
  });
  const result: unknown = await client.timeout(timeoutMs).request(method, params);
  if (
    !result ||
    typeof result !== 'object' ||
    typeof (result as HelperRpcResult).state !== 'string'
  ) {
    throw new Error('helper invalid result');
  }
  return result as HelperRpcResult;
}

/** Internal business adapter; only structured JSON-RPC objects cross the transport. */
export function formatHelperResult(result: HelperRpcResult): string {
  if (result.state === 'pong') return `OK pong uid=${result.uid} v${result.version}`;
  return `OK ${result.state}${result.pid !== undefined ? ` ${result.pid}` : result.detail ? ` ${result.detail}` : ''}`;
}

/** Root process kill(0) returns EPERM to an ordinary user, which still means alive. */
export async function waitForHelperProcessExit(pid: number, timeoutMs = 6500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return false;
}

/** Process Wait and system-state restoration both finish before the helper reports stopped. */
export async function waitForHelperStopped(
  status: () => Promise<string>,
  timeoutMs = 25000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await status();
    if (state === 'OK stopped' || state === 'OK notrunning') return true;
    if (!/^OK (?:running|stopping) \d+/.test(state)) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return false;
}
