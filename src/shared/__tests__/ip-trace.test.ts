import { isIP } from 'node:net';
import { isIpLiteral, parseIpTrace } from '../ip-trace';

test('portable literal validation agrees with native on IPv4, compressed IPv6 and mapped/scoped addresses', () => {
  for (const value of [
    '192.0.2.1',
    '0.0.0.0',
    '255.255.255.255',
    '999.1.1.1',
    '01.2.3.4',
    '1.2.3',
    '::',
    '::1',
    'fe80::1%en0',
    '2001:db8::ffff',
    '::ffff:192.0.2.1',
    '::ffff:01.2.3.4',
    '1:2:3:4:5:6:7:8',
    '1:2:3:4:5:6:7:8::',
    '::::',
    ':1:2:3:4:5:6:7',
    '[::1]',
    '192.0.2.1/24',
    'https://example.com',
    'fe80::1%',
    '1:2:3:4:5:6:192.0.2.1',
  ]) {
    expect({ value, valid: isIpLiteral(value) }).toEqual({ value, valid: !!isIP(value) });
  }
});
test('trace rejects portal and malformed data and never invents countries', () => {
  expect(parseIpTrace('ip=192.0.2.1\nloc=us')).toEqual({ ip: '192.0.2.1', countryCode: 'US' });
  expect(parseIpTrace('ip=::ffff:192.0.2.1\nloc=XX')).toEqual({
    ip: '::ffff:192.0.2.1',
    countryCode: undefined,
  });
  expect(parseIpTrace('<html>portal</html>')).toBeNull();
  expect(parseIpTrace('ip=999.1.1.1\nloc=CN')).toBeNull();
  expect(parseIpTrace('ip=192.0.2.1\n' + 'a'.repeat(65536))).toBeNull();
});
