/**
 * §15 测速全主核化 —— doTestAllServers 分流 + testServersViaMainCore 编排单测（mock mainCoreProbe，无网络/无核）。
 * 验证：
 *  · available()+isRunning() → 走主核池路径：worker 绑定槽 k，measureViaTunnel 以 poolPort[k] 调用、
 *    同槽先测完再重定向；空闲槽立即补位，不触 testServersViaProxy。
 *  · available()=false 或 isRunning()=false → 走临时核 testServersViaProxy（不触 selectSlot，行为不回归）。
 * measureViaTunnel（私有）经 spy 打桩返 {latency:port}，用返回的 latency=port 反证「node 用了 poolPort[k]」。
 */
import { SpeedTestService } from '../SpeedTestService';
import type { MainCoreProbe } from '../../../shared/speed-test';
import type { ServerConfig } from '../../../shared/types';

const mockLog = { addLog: () => {} } as unknown as ConstructorParameters<
  typeof SpeedTestService
>[0];

const vless = (id: string): ServerConfig =>
  ({
    id,
    name: id.toUpperCase(),
    protocol: 'vless',
    address: `${id}.ex.com`,
    port: 443,
    uuid: 'u',
  }) as unknown as ServerConfig;

// K=2 池；selectSlot/tagOf 记账。
function makeProbe(
  over: Partial<MainCoreProbe>,
  events: string[],
  selectCalls: { k: number; tag: string }[]
): MainCoreProbe {
  return {
    poolPorts: [100, 101],
    available: () => true,
    isRunning: () => true,
    selectSlot: async (k: number, tag: string) => {
      events.push(`sel-${k}-${tag}`);
      selectCalls.push({ k, tag });
    },
    tagOf: (id: string) => `tag-${id}`,
    hasTag: () => true,
    tsNodeReady: () => true,
    isDirty: () => false,
    ...over,
  };
}

describe('§15 doTestAllServers 分流 + testServersViaMainCore 编排', () => {
  it('主核可用 → worker 固定绑定 poolPort，同槽测完再重用，不触临时核', async () => {
    const events: string[] = [];
    const selectCalls: { k: number; tag: string }[] = [];
    const probe = makeProbe({}, events, selectCalls);
    const svc = new SpeedTestService(mockLog, undefined, () => probe);

    // measureViaTunnel 打桩：记 meas 事件、latency=port（反证 poolPort 绑定）。
    const measureSpy = jest
      .spyOn(
        svc as unknown as { measureViaTunnel: (p: number) => Promise<unknown> },
        'measureViaTunnel'
      )
      .mockImplementation(async (port: number) => {
        events.push(`meas-${port}`);
        return { latency: port };
      });
    const proxySpy = jest.spyOn(
      svc as unknown as {
        testServersViaProxy: (...a: unknown[]) => Promise<Map<string, number | null>>;
      },
      'testServersViaProxy'
    );

    const nodes = [vless('s1'), vless('s2'), vless('s3')]; // 3 节点、K=2 → 2 波
    const { results } = await svc.testAllServers(nodes);

    // poolPort[k] 绑定：s1(slot0)=100、s2(slot1)=101、s3(wave1 slot0)=100（返回 latency=port）。
    expect(results.get('s1')).toBe(100);
    expect(results.get('s2')).toBe(101);
    expect(results.get('s3')).toBe(100);

    // selectSlot 调用序：wave0 (0,tag-s1)+(1,tag-s2)，wave1 (0,tag-s3)。
    expect(selectCalls).toEqual([
      { k: 0, tag: 'tag-s1' },
      { k: 1, tag: 'tag-s2' },
      { k: 0, tag: 'tag-s3' },
    ]);
    // measureViaTunnel 以 poolPort[k] 调：100(s1),101(s2),100(s3)。
    expect(measureSpy.mock.calls.map((c) => c[0]).sort()).toEqual([100, 100, 101]);

    // 同槽先测完再重定向；另一槽的独立进度不构成批次屏障。
    expect(events.indexOf('sel-0-tag-s3')).toBeGreaterThan(events.indexOf('meas-100'));

    // 不回退临时核。
    expect(proxySpy).not.toHaveBeenCalled();
  });

  it('主核不可用（available=false）→ 回退临时核 testServersViaProxy，不触 selectSlot', async () => {
    const events: string[] = [];
    const selectCalls: { k: number; tag: string }[] = [];
    const probe = makeProbe({ available: () => false }, events, selectCalls);
    // buildOutboundFn 提供 → 走 testServersViaProxy 分支（临时核路径）。
    const svc = new SpeedTestService(
      mockLog,
      () => ({}),
      () => probe
    );
    const proxySpy = jest
      .spyOn(
        svc as unknown as {
          testServersViaProxy: (...a: unknown[]) => Promise<Map<string, number | null>>;
        },
        'testServersViaProxy'
      )
      .mockResolvedValue(new Map([['s1', 55]]));

    const { results } = await svc.testAllServers([vless('s1')]);

    expect(proxySpy).toHaveBeenCalledTimes(1);
    expect(results.get('s1')).toBe(55);
    expect(selectCalls).toHaveLength(0); // 池未启用
  });

  it('主核未运行（isRunning=false）→ 回退临时核，不触 selectSlot', async () => {
    const events: string[] = [];
    const selectCalls: { k: number; tag: string }[] = [];
    const probe = makeProbe({ isRunning: () => false }, events, selectCalls);
    const svc = new SpeedTestService(
      mockLog,
      () => ({}),
      () => probe
    );
    const proxySpy = jest
      .spyOn(
        svc as unknown as {
          testServersViaProxy: (...a: unknown[]) => Promise<Map<string, number | null>>;
        },
        'testServersViaProxy'
      )
      .mockResolvedValue(new Map([['s1', 66]]));

    const { results } = await svc.testAllServers([vless('s1')]);

    expect(proxySpy).toHaveBeenCalledTimes(1);
    expect(results.get('s1')).toBe(66);
    expect(selectCalls).toHaveLength(0);
  });

  it('未注入 getMainCoreProbe（单测/兜底）→ 恒走临时核路径，池零影响', async () => {
    const svc = new SpeedTestService(mockLog, () => ({}));
    const proxySpy = jest
      .spyOn(
        svc as unknown as {
          testServersViaProxy: (...a: unknown[]) => Promise<Map<string, number | null>>;
        },
        'testServersViaProxy'
      )
      .mockResolvedValue(new Map([['s1', 77]]));
    const { results } = await svc.testAllServers([vless('s1')]);
    expect(proxySpy).toHaveBeenCalledTimes(1);
    expect(results.get('s1')).toBe(77);
  });
});

describe('主核测速完成即补位', () => {
  it.each(['select', 'measure'] as const)(
    '慢 %s 只占本槽，另一槽继续测后续节点且不会串节点',
    async (phase) => {
      let release!: () => void;
      const slow = new Promise<void>((resolve) => {
        release = resolve;
      });
      const selected = new Map<number, string>();
      const finished: string[] = [];
      let fastDone!: () => void;
      const fast = new Promise<void>((resolve) => {
        fastDone = resolve;
      });
      const probe = makeProbe(
        {
          selectSlot: async (k, tag) => {
            selected.set(k, tag);
            if (phase === 'select' && tag === 'tag-s1') await slow;
          },
        },
        [],
        []
      );
      const svc = new SpeedTestService(mockLog, undefined, () => probe);
      jest
        .spyOn(
          svc as unknown as { measureViaTunnel: (p: number) => Promise<unknown> },
          'measureViaTunnel'
        )
        .mockImplementation(async (port) => {
          const tag = selected.get(port - 100);
          if (phase === 'measure' && tag === 'tag-s1') await slow;
          expect(selected.get(port - 100)).toBe(tag);
          return { latency: port };
        });
      const run = svc.testAllServers(['s1', 's2', 's3', 's4'].map(vless), (id) => {
        finished.push(id);
        if (id === 's4') fastDone();
      });
      try {
        await fast;
        expect(finished).toEqual(['s2', 's3', 's4']);
        expect(selected.get(0)).toBe('tag-s1');
      } finally {
        release();
      }
      const result = await run;
      expect(result.results.size).toBe(4);
      expect(result.results.get('s1')).toBe(100);
      for (const id of ['s2', 's3', 's4']) expect(result.results.get(id)).toBe(101);
    }
  );

  it('16 个槽均参与测量，80 个双目标超时任务只占 5 轮、每目标 8 秒预算', async () => {
    jest.useFakeTimers();
    try {
      const selected = new Map<number, string>();
      const busy = new Set<number>();
      let maxActive = 0;
      const probe = makeProbe(
        {
          poolPorts: Array.from({ length: 16 }, (_, k) => 100 + k),
          selectSlot: async (k, tag) => {
            expect(busy.has(100 + k)).toBe(false);
            selected.set(k, tag);
          },
        },
        [],
        []
      );
      const svc = new SpeedTestService(mockLog, undefined, () => probe);
      const measure = jest
        .spyOn(
          svc as unknown as { measureViaTunnel: (p: number) => Promise<unknown> },
          'measureViaTunnel'
        )
        .mockImplementation(async (port) => {
          busy.add(port);
          maxActive = Math.max(maxActive, busy.size);
          const tag = selected.get(port - 100);
          await new Promise((resolve) => setTimeout(resolve, 8000));
          expect(selected.get(port - 100)).toBe(tag);
          busy.delete(port);
          return { latency: null, reason: 'timeout' };
        });
      const start = Date.now();
      const run = svc.testAllServers(Array.from({ length: 80 }, (_, i) => vless(`s${i}`)));
      await jest.runAllTimersAsync();
      const result = await run;
      expect(result.results.size).toBe(80);
      expect([...result.results.values()].every((value) => value === null)).toBe(true);
      expect(measure).toHaveBeenCalledTimes(160);
      expect(maxActive).toBe(16);
      expect(busy.size).toBe(0);
      expect(Date.now() - start).toBe(80000);
    } finally {
      jest.useRealTimers();
    }
  });
});

const tsExit = (id: string): ServerConfig =>
  ({
    id,
    name: id.toUpperCase(),
    protocol: 'tailscale',
    tailscaleSettings: { exitNode: '100.64.0.1' },
  }) as unknown as ServerConfig;

describe('§16 波前 gate 缺席（诚实性：绝不写假 -1）+ outcome', () => {
  const stubMeasure = (svc: SpeedTestService) =>
    jest
      .spyOn(
        svc as unknown as { measureViaTunnel: (p: number) => Promise<unknown> },
        'measureViaTunnel'
      )
      .mockImplementation(async (port: number) => ({ latency: port }));

  it('not-in-pool（hasTag=false）→ 该节点缺席（无 -1）、outcome=completed、skipped.notInPool 含之', async () => {
    const probe = makeProbe({ hasTag: (id: string) => id !== 's2' }, [], []);
    const svc = new SpeedTestService(mockLog, undefined, () => probe);
    stubMeasure(svc);
    const { results, outcome, skipped } = await svc.testAllServers([vless('s1'), vless('s2')]);
    expect(results.has('s1')).toBe(true); // 池成员 → 有值
    expect(results.has('s2')).toBe(false); // 非池成员 → 缺席（绝不写 -1）
    expect(skipped.notInPool).toEqual(['s2']);
    expect(outcome).toBe('completed'); // 起测即知不可测 ≠ 中断
  });

  it('ts-not-ready（TS-exit 未登录就绪）→ 缺席、outcome=completed、skipped.tsNotReady 含之', async () => {
    const probe = makeProbe({ tsNodeReady: () => false }, [], []);
    const svc = new SpeedTestService(mockLog, undefined, () => probe);
    stubMeasure(svc);
    const { results, outcome, skipped } = await svc.testAllServers([vless('s1'), tsExit('ts1')]);
    expect(results.has('s1')).toBe(true);
    expect(results.has('ts1')).toBe(false); // 未登录 TS → 缺席
    expect(skipped.tsNotReady).toEqual(['ts1']);
    expect(outcome).toBe('completed');
  });

  it('§2 dirty（isDirty=true）→ 该节点波前剔除、不测（无值、无 -1）、outcome=completed', async () => {
    const probe = makeProbe({ isDirty: (s: ServerConfig) => s.id === 's2' }, [], []);
    const svc = new SpeedTestService(mockLog, undefined, () => probe);
    stubMeasure(svc);
    const { results, outcome } = await svc.testAllServers([vless('s1'), vless('s2')]);
    expect(results.has('s1')).toBe(true); // 干净节点 → 有值
    expect(results.has('s2')).toBe(false); // dirty → 波前剔除、不测（徽标经 pendingChanges 显「待生效」）
    expect(outcome).toBe('completed'); // 起测即知不测 ≠ 中断
  });

  it('核中途崩溃（isRunning 翻 false）→ 未测节点缺席、outcome=interrupted', async () => {
    let running = true;
    let n = 0;
    const probe = makeProbe({ isRunning: () => running }, [], []);
    const svc = new SpeedTestService(
      mockLog,
      undefined,
      () => probe,
      () => 0
    );
    jest
      .spyOn(
        svc as unknown as { measureViaTunnel: (p: number) => Promise<unknown> },
        'measureViaTunnel'
      )
      .mockImplementation(async (port: number) => {
        if (++n === 1) running = false; // 首个 measure 后崩溃
        return running ? { latency: port } : { latency: null, reason: 'connect-error' };
      });
    const { outcome } = await svc.testAllServers([vless('s1'), vless('s2'), vless('s3')]);
    expect(outcome).toBe('interrupted');
  });
});
