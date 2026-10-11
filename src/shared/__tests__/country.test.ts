import { countryFromChineseLocation, normalizeCountryCode } from '../country';
import { localRegionGeo, foreignRegionGeo } from '../region-routing';

it.each(['cn', 'us', 'jp', 'gb', 'de', 'ir', 'ru', 'hk', 'tw', 'sg'])(
  'accepts recognized country %s',
  (code) => {
    expect(normalizeCountryCode(code.toUpperCase())).toBe(code);
    const region = { automatic: true, enabled: true, region: code, reverse: false };
    expect(localRegionGeo(region)).toEqual({ geosite: [], geoip: [`geoip-${code}`] });
    expect(foreignRegionGeo(region)).toEqual({ geosite: [] });
  }
);
it.each(['XX', 'ZZ', '../../cn', 'CN/US', 'abc', 'EU', 'UN', 'AA', null])(
  'rejects unknown/malformed country %p',
  (value) => {
    expect(normalizeCountryCode(value)).toBeUndefined();
  }
);
it.each([
  ['美国', 'us'],
  ['日本', 'jp'],
  ['德国', 'de'],
  ['英国', 'gb'],
  ['新加坡', 'sg'],
  ['伊朗', 'ir'],
])('resolves IPIP name %s', (name, code) => {
  expect(countryFromChineseLocation([name])).toBe(code);
});
it('separates network territories and leaves unknown names unknown', () => {
  expect(countryFromChineseLocation(['中国', '香港'])).toBe('hk');
  expect(countryFromChineseLocation(['中国', '台湾'])).toBe('tw');
  expect(countryFromChineseLocation(['中国', '广东'])).toBe('cn');
  expect(countryFromChineseLocation(['Unknown'])).toBeUndefined();
});
