import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-renhot-swap-'));
jest.mock('electron', () => ({
  app: {
    getPath: () => TMP,
    getVersion: () => (globalThis as any).__MOCK_DISK_VERSION__ ?? '0.3.5',
    isPackaged: true,
    getAppPath: () => TMP,
  },
}));
import {
  effectiveAppVersion,
  getActiveHotRendererIndexPath,
  validateHotRendererOnStartup,
} from '../renderer-hot-swap';
import { RendererHotStateStore } from '../renderer-hot';

function hotStore(): RendererHotStateStore {
  return new RendererHotStateStore(TMP, fs);
}

function seedHotState(version: string): void {
  const store = hotStore();
  fs.rmSync(store.hotRootDir, { recursive: true, force: true });
  fs.mkdirSync(store.versionDir(version), { recursive: true });
  fs.writeFileSync(path.join(store.versionDir(version), 'index.html'), `<html>${version}</html>`);
  store.write({ schema: 1, version, dirName: version, appliedAt: 'now' });
}

beforeEach(() => {
  (globalThis as any).__MOCK_DISK_VERSION__ = '0.3.5';
  fs.rmSync(path.join(TMP, 'renderer-hot'), { recursive: true, force: true });
  fs.rmSync(path.join(TMP, 'renderer-hot-state.json'), { force: true });
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('启动校验 validateHotRendererOnStartup', () => {
  it('磁盘版本追上覆盖版本 → 清覆盖与外置目录', () => {
    seedHotState('0.3.6');
    (globalThis as any).__MOCK_DISK_VERSION__ = '0.3.6';
    validateHotRendererOnStartup();
    expect(hotStore().load()).toBeNull();
    expect(fs.existsSync(hotStore().hotRootDir)).toBe(false);
  });

  it('覆盖仍领先磁盘版本 → 保留（崩溃重开继续用新界面）', () => {
    seedHotState('0.3.6');
    validateHotRendererOnStartup();
    expect(hotStore().load()?.version).toBe('0.3.6');
    expect(fs.existsSync(path.join(hotStore().versionDir('0.3.6'), 'index.html'))).toBe(true);
  });

  it('无有效状态但残留外置目录 → 死重清理', () => {
    fs.mkdirSync(path.join(hotStore().hotRootDir, 'junk'), { recursive: true });
    validateHotRendererOnStartup();
    expect(fs.existsSync(hotStore().hotRootDir)).toBe(false);
  });
});

describe('effectiveAppVersion / getActiveHotRendererIndexPath', () => {
  it('覆盖领先 → 生效版本与加载路径取覆盖；无覆盖 → 磁盘版本与 null 路径', () => {
    expect(effectiveAppVersion()).toBe('0.3.5');
    expect(getActiveHotRendererIndexPath()).toBeNull();

    seedHotState('0.3.6');
    expect(effectiveAppVersion()).toBe('0.3.6');
    expect(getActiveHotRendererIndexPath()).toBe(
      path.join(hotStore().versionDir('0.3.6'), 'index.html')
    );

    // 磁盘追上后：加载路径双保险立即失效
    (globalThis as any).__MOCK_DISK_VERSION__ = '0.3.6';
    expect(getActiveHotRendererIndexPath()).toBeNull();
    expect(effectiveAppVersion()).toBe('0.3.6');
  });
});
