import { EventEmitter } from 'events';
const mockRequest = jest.fn();
jest.mock('https', () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
import { makeDefaultUpstreamQuery } from '../node-dns-race-server';
import { BUILTIN_UPSTREAMS } from '../../../shared/node-resolver-upstreams';
import { encodeDnsQuery } from '../../../shared/dns-wire';

beforeEach(() => mockRequest.mockReset());
it('DNSPod dials its bootstrap IP while verifying the official hostname and sending the official Host', async () => {
  const bytes = Buffer.from(encodeDnsQuery('example.com', 321));
  mockRequest.mockImplementation((_options: unknown, onResponse: (r: unknown) => void) => {
    const request = Object.assign(new EventEmitter(), {
      end: jest.fn(() => {
        const response = Object.assign(new EventEmitter(), { statusCode: 200 });
        onResponse(response);
        response.emit('data', bytes);
        response.emit('end');
      }),
      destroy: jest.fn(),
    });
    return request;
  });
  await expect(
    makeDefaultUpstreamQuery()(BUILTIN_UPSTREAMS.dnspod, bytes, new AbortController().signal)
  ).resolves.toEqual(new Uint8Array(bytes));
  expect(mockRequest.mock.calls[0][0]).toMatchObject({
    hostname: '1.12.12.12',
    servername: 'doh.pub',
    rejectUnauthorized: true,
    headers: { Host: 'doh.pub' },
  });
});
it('certificate errors fail the upstream rather than retrying with certificate validation disabled', async () => {
  mockRequest.mockImplementation(() => {
    const request = Object.assign(new EventEmitter(), {
      end: () => queueMicrotask(() => request.emit('error', new Error('CERT_HAS_EXPIRED'))),
      destroy: jest.fn(),
    });
    return request;
  });
  await expect(
    makeDefaultUpstreamQuery()(
      BUILTIN_UPSTREAMS.dnspod,
      encodeDnsQuery('example.com'),
      new AbortController().signal
    )
  ).rejects.toThrow('CERT_HAS_EXPIRED');
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(mockRequest.mock.calls[0][0].rejectUnauthorized).toBe(true);
});
