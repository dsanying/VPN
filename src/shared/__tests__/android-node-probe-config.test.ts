import { buildAndroidNodeProbeConfig } from '../android-node-probe-config';
import { createDefaultConfig } from '../config-defaults';
import type { ServerConfig } from '../types';
const node = (id: string): ServerConfig => ({
  id,
  name: id,
  protocol: 'vless',
  address: 'example.com',
  port: 443,
  uuid: '00000000-0000-4000-8000-000000000001',
});
const host = { stateDirectory: '/data/user/0/com.dsanying.shadowvpn.app/files/core' };
test('probe has no listeners, app rules, or dependence on unrelated incompatible nodes', () => {
  const subject = node('one'),
    unrelated = { ...node('other'), network: 'xhttp' as const };
  const saved = { ...createDefaultConfig('fixture'), servers: [subject, unrelated] };
  const result = buildAndroidNodeProbeConfig(subject, saved, host);
  const config = JSON.parse(result.config);
  expect(result.tag).toBe('node-one');
  expect(config.inbounds).toBeUndefined();
  expect(config.services).toBeUndefined();
  expect(config.route.rules).toEqual([]);
  expect(config.outbounds.some((outbound: { tag: string }) => outbound.tag === 'node-other')).toBe(
    false
  );
});
test('probe retains complete chained-node transport fields and rejects broken chains', () => {
  const subject = {
    ...node('one'),
    detour: 'two',
    network: 'ws' as const,
    wsSettings: { path: '/tunnel' },
  };
  const upstream = node('two');
  const saved = { ...createDefaultConfig('fixture'), servers: [subject, upstream] };
  const compiled = JSON.parse(buildAndroidNodeProbeConfig(subject, saved, host).config);
  const outbound = compiled.outbounds.find(
    (candidate: { tag: string }) => candidate.tag === 'node-one'
  );
  expect(outbound.transport.path).toBe('/tunnel');
  expect(outbound.detour).toBe('node-two');
  expect(
    compiled.outbounds.some((candidate: { tag: string }) => candidate.tag === 'node-two')
  ).toBe(true);
  expect(() =>
    buildAndroidNodeProbeConfig(subject, { ...saved, servers: [subject] }, host)
  ).toThrow('target does not exist');
  upstream.detour = 'one';
  expect(() => buildAndroidNodeProbeConfig(subject, saved, host)).toThrow('cycle');
});
