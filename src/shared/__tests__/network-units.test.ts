import { formatDataRate, formatDataSize } from '../network-units';

describe('decimal network units', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [999, '999 B'],
    [1000, '1 KB'],
    [8192, '8.19 KB'],
    [1e6, '1 MB'],
    [1.234e9, '1.23 GB'],
    [1e12, '1 TB'],
    [1e15, '1 PB'],
    [1e18, '1 EB'],
    [999999, '1 MB'],
    [999999999, '1 GB'],
  ])('formats %s bytes as %s', (input, expected) => {
    expect(formatDataSize(input)).toBe(expected);
    expect(formatDataRate(input)).toBe(`${expected}/s`);
  });
  it.each([undefined, null, NaN, Infinity, -1])(
    'preserves unknown or invalid value %s',
    (value) => {
      expect(formatDataSize(value)).toBe('—');
      expect(formatDataRate(value)).toBe('—');
    }
  );
});
