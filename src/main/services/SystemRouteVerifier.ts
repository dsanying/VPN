import * as http from 'http';
import * as https from 'https';
import type { SingBoxConnection } from './singbox-api-client';

export interface SystemRouteExpectation {
  /** Actual leaf outbound, never a selector that might currently select DIRECT. */
  outbound: string;
  rule?: string;
  processPath: string;
}
export interface SystemRouteVerification {
  status: 'verified' | 'wrong-route' | 'unobserved' | 'request-failed';
  elapsedMs: number;
  httpStatus?: number;
  observed?: { outbound: string; rule?: string; processPath?: string };
}

/**
 * TUN acceptance probe: an ordinary OS socket, system DNS and normal TLS validation.
 * Does not use a proxy agent, dedicated probe inbound or core URL-test endpoint.
 * This verifies THIS process only; it cannot attest to Firefox or another application's rules.
 * A successful response without the corresponding core connection is not a pass.
 */
export async function verifyTunSystemRoute(
  target: string,
  expected: SystemRouteExpectation,
  readConnections: () => Promise<SingBoxConnection[]>,
  timeoutMs = 8000
): Promise<SystemRouteVerification> {
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid system route verification target');
  if (!expected.outbound || !expected.processPath || timeoutMs <= 0 || timeoutMs > 30000)
    throw new Error('Invalid system route verification expectation');
  const start = Date.now();
  let sourcePort: number | undefined;
  let observed: SingBoxConnection | undefined;
  let finished = false;
  const destinationPort = url.port || (url.protocol === 'https:' ? '443' : '80');
  const observer = async () => {
    while (!finished) {
      try {
        const connections = await readConnections();
        const matched = connections.find((connection) => {
          const createdAt = Number(connection.createdAt);
          return (
            sourcePort !== undefined &&
            connection.source?.endsWith(`:${sourcePort}`) &&
            connection.destination?.endsWith(`:${destinationPort}`) &&
            connection.domain?.toLowerCase() === url.hostname.toLowerCase() &&
            Number.isFinite(createdAt) &&
            createdAt >= start
          );
        });
        if (matched) observed = matched;
      } catch {
        // Controller errors leave the route unverified; HTTP success is insufficient.
      }
      if (!finished) await new Promise((done) => setTimeout(done, 50));
    }
  };
  const observing = observer();
  let httpStatus: number | undefined;
  let successful: boolean;
  try {
    successful = await new Promise<boolean>((done) => {
      const request = (url.protocol === 'https:' ? https : http).request(
        url,
        { method: 'GET', agent: false, headers: { Connection: 'close' } },
        (response) => {
          httpStatus = response.statusCode;
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) request.destroy();
          });
          response.once('end', () =>
            done(httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300)
          );
          response.once('error', () => done(false));
          response.once('aborted', () => done(false));
        }
      );
      const timer = setTimeout(() => request.destroy(), timeoutMs);
      request.once('close', () => clearTimeout(timer));
      request.once('error', () => done(false));
      request.on('socket', (socket) => {
        socket.once('connect', () => {
          sourcePort = socket.localPort;
        });
      });
      request.end();
    });
  } finally {
    finished = true;
    // Do not let a stalled controller keep a completed socket probe alive indefinitely.
    await Promise.race([
      observing,
      new Promise((done) => {
        const timer = setTimeout(done, 100);
        timer.unref();
      }),
    ]);
  }
  const evidence = observed?.outbound
    ? {
        outbound: observed.outbound,
        rule: observed.rule,
        processPath: observed.processInfo?.processPath,
      }
    : undefined;
  const matches =
    evidence &&
    evidence.outbound === expected.outbound &&
    evidence.processPath === expected.processPath &&
    (expected.rule === undefined || evidence.rule === expected.rule);
  return {
    status: !successful
      ? 'request-failed'
      : !evidence
        ? 'unobserved'
        : matches
          ? 'verified'
          : 'wrong-route',
    elapsedMs: Date.now() - start,
    httpStatus,
    ...(evidence ? { observed: evidence } : {}),
  };
}
