import { isSubscriptionNotice } from '../subscription-notice';
import { isSpeedTestable } from '../endpoint-routes';
import type { ServerConfig } from '../types';
it('账户提示条目不参加测速，真实线路保持可测', () => {
  for (const name of [
    '剩余流量：116.78 GB',
    '套餐到期：长期有效',
    '过滤掉15条线路',
    '↓↓↓↓必看↓↓↓↓',
  ]) {
    expect(isSubscriptionNotice(name)).toBe(true);
    expect(
      isSpeedTestable({ name, subscriptionId: 'sub', protocol: 'vmess' } as ServerConfig)
    ).toBe(false);
  }
  expect(
    isSpeedTestable({
      name: '美国LA-优化2-GPT',
      subscriptionId: 'sub',
      protocol: 'vmess',
    } as ServerConfig)
  ).toBe(true);
  expect(isSubscriptionNotice('香港-流量优化')).toBe(false);
});
