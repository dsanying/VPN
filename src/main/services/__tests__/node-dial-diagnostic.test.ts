import { nodeDialDiagnostic } from '../node-dial-diagnostic';
import type { ServerConfig } from '../../../shared/types';
const node = { address: 'example.com', port: 443 } as ServerConfig;
it.each([
  ['no route to host', 'EHOSTUNREACH'],
  ['network is unreachable', 'ENETUNREACH'],
  ['connection refused', 'ECONNREFUSED'],
  ['i/o timeout', 'ETIMEDOUT'],
])('records exact endpoint dial error %s without raw output', (message, code) => {
  expect(
    nodeDialDiagnostic(`ERROR outbound/direct: dial tcp example.com:443: connect: ${message}`, node)
  ).toBe(code);
});
it('does not borrow an error from a different node, port, target or successful response', () => {
  expect(
    nodeDialDiagnostic(
      'dial tcp other.example.com:443: connection refused\ndial tcp example.com:4430: connection refused\nHTTP body: connection refused',
      node
    )
  ).toBeUndefined();
  expect(
    nodeDialDiagnostic(
      'dial tcp example.com:443: i/o timeout\ndial tcp example.com:443: connection refused',
      node
    )
  ).toBeUndefined();
});
it('recognizes bracketed IPv6 endpoints', () => {
  expect(
    nodeDialDiagnostic('dial tcp [2001:db8::1]:443: connect: no route to host', {
      ...node,
      address: '2001:db8::1',
    })
  ).toBe('EHOSTUNREACH');
});
