import { resolveUpdateProxyTarget } from '../update-proxy';

it.each([
  [true, 52330, true, 52330],
  [false, 52330, false, 52330],
  [true, 0, false, 0],
  [true, -1, false, 0],
  [true, null, false, 0],
  [true, undefined, false, 0],
  [true, NaN, false, 0],
  [true, 1.5, false, 0],
  [true, 65536, false, 0],
])('running=%s port=%s → viaProxy=%s port=%s', (running, port, viaProxy, expectedPort) => {
  expect(resolveUpdateProxyTarget(running, port)).toEqual({ viaProxy, port: expectedPort });
});
it('accepts only valid live TCP entry ports', () => {
  for (const port of [1, 1080, 52330, 65535])
    expect(resolveUpdateProxyTarget(true, port)).toEqual({ viaProxy: true, port });
});
