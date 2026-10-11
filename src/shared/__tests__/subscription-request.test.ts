import { requestSubscription, DEFAULT_SUBSCRIPTION_USER_AGENT } from '../subscription-request';

test('直连成功不调用代理；失败只重试一次，条件参数由同一个请求闭包保留', async () => {
  const request = jest.fn(async (proxy: boolean) => {
    if (!proxy) throw new Error('network');
    return 'content';
  });
  expect(
    await requestSubscription(
      'auto',
      () => true,
      request,
      () => true
    )
  ).toBe('content');
  expect(request.mock.calls).toEqual([[false], [true]]);
  request.mockClear();
  request.mockResolvedValue('direct-content');
  expect(
    await requestSubscription(
      'auto',
      () => true,
      request,
      () => true
    )
  ).toBe('direct-content');
  expect(request.mock.calls).toEqual([[false]]);
});
test.each([false, true])('无代理或校验拒绝不回退，proxyAvailable=%s', async (available) => {
  const request = jest.fn().mockRejectedValue(new Error('blocked'));
  await expect(
    requestSubscription(
      'auto',
      () => available,
      request,
      () => false
    )
  ).rejects.toThrow('blocked');
  expect(request.mock.calls).toEqual([[false]]);
});
test('两条路径均失败返回失败，强制代理不悄悄退回直连', async () => {
  const request = jest.fn().mockRejectedValue(new Error('failed'));
  await expect(
    requestSubscription(
      'auto',
      () => true,
      request,
      () => true
    )
  ).rejects.toThrow('failed');
  expect(request.mock.calls).toEqual([[false], [true]]);
  request.mockClear();
  await expect(
    requestSubscription(
      true,
      () => false,
      request,
      () => true
    )
  ).rejects.toThrow('failed');
  expect(request.mock.calls).toEqual([[true]]);
});
test('统一请求标识只有一个后台默认值', () => {
  expect(DEFAULT_SUBSCRIPTION_USER_AGENT).toBe('clash.meta');
});
