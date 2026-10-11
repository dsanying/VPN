import { connect } from 'net';
import type { MihomoApiClient } from './MihomoApiClient';

/** The controller starts before configuration application. This only checks startup,
 * not remote reachability or whether a proxy can complete an actual request. */
export async function probeMihomoReadiness(
  api: Pick<MihomoApiClient, 'probe' | 'request'>,
  config: Record<string, unknown>,
  timeoutMs: number
): Promise<void> {
  await api.probe(timeoutMs);
  const groups = await api.request<{ proxies: Record<string, unknown> }>(
    'GET',
    '/proxies',
    undefined,
    timeoutMs
  );
  const expectedGroups = [
    ...((config['proxy-groups'] ?? []) as Array<{ name: string }>),
    ...((config.proxies ?? []) as Array<{ name: string }>),
  ];
  if (
    !groups.proxies ||
    !expectedGroups.every((group) => Object.hasOwn(groups.proxies, group.name))
  )
    throw new Error('Mihomo proxy groups are not ready');
  const policy = await api.request<{ rules: Array<{ type: string; proxy: string }> }>(
    'GET',
    '/rules',
    undefined,
    timeoutMs
  );
  const expectedRules = (config.rules ?? []) as string[];
  const final = expectedRules.at(-1)?.split(',');
  if (
    !Array.isArray(policy.rules) ||
    policy.rules.length !== expectedRules.length ||
    (final?.[0] === 'MATCH' && policy.rules.at(-1)?.proxy !== final[1])
  )
    throw new Error('Mihomo routing policy is not ready');

  const listeners = (config.listeners ?? []) as Array<{ port?: number; listen?: string }>;
  const addresses = [
    { port: config['mixed-port'], host: '127.0.0.1' },
    ...listeners.map((listener) => ({ port: listener.port, host: listener.listen ?? '127.0.0.1' })),
  ];
  const dns = config.dns as { enable?: boolean; listen?: string } | undefined;
  // Mihomo binds DNS TCP and UDP together. Wait for the configured TCP endpoint
  // before allowing the first UDP lookup to race against configuration startup.
  if (dns?.enable && dns.listen) {
    const endpoint = new URL(`tcp://${dns.listen}`);
    addresses.push({ port: Number(endpoint.port), host: endpoint.hostname });
  }
  await Promise.all(
    addresses
      .filter(({ port }) => typeof port === 'number' && port > 0)
      .map(
        ({ port, host }) =>
          new Promise<void>((resolve, reject) => {
            const socket = connect(Number(port), host === '0.0.0.0' ? '127.0.0.1' : host);
            socket.once('connect', () => {
              socket.destroy();
              resolve();
            });
            socket.once('error', reject);
            socket.setTimeout(timeoutMs, () =>
              socket.destroy(new Error('Mihomo listener is not ready'))
            );
          })
      )
  );
}
