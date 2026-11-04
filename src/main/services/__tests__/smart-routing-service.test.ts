import { SmartRoutingService } from '../SmartRoutingService';
import type { IpInfo, RegionRoutingConfig } from '../../../shared/types';

function fixture() {
  let fingerprint = 'network-a';
  const detect = jest
    .fn<Promise<IpInfo | null>, []>()
    .mockResolvedValue({ ip: '192.0.2.1', countryCode: 'US' });
  const ensureRules = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true);
  const policies: RegionRoutingConfig[] = [];
  const service = new SmartRoutingService({
    detect,
    ensureRules,
    fingerprint: () => fingerprint,
    onPolicy: (policy) => policies.push(policy),
    onState: () => {},
  });
  return {
    service,
    detect,
    ensureRules,
    policies,
    changeNetwork: () => {
      fingerprint = 'network-b';
    },
  };
}

describe('automatic local-network routing', () => {
  it('has no private maintenance timer and reacts to OS changes without rechecking an unchanged network', async () => {
    jest.useFakeTimers();
    let identity = 'a';
    let changed!: () => void;
    const stop = jest.fn();
    const detect = jest.fn().mockResolvedValue({ ip: '192.0.2.1', countryCode: 'US' });
    const service = new SmartRoutingService({
      detect,
      ensureRules: async () => true,
      fingerprint: () => identity,
      onPolicy: () => {},
      onState: () => {},
      watchNetwork: (callback) => {
        changed = callback;
        return stop;
      },
    });
    try {
      service.start();
      await service.refresh();
      await jest.advanceTimersByTimeAsync(6 * 3600000);
      expect(detect).toHaveBeenCalledTimes(1);
      identity = 'b';
      changed();
      await service.refresh();
      expect(detect).toHaveBeenCalledTimes(2);
      changed();
      await service.refresh();
      expect(detect).toHaveBeenCalledTimes(2);
      service.dispose();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      service.dispose();
      jest.useRealTimers();
    }
  });
  it('normalizes the direct country and prepares one matching IP set; no region/reverse preference', async () => {
    const f = fixture();
    await f.service.refresh();
    expect(f.ensureRules).toHaveBeenCalledWith('us');
    expect(f.policies.at(-1)).toEqual({
      automatic: true,
      enabled: true,
      region: 'us',
      reverse: false,
    });
    await f.service.refresh();
    expect(f.detect).toHaveBeenCalledTimes(1);
    f.service.dispose();
  });

  it.each([null, { ip: '192.0.2.1' }, { ip: '192.0.2.1', countryCode: '../../cn' }])(
    'unknown local country never guesses CN: %p',
    async (info) => {
      const f = fixture();
      f.detect.mockResolvedValue(info);
      await f.service.refresh();
      expect(f.service.getState().status).toBe('unavailable');
      expect(f.policies.at(-1)?.enabled).toBe(false);
      expect(f.ensureRules).not.toHaveBeenCalled();
      f.service.dispose();
    }
  );

  it('unobservable detection retains the ready policy across network changes', async () => {
    const f = fixture();
    await f.service.refresh();
    expect(f.policies.at(-1)).toEqual({
      automatic: true,
      enabled: true,
      region: 'us',
      reverse: false,
    });
    // 同网探测失败（上游 DNS 抖动）：UI 降级为 unavailable，但路由策略保留——不触发策略翻面重启。
    f.detect.mockResolvedValue(null);
    await f.service.refresh(true);
    expect(f.service.getState().status).toBe('unavailable');
    expect(f.policies.at(-1)).toEqual({
      automatic: true,
      enabled: true,
      region: 'us',
      reverse: false,
    });
    // 探测恢复：策略原样，无翻动。
    f.detect.mockResolvedValue({ ip: '192.0.2.1', countryCode: 'US' });
    await f.service.refresh(true);
    expect(f.service.getState()).toEqual({ countryCode: 'us', status: 'ready' });
    expect(f.policies.at(-1)?.enabled).toBe(true);
    // 换网（指纹变化）但探测拿不到结果（暗唤醒/Wi-Fi 重连 + 上游故障）：同样保留，零重启
    // ——2026-11-04 实测：指纹瞬变被当换网下线策略 → 故障期拆路由整核重启、恢复再翻回二次重启。
    f.changeNetwork();
    f.detect.mockResolvedValue(null);
    await f.service.refresh(true);
    expect(f.service.getState().status).toBe('unavailable');
    expect(f.policies.at(-1)).toEqual({
      automatic: true,
      enabled: true,
      region: 'us',
      reverse: false,
    });
    // 新网络上拿到成功观测且国家不同 → 策略切换（唯一允许的变更路径）。
    f.detect.mockResolvedValue({ ip: '198.51.100.1', countryCode: 'JP' });
    await f.service.refresh(true);
    expect(f.policies.at(-1)).toEqual({
      automatic: true,
      enabled: true,
      region: 'jp',
      reverse: false,
    });
    f.service.dispose();
  });

  it('missing country rules never activate direct-country routing', async () => {
    const f = fixture();
    f.ensureRules.mockResolvedValue(false);
    await f.service.refresh();
    expect(f.service.getState()).toEqual({ countryCode: 'us', status: 'unavailable' });
    expect(f.policies.at(-1)?.enabled).toBe(false);
    f.service.dispose();
  });

  it('network changes clear old direct policy and supersede an older in-flight lookup', async () => {
    const f = fixture();
    await f.service.refresh();
    let finish!: (value: IpInfo | null) => void;
    f.detect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const old = f.service.refresh(true);
    await Promise.resolve();
    f.changeNetwork();
    f.detect.mockResolvedValue({ ip: '198.51.100.1', countryCode: 'JP' });
    const next = f.service.refresh();
    // 检测期间保留在跑策略（探测不可观测不下线——2026-11-04 实测按指纹立即下线会掀掉全部 TCP）；
    // 过期 in-flight 结果由世代压制，不落地。
    expect(f.policies.at(-1)).toEqual({
      automatic: true,
      enabled: true,
      region: 'us',
      reverse: false,
    });
    await next;
    finish({ ip: '192.0.2.1', countryCode: 'CN' });
    await old;
    expect(f.service.getState()).toEqual({ countryCode: 'jp', status: 'ready' });
    expect(f.policies.at(-1)).toEqual({
      automatic: true,
      enabled: true,
      region: 'jp',
      reverse: false,
    });
    f.service.dispose();
  });

  it('late completion after disposal cannot publish a policy', async () => {
    const f = fixture();
    let finish!: (value: IpInfo | null) => void;
    f.detect.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = f.service.refresh();
    await Promise.resolve();
    f.service.dispose();
    const before = f.policies.length;
    finish({ ip: '192.0.2.1', countryCode: 'CN' });
    await pending;
    expect(f.policies).toHaveLength(before);
  });
});
it.each([true, false])(
  'country detection success/failure uses the shared six-hour boundary: %p',
  async (success) => {
    jest.useFakeTimers();
    const f = fixture();
    try {
      if (!success) f.detect.mockResolvedValue(null);
      await f.service.refresh();
      await jest.advanceTimersByTimeAsync(6 * 3600000 - 1);
      await f.service.refresh();
      expect(f.detect).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await f.service.refresh();
      expect(f.detect).toHaveBeenCalledTimes(2);
    } finally {
      f.service.dispose();
      jest.useRealTimers();
    }
  }
);
