import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UPDATE_RESTART_FRESH_MS, UpdateRestartStateStore } from '../update-restart-state';

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowvpn-urestart-'));
  return { store: new UpdateRestartStateStore(dir), dir };
}

const validState = {
  reason: 'app-update' as const,
  proxyRunning: true,
  targetVersion: '0.3.6',
  at: new Date().toISOString(),
};

describe('UpdateRestartStateStore', () => {
  it('write → read 回读一致', () => {
    const { store, dir } = makeStore();
    store.write(validState);
    expect(store.read()).toMatchObject({ proxyRunning: true, targetVersion: '0.3.6' });
    // 文件确实落在 userData 根
    expect(fs.existsSync(path.join(dir, 'update-restart.json'))).toBe(true);
  });

  it('缺失 → null', () => {
    const { store } = makeStore();
    expect(store.read()).toBeNull();
    expect(store.consume()).toBeNull();
  });

  it('损坏 JSON → 失败安全 null', () => {
    const { store, dir } = makeStore();
    fs.writeFileSync(path.join(dir, 'update-restart.json'), '{ broken', 'utf-8');
    expect(store.read()).toBeNull();
  });

  it('reason 不符 / 字段缺失 → null（防外部脏文件误触发恢复）', () => {
    const { store, dir } = makeStore();
    const file = path.join(dir, 'update-restart.json');
    fs.writeFileSync(file, JSON.stringify({ ...validState, reason: 'other' }));
    expect(store.read()).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ reason: 'app-update', at: validState.at }));
    expect(store.read()).toBeNull();
  });

  it('超过新鲜窗口 → null（陈旧标记不自动拉代理）', () => {
    const { store } = makeStore();
    store.write({
      ...validState,
      at: new Date(Date.now() - UPDATE_RESTART_FRESH_MS - 1000).toISOString(),
    });
    expect(store.read()).toBeNull();
  });

  it('未来时间戳（时钟回拨）→ null', () => {
    const { store } = makeStore();
    store.write({ ...validState, at: new Date(Date.now() + 60_000).toISOString() });
    expect(store.read()).toBeNull();
  });

  it('consume 读取并删除——一次性语义，第二次 consume 为 null', () => {
    const { store, dir } = makeStore();
    store.write(validState);
    expect(store.consume()?.proxyRunning).toBe(true);
    expect(fs.existsSync(path.join(dir, 'update-restart.json'))).toBe(false);
    expect(store.consume()).toBeNull();
  });

  it('consume 对过期/损坏标记也删除文件（不留残留）', () => {
    const { store, dir } = makeStore();
    const file = path.join(dir, 'update-restart.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...validState,
        at: new Date(Date.now() - UPDATE_RESTART_FRESH_MS - 1).toISOString(),
      })
    );
    expect(store.consume()).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });
});
