import { isIPv6 } from 'node:net';
import { decodeBase64Utf8, encodeBase64Utf8, isIpv6Literal } from '../portable-codec';
import { ProtocolParser } from '../protocol-parser';

describe('portable protocol primitives', () => {
  it.each(['plain', '中文 🇨🇳', '\uFEFFbom', '\uD800broken', '', 'a'.repeat(20000)])(
    'matches Node UTF-8 encoding',
    (text) => {
      expect(encodeBase64Utf8(text)).toBe(Buffer.from(text).toString('base64'));
      expect(encodeBase64Utf8(text, true)).toBe(Buffer.from(text).toString('base64url'));
      expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(Buffer.from(text).toString('utf8'));
    }
  );
  it.each(['YQ', 'YQ== ignored', '_-8=', 'Y', 'YQ!?', '77u/Ym9t', '/w=='])(
    'preserves tolerant Buffer decoding',
    (text) => {
      expect(decodeBase64Utf8(text)).toBe(Buffer.from(text, 'base64').toString('utf8'));
    }
  );
  it.each([
    '::',
    '::1',
    '2001:db8::1',
    '::ffff:192.0.2.1',
    'fe80::1%en0',
    'fe80::1%3',
    '1:2:3:4:5:6:7:8',
    '1:2:3',
    ':::',
    '1::2::3',
    '::ffff:192.0.2.999',
    '[::1]',
    'example.com',
    '::1%',
  ])('matches Node literal recognition', (text) => {
    expect(isIpv6Literal(text)).toBe(isIPv6(text));
  });
  it('parses and round-trips without a Buffer global', () => {
    const buffer = globalThis.Buffer;
    try {
      (globalThis as any).Buffer = undefined;
      const parser = new ProtocolParser();
      const node = parser.parseUrl(
        'ss://' + encodeBase64Utf8('aes-128-gcm:fake-password') + '@example.com:443#节点'
      );
      expect(parser.parseUrl(parser.generateUrl(node))).toMatchObject({
        address: 'example.com',
        shadowsocksSettings: { password: 'fake-password' },
      });
    } finally {
      globalThis.Buffer = buffer;
    }
  });
});
