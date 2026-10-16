const mockSuccess = jest.fn();
const mockFailure = jest.fn();
const mockWarning = jest.fn();
jest.mock('@/utils/feedback', () => ({
  notifyActionSuccess: (...args: unknown[]) => mockSuccess(...args),
  notifyActionFailed: (...args: unknown[]) => mockFailure(...args),
  notifyWarning: (...args: unknown[]) => mockWarning(...args),
}));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
import type { ServerConfig } from '@shared/types';
const mockSpeed = jest.fn();
const mockOff = jest.fn();
const mockOn = jest.fn((..._args: unknown[]) => mockOff);
const mockApply = jest.fn();
const mockSet = jest.fn();
jest.mock('@/ipc', () => ({
  api: {
    server: {
      speedTest: (...args: unknown[]) => mockSpeed(...args),
      onSpeedTestProgress: (...args: unknown[]) => mockOn(...args),
    },
  },
}));
jest.mock('../app-store', () => ({
  useAppStore: {
    getState: () => ({
      connectionStatus: { proxyCore: { running: false } },
      applyLatencyResults: mockApply,
    }),
    setState: (...args: unknown[]) => mockSet(...args),
  },
}));
import { useSpeedTestStore } from '../useSpeedTestStore';
const node = {
  id: 'example-node',
  name: 'Example',
  protocol: 'vless',
  address: 'example.com',
  port: 443,
} as ServerConfig;
beforeEach(() => {
  jest.clearAllMocks();
  useSpeedTestStore.setState({ testing: [], progress: { tested: 0, total: 0, ok: 0 } });
});
it('任务属于会话，重复启动不会重叠；完成后退订并保存真实结果', async () => {
  let resolve!: (result: unknown) => void;
  mockSpeed.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const task = useSpeedTestStore.getState().run([node], true);
  expect(useSpeedTestStore.getState().testing).toEqual([node.id]);
  await useSpeedTestStore.getState().run([node], true);
  expect(mockSpeed).toHaveBeenCalledTimes(1);
  expect(mockSuccess).not.toHaveBeenCalled();
  resolve({ results: { [node.id]: 123 }, notInPool: [], tsNotReady: [], outcome: 'completed' });
  await task;
  expect(mockApply).toHaveBeenCalledWith({ [node.id]: 123 }, []);
  expect(mockOff).toHaveBeenCalledTimes(1);
  expect(useSpeedTestStore.getState()).toMatchObject({
    testing: [],
    progress: { tested: 1, total: 1, ok: 1 },
  });
  expect(mockSuccess).toHaveBeenCalledTimes(1);
  expect(mockWarning).not.toHaveBeenCalled();
});
it('内核中断不会给缺席节点制造超时结果', async () => {
  mockSpeed.mockResolvedValue({
    results: {},
    notInPool: [node.id],
    tsNotReady: [],
    outcome: 'interrupted',
  });
  await useSpeedTestStore.getState().run([node]);
  expect(mockApply).toHaveBeenCalledWith({}, [node.id]);
  expect(useSpeedTestStore.getState()).toMatchObject({
    testing: [],
    progress: { tested: 0, total: 1, ok: 0 },
  });
  expect(mockWarning).toHaveBeenCalledWith('vpn.interrupted', 'vpn.testing');
  expect(mockWarning).toHaveBeenCalledTimes(1);
  expect(mockSuccess).not.toHaveBeenCalled();
});
it('失败也释放任务与监听，允许重新测速', async () => {
  mockSpeed.mockRejectedValueOnce(new Error('Failed'));
  await useSpeedTestStore.getState().run([node]);
  expect(useSpeedTestStore.getState().testing).toEqual([]);
  expect(mockOff).toHaveBeenCalledTimes(1);
  expect(mockFailure).toHaveBeenCalledWith('testLatency', expect.any(Error));
  mockSpeed.mockResolvedValue({
    results: { [node.id]: 321 },
    notInPool: [],
    tsNotReady: [],
    outcome: 'completed',
  });
  await useSpeedTestStore.getState().run([node]);
  expect(mockSpeed).toHaveBeenCalledTimes(2);
  expect(useSpeedTestStore.getState()).toMatchObject({
    testing: [],
    progress: { tested: 1, total: 1, ok: 1 },
  });
  expect(mockFailure).toHaveBeenCalledTimes(1);
  expect(mockSuccess).toHaveBeenCalledTimes(1);
});

it('部分失败只报告警告，返回结果不能冒充全可用', async () => {
  mockSpeed.mockResolvedValue({
    results: { [node.id]: -1 },
    notInPool: [],
    tsNotReady: [],
    outcome: 'completed',
  });
  await useSpeedTestStore.getState().run([node]);
  expect(mockWarning).toHaveBeenCalledTimes(1);
  expect(mockSuccess).not.toHaveBeenCalled();
  expect(useSpeedTestStore.getState().progress.ok).toBe(0);
});
it('无可测节点给出提示，不发起假测速', async () => {
  await useSpeedTestStore.getState().run([]);
  expect(mockSpeed).not.toHaveBeenCalled();
  expect(mockWarning).toHaveBeenCalledWith('vpn.noTestableNodes');
  expect(mockSuccess).not.toHaveBeenCalled();
});
it('入口延迟和代理检测目标独立保存，不替代代理结果', async () => {
  const details = {
    [node.id]: {
      entry: { status: 'ok', latencyMs: 52 },
      proxyTarget: 'https://cp.cloudflare.com/generate_204',
    },
  };
  mockSpeed.mockResolvedValue({
    results: { [node.id]: 92 },
    notInPool: [],
    tsNotReady: [],
    outcome: 'completed',
    details,
  });
  await useSpeedTestStore.getState().run([node]);
  expect(mockApply).toHaveBeenCalledWith({ [node.id]: 92 }, [], details);
});

it('each field stops waiting independently while other nodes and fields remain pending', async () => {
  let finish!: (result: unknown) => void;
  mockSpeed.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const second = { ...node, id: 'second' };
  const run = useSpeedTestStore.getState().run([node, second]);
  useSpeedTestStore.getState().received(node.id, 'proxy');
  expect(useSpeedTestStore.getState().proxyPending).toEqual(['second']);
  expect(useSpeedTestStore.getState().entryPending).toEqual([node.id, 'second']);
  useSpeedTestStore.getState().received(node.id, 'entry');
  expect(useSpeedTestStore.getState().entryPending).toEqual(['second']);
  expect(useSpeedTestStore.getState().testing).toEqual([node.id, 'second']);
  finish({ results: { [node.id]: 23, second: 42 }, notInPool: [], outcome: 'completed' });
  await run;
  expect(useSpeedTestStore.getState()).toMatchObject({
    proxyPending: [],
    entryPending: [],
    testing: [],
  });
});
