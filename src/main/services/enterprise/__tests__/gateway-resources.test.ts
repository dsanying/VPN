import { parseGatewayResources } from '../GatewayResources';
test('accepts only bounded explicit domains and non-default IPv4 routes', () => {
  expect(
    parseGatewayResources({
      domains: [
        '*.Internal.example.com.',
        'internal.example.com',
        '*',
        'com',
        'https://example.com',
        '127.0.0.1',
      ],
      cidrs: ['10.0.0.0/8', '0.0.0.0/0', '128.0.0.0/1', '::/0', '300.0.0.0/8', '10.0.0.0/99'],
    })
  ).toEqual({ domains: ['internal.example.com'], cidrs: ['10.0.0.0/8'] });
  // Real full-tunnel list: private intranet and narrow public routes survive,
  // broad public blocks and reserved space are filler and must be dropped.
  expect(
    parseGatewayResources({
      cidrs: [
        '10.42.0.0/30',
        '10.0.0.0/11',
        '172.16.0.0/12',
        '100.64.0.0/10',
        '203.0.113.0/24',
        '116.31.95.16/31',
        '1.0.0.0/8',
        '116.0.0.0/12',
        '117.0.0.0/8',
        '127.0.0.0/8',
        '169.254.0.0/16',
        '224.0.0.0/4',
        '255.255.255.0/25',
      ],
    })
  ).toEqual({
    domains: [],
    cidrs: [
      '10.42.0.0/30',
      '10.0.0.0/11',
      '172.16.0.0/12',
      '100.64.0.0/10',
      '203.0.113.0/24',
      '116.31.95.16/31',
    ],
  });
  expect(parseGatewayResources(null)).toEqual({ domains: [], cidrs: [] });
  expect(parseGatewayResources({ domains: Array(2000).fill('private.example.com') })).toEqual({
    domains: ['private.example.com'],
    cidrs: [],
  });
});
