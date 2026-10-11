jest.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: class {
    constructor(public proxy: string) {}
  },
}));
import { IpInfoService } from '../IpInfoService';

it('under TUN both local and international fallback use the pinned direct port, never proxy port', async () => {
  const service = new IpInfoService(
    () => ({ direct: 12345, proxy: 23456 }),
    () => true,
    () => {}
  );
  const text = jest.spyOn(
    service as unknown as { httpText: (options: unknown) => Promise<string | null> },
    'httpText'
  );
  text.mockResolvedValueOnce(null).mockResolvedValueOnce('ip=192.0.2.1\nloc=JP');
  expect(await service.detectDirectNetwork()).toEqual({ ip: '192.0.2.1', countryCode: 'JP' });
  for (const [options] of text.mock.calls) {
    expect(options).toEqual(
      expect.objectContaining({
        rejectUnauthorized: true,
        agent: expect.objectContaining({ proxy: 'http://127.0.0.1:12345' }),
      })
    );
  }
});

it('a running core without a pinned direct port cannot fall back to a captured bare request', async () => {
  const service = new IpInfoService(
    () => null,
    () => true,
    () => {}
  );
  const text = jest.spyOn(
    service as unknown as { httpText: (options: unknown) => Promise<string | null> },
    'httpText'
  );
  expect(await service.detectDirectNetwork()).toBeNull();
  expect(text).not.toHaveBeenCalled();
});

it('outside the core the lookup is bare HTTPS and an international IPIP country does not require another endpoint', async () => {
  const service = new IpInfoService(
    () => null,
    () => false,
    () => {}
  );
  const text = jest.spyOn(
    service as unknown as { httpText: (options: unknown) => Promise<string | null> },
    'httpText'
  );
  text.mockResolvedValue(
    JSON.stringify({ ret: 'ok', data: { ip: '192.0.2.1', location: ['德国'] } })
  );
  expect(await service.detectDirectNetwork()).toEqual({
    ip: '192.0.2.1',
    country: '德国',
    countryCode: 'de',
  });
  expect(text).toHaveBeenCalledTimes(1);
  expect(text.mock.calls[0][0]).toEqual(
    expect.objectContaining({ hostname: 'myip.ipip.net', rejectUnauthorized: true, agent: false })
  );
});

it('a lookup started before a core starts cannot publish its captured bare-route answer', async () => {
  let running = false;
  let finish!: (text: string) => void;
  const update = jest.fn();
  const service = new IpInfoService(
    () => null,
    () => running,
    update
  );
  jest
    .spyOn(
      service as unknown as { httpText: (options: unknown) => Promise<string | null> },
      'httpText'
    )
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  const pending = service.detectDirectNetwork();
  running = true;
  finish(JSON.stringify({ ret: 'ok', data: { ip: '192.0.2.1', location: ['中国'] } }));
  expect(await pending).toBeNull();
  expect(update).not.toHaveBeenCalled();
});
