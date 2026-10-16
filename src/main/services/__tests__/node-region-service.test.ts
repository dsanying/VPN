import { NodeRegionService, isGeolocatableAddress } from '../NodeRegionService';

it('never sends private, mapped, fake, documentation or invalid addresses to providers', async () => {
  const fetch = jest.fn();
  const service = new NodeRegionService(fetch);
  for (const ip of [
    '10.1.2.3',
    '127.0.0.1',
    '::ffff:127.0.0.1',
    'fe80::1',
    '198.18.0.1',
    '192.0.2.1',
    '2001:db8::1',
    '224.1.2.3',
    'example.com',
  ]) {
    expect(isGeolocatableAddress(ip)).toBe(false);
    expect(await service.lookup(ip)).toBeUndefined();
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('deduplicates a detection run, validates the queried IP and falls back independently', async () => {
  const fetch = jest
    .fn()
    .mockResolvedValueOnce({ ip: '1.1.1.1', country_code: 'JP' })
    .mockResolvedValueOnce({ ip: '8.8.8.8', country_code: 'US' });
  const service = new NodeRegionService(fetch, () => 1234);
  const results = await Promise.all([service.lookup('8.8.8.8'), service.lookup('8.8.8.8')]);
  expect(results[0]).toEqual({
    ip: '8.8.8.8',
    countryCode: 'us',
    measuredAt: 1234,
    provider: 'ipapi.co',
  });
  expect(results[1]).toBe(results[0]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('provider errors or missing region never create geography or node availability', async () => {
  const fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({ ip: '8.8.8.8', country_code: 'XX' });
  expect(await new NodeRegionService(fetch).lookup('8.8.8.8')).toBeUndefined();
});
it('bounds simultaneous lookups even when many independent nodes are refreshed', async () => {
  let active = 0,
    peak = 0;
  const fetch = jest.fn(async (url: string) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return { ip: decodeURIComponent(new URL(url).pathname.slice(1)), country_code: 'US' };
  });
  const service = new NodeRegionService(fetch);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => `8.8.8.${i + 1}`).map((ip) => service.lookup(ip))
  );
  expect(peak).toBe(4);
});
