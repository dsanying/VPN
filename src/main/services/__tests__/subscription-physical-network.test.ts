import * as http from 'http';
import { physicalSubscriptionFetch } from '../subscription-physical-network';
jest.mock('dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '127.0.0.1', family: 4 }]),
}));
// The controlled test origin is local; production still rejects private destinations.
jest.mock('../../../shared/ssrf-guard', () => ({ isPrivateIp: () => false }));
jest.mock('../entry-probe', () => ({ hasDirectEntryRoute: jest.fn(async () => true) }));
import { hasDirectEntryRoute } from '../entry-probe';

test('物理路径适配器完成真实 HTTP 请求、读取正文和条件响应，并在路由无法确认时拒绝', async () => {
  const server = http.createServer((req, res) => {
    if (req.headers['if-none-match'] === 'saved') {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain', ETag: 'saved' });
    res.end('actual-body');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('net').AddressInfo).port;
  try {
    const url = `http://example.com:${port}/subscription`;
    const response = await physicalSubscriptionFetch(url, {
      headers: { 'User-Agent': 'clash.meta' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('saved');
    expect(await response.text()).toBe('actual-body');
    const unchanged = await physicalSubscriptionFetch(url, {
      headers: { 'If-None-Match': 'saved' },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.body).toBeNull();
    jest.mocked(hasDirectEntryRoute).mockResolvedValue(false);
    await expect(physicalSubscriptionFetch(url, { headers: {} })).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
