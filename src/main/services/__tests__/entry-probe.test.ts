import * as net from 'net';
import { probeNodeEntry } from '../entry-probe';
import type { ServerConfig } from '../../../shared/types';
const node = {
  id: 'example',
  name: 'Example',
  protocol: 'vless',
  address: '127.0.0.1',
  port: 443,
} as ServerConfig;
it.each(['vless', 'shadowsocks', 'custom'] as const)(
  '%s measures the actual TCP entry without treating it as proxy verification',
  async (protocol) => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const result = await probeNodeEntry({
        ...node,
        protocol,
        ...(protocol === 'custom'
          ? { compatibilitySettings: { engine: 'mihomo' as const, outbound: { type: 'ssr' } } }
          : {}),
        port: (server.address() as net.AddressInfo).port,
      });
      expect(result.status).toBe('ok');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
);
it.each(['hysteria2', 'tuic', 'wireguard', 'tailscale', 'custom'])(
  '%s does not produce a fake TCP timeout',
  async (protocol) => {
    expect(await probeNodeEntry({ ...node, protocol } as ServerConfig)).toEqual({
      status: 'unsupported',
      reason: protocol === 'custom' ? 'ENTRY_UNSUPPORTED' : 'NO_TCP_ENTRY',
    });
  }
);
it('TUN path is not measured through an optimistic local CONNECT acknowledgement', async () => {
  const connect = jest.spyOn(net, 'createConnection');
  try {
    expect(
      await probeNodeEntry({ ...node, address: '203.0.113.1', port: 8443 }, false, {
        directRoute: async () => false,
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'ROUTE_UNVERIFIED',
    });
    expect(connect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
});
it('entry rejection is distinct from an unsupported transport', async () => {
  expect((await probeNodeEntry({ ...node, port: 0 })).status).toBe('failed');
  expect((await probeNodeEntry({ ...node, address: 'bad\r\nhost' })).status).toBe('failed');
});
it('retains the socket error code without persisting private error messages', async () => {
  const { EventEmitter } = await import('events');
  const socket = Object.assign(new EventEmitter(), { destroy: jest.fn() });
  const connect = jest
    .spyOn(require('net'), 'createConnection')
    .mockReturnValue(socket as unknown as net.Socket);
  let isolatedProbe: typeof probeNodeEntry;
  jest.isolateModules(() => {
    isolatedProbe = require('../entry-probe').probeNodeEntry;
  });
  try {
    const result = isolatedProbe!(node);
    socket.emit(
      'error',
      Object.assign(new Error('private node address'), { code: 'EHOSTUNREACH' })
    );
    expect(await result).toEqual({ status: 'failed', reason: 'EHOSTUNREACH' });
    expect(socket.destroy).toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
});

it('TUN still measures a verified bypass route, pinning the resolved address', async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const resolveHost = jest.fn(async () => [{ address: '203.0.113.1' }, { address: '127.0.0.1' }]);
  try {
    const result = await probeNodeEntry(
      { ...node, address: 'example.com', port: (server.address() as net.AddressInfo).port },
      false,
      {
        resolve: resolveHost,
        directRoute: async (ip) => ip === '127.0.0.1',
      }
    );
    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(resolveHost).toHaveBeenCalledTimes(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('TUN DNS failure is reported without a fake unsupported transport', async () => {
  expect(
    await probeNodeEntry({ ...node, address: 'example.com' }, false, {
      resolve: async () => {
        throw Object.assign(new Error('private name'), { code: 'ENOTFOUND' });
      },
    })
  ).toEqual({ status: 'failed', reason: 'ENOTFOUND' });
});

it('Naive HTTP/3 is a UDP entry, not a TCP probe', async () => {
  expect(
    await probeNodeEntry({ ...node, protocol: 'naive', naiveSettings: { useHttp3: true } })
  ).toEqual({ status: 'unsupported', reason: 'NO_TCP_ENTRY' });
});

it.each([true, false])(
  'a bound probe always uses the direct interface, even with directAvailable=%s',
  async (directAvailable) => {
    const boundProbe = jest.fn(async () => ({ status: 'ok' as const, latencyMs: 45 }));
    expect(await probeNodeEntry(node, directAvailable, { boundProbe })).toEqual({
      status: 'ok',
      latencyMs: 45,
    });
    expect(boundProbe).toHaveBeenCalledWith('127.0.0.1', 443, expect.any(AbortSignal));
  }
);
it('dual-stack entry preserves an available IPv6 result when IPv4 fails', async () => {
  expect(
    await probeNodeEntry({ ...node, address: 'example.com' }, false, {
      resolve: async () => [{ address: '203.0.113.1' }, { address: '2001:db8::1' }],
      boundProbe: async (ip) =>
        ip.includes(':')
          ? { status: 'ok', latencyMs: 15 }
          : { status: 'failed', reason: 'ENETUNREACH' },
    })
  ).toEqual({ status: 'ok', latencyMs: 15 });
});

it.each(['quic', 'kcp', 'mkcp'])(
  'core-native %s entry never probes a TCP port',
  async (network) => {
    const probe = jest.fn();
    expect(
      await probeNodeEntry(
        {
          ...node,
          protocol: 'custom',
          compatibilitySettings: {
            engine: 'xray',
            outbound: { protocol: 'vless', streamSettings: { network } },
          },
        },
        true,
        { boundProbe: probe }
      )
    ).toEqual({ status: 'unsupported', reason: 'NO_TCP_ENTRY' });
    expect(probe).not.toHaveBeenCalled();
  }
);
it('core-native Xray TCP and bracketed IPv6 retain a direct entry test', async () => {
  const probe = jest.fn(async () => ({ status: 'ok' as const, latencyMs: 8 }));
  expect(
    (
      await probeNodeEntry(
        {
          ...node,
          address: '[::1]',
          protocol: 'custom',
          compatibilitySettings: {
            engine: 'xray',
            outbound: { protocol: 'vmess', streamSettings: { network: 'raw' } },
          },
        },
        true,
        { boundProbe: probe }
      )
    ).status
  ).toBe('ok');
  expect(probe).toHaveBeenCalledWith('::1', 443, expect.any(AbortSignal));
});
it('dual-stack success returns before a slow family and cancels remaining child probes', async () => {
  let cancelled = false;
  const result = await probeNodeEntry({ ...node, address: 'example.com' }, false, {
    resolve: async () => [{ address: '192.0.2.1' }, { address: '2001:db8::1' }],
    boundProbe: async (ip, _port, signal) => {
      if (ip.includes(':')) return { status: 'ok', latencyMs: 5 };
      return new Promise((resolve) =>
        signal!.addEventListener(
          'abort',
          () => {
            cancelled = true;
            resolve({ status: 'unavailable', reason: 'ENTRY_ABORTED' });
          },
          { once: true }
        )
      );
    },
  });
  expect(result).toEqual({ status: 'ok', latencyMs: 5 });
  expect(cancelled).toBe(true);
});
it('cancelled entry never creates a socket', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await probeNodeEntry(node, true, { signal: controller.signal })).toEqual({
    status: 'unavailable',
    reason: 'ENTRY_ABORTED',
  });
});
it('empty/invalid DNS answers fail without invoking the helper', async () => {
  const probe = jest.fn();
  expect(
    await probeNodeEntry({ ...node, address: 'example.com' }, true, {
      resolve: async () => [{ address: 'not-an-ip' }],
      boundProbe: probe,
    })
  ).toEqual({ status: 'failed', reason: 'ENOTFOUND' });
  expect(probe).not.toHaveBeenCalled();
});

it('raw custom node endpoints are measured without requiring duplicate address fields', async () => {
  const probe = jest.fn(async () => ({ status: 'ok' as const, latencyMs: 9 }));
  const custom = {
    id: 'n',
    name: 'n',
    protocol: 'custom',
    customSettings: {
      outbound: { type: 'trojan', server: '192.0.2.1', server_port: 8443 },
    },
  } as unknown as ServerConfig;
  expect((await probeNodeEntry(custom, true, { boundProbe: probe })).status).toBe('ok');
  expect(probe).toHaveBeenCalledWith('192.0.2.1', 8443, expect.any(AbortSignal));
});

it.each(['hysteria2', 'tuic', 'naive'] as const)(
  '%s uses an actual QUIC response probe independently of routing mode',
  async (protocol) => {
    const quic = jest.fn(async () => ({ status: 'ok' as const, latencyMs: 9 }));
    const tcp = jest.fn();
    const result = await probeNodeEntry(
      { ...node, protocol, ...(protocol === 'naive' ? { naiveSettings: { useHttp3: true } } : {}) },
      false,
      { boundProbe: tcp, boundQUICProbe: quic }
    );
    expect(result).toEqual({ status: 'ok', latencyMs: 9 });
    expect(tcp).not.toHaveBeenCalled();
    expect(quic).toHaveBeenCalledWith('127.0.0.1', 443, expect.any(AbortSignal));
  }
);
it('does not send plaintext QUIC to an unknown obfuscation entry', async () => {
  const probe = jest.fn();
  const result = await probeNodeEntry(
    {
      ...node,
      protocol: 'hysteria2',
      hysteria2Settings: { obfs: { type: 'unknown' as 'salamander', password: 'example-secret' } },
    },
    false,
    { boundQUICProbe: probe }
  );
  expect(result.status).toBe('unsupported');
  expect(probe).not.toHaveBeenCalled();
});
it('retained native TUIC nodes share the UDP entry capability', async () => {
  const probe = jest.fn(async () => ({ status: 'timeout' as const }));
  const result = await probeNodeEntry(
    {
      ...node,
      protocol: 'custom',
      compatibilitySettings: { engine: 'mihomo', outbound: { type: 'tuic' } },
    },
    true,
    { boundQUICProbe: probe }
  );
  expect(result).toEqual({ status: 'timeout' });
  expect(probe).toHaveBeenCalledTimes(1);
});

it.each(['salamander', 'gecko'] as const)(
  'supports Hysteria %s without a TCP fallback',
  async (type) => {
    const probe = jest.fn(async () => ({ status: 'ok' as const, latencyMs: 12 }));
    const result = await probeNodeEntry(
      {
        ...node,
        protocol: 'hysteria2',
        hysteria2Settings: { obfs: { type, password: 'example-secret' } },
      },
      false,
      { boundQUICProbe: probe }
    );
    expect(result.status).toBe('ok');
    expect(probe).toHaveBeenCalledTimes(1);
  }
);

it('hopping ranges are probed without testing an unrelated base TCP port', async () => {
  const probe = jest.fn(async (_ip: string, port: number) =>
    port === 30000 ? { status: 'ok' as const, latencyMs: 10 } : { status: 'failed' as const }
  );
  const result = await probeNodeEntry(
    {
      ...node,
      protocol: 'hysteria2',
      port: 443,
      hysteria2Settings: { serverPorts: '20000:30000' },
    },
    false,
    { boundQUICProbe: probe }
  );
  expect(result.status).toBe('ok');
  expect(probe.mock.calls.map((call) => call[1])).toEqual(expect.arrayContaining([20000, 30000]));
  expect(probe.mock.calls.map((call) => call[1])).not.toContain(443);
});
it('malformed hopping ranges fail closed instead of probing the base port', async () => {
  const probe = jest.fn();
  const result = await probeNodeEntry(
    { ...node, protocol: 'hysteria2', hysteria2Settings: { serverPorts: '30000:20000' } },
    false,
    { boundQUICProbe: probe }
  );
  expect(result).toEqual({ status: 'failed', reason: 'ENTRY_INVALID_ENDPOINT' });
  expect(probe).not.toHaveBeenCalled();
});

it('shares the successful resolved gateway IP with the measurement pipeline', async () => {
  const onAddress = jest.fn();
  await probeNodeEntry({ ...node, address: 'example.com' }, false, {
    resolve: async () => [{ address: '8.8.8.8' }, { address: '2001:4860:4860::8888' }],
    onAddress,
    boundProbe: async (ip) =>
      ip.includes(':') ? { status: 'ok', latencyMs: 2 } : { status: 'failed' },
  });
  expect(onAddress).toHaveBeenLastCalledWith('2001:4860:4860::8888');
});
