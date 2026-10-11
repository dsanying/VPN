import { createServer } from 'net';
import { once } from 'events';
import { probeMihomoReadiness } from '../mihomo-readiness';
import type { MihomoApiClient } from '../MihomoApiClient';

function controller(groups: string[], rules: Array<{ type: string; proxy: string }>) {
  return {
    probe: jest.fn(async () => {}),
    request: jest.fn(async (_method: string, route: string) =>
      route === '/proxies'
        ? { proxies: Object.fromEntries(groups.map((name) => [name, {}])) }
        : { rules }
    ),
  } as unknown as Pick<MihomoApiClient, 'probe' | 'request'>;
}
const config = { 'proxy-groups': [{ name: 'selected' }], rules: ['MATCH,selected'] };

it('rejects a responding version endpoint until groups and routing policy are applied', async () => {
  await expect(probeMihomoReadiness(controller([], []), config, 100)).rejects.toThrow('groups');
  await expect(probeMihomoReadiness(controller(['selected'], []), config, 100)).rejects.toThrow(
    'policy'
  );
  await expect(
    probeMihomoReadiness(
      controller(['selected'], [{ type: 'Match', proxy: 'DIRECT' }]),
      config,
      100
    )
  ).rejects.toThrow('policy');
  await expect(
    probeMihomoReadiness(
      controller(['selected'], [{ type: 'Match', proxy: 'selected' }]),
      config,
      100
    )
  ).resolves.toBeUndefined();
});

it('requires the configured DNS listener as well as the loaded policy', async () => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as { port: number }).port;
  const withDns = { ...config, dns: { enable: true, listen: `127.0.0.1:${port}` } };
  const api = controller(['selected'], [{ type: 'Match', proxy: 'selected' }]);
  try {
    await expect(probeMihomoReadiness(api, withDns, 100)).resolves.toBeUndefined();
  } finally {
    await new Promise<void>((done) => listener.close(() => done()));
  }
  await expect(probeMihomoReadiness(api, withDns, 100)).rejects.toThrow();
});

it('requires auxiliary node and dial proxies even with already-bound listeners', async () => {
  const auxiliary = { proxies: [{ name: 'node-0' }, { name: 'dial-0' }], rules: ['MATCH,REJECT'] };
  const policy = [{ type: 'Match', proxy: 'REJECT' }];
  await expect(
    probeMihomoReadiness(controller(['node-0'], policy), auxiliary, 100)
  ).rejects.toThrow('groups');
  await expect(
    probeMihomoReadiness(controller(['node-0', 'dial-0'], policy), auxiliary, 100)
  ).resolves.toBeUndefined();
});
