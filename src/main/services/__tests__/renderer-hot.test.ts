import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// applyHotSwapFromRoots 本身不碰 electron，但其宿主模块顶层 import electron → jest 需要 mock 存在。
jest.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0',
    isPackaged: true,
    getAppPath: () => os.tmpdir(),
  },
}));
import {
  RendererHotStateStore,
  hashMainCode,
  hashTreeFiles,
  mainCodeUnchanged,
  rendererUnchanged,
} from '../renderer-hot';
import { applyHotSwapFromRoots } from '../renderer-hot-swap';

function dir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-renhot-'));
}

/** 造一棵 asar 布局树：dist/main（主进程）+ dist/renderer（渲染端）。 */
function makeAppTree(
  root: string,
  opts: {
    mainFile?: string;
    buildInfo?: string;
    rendererHtml?: string;
    rendererAsset?: string;
    withMain?: boolean;
  } = {}
): void {
  if (opts.withMain !== false) {
    fs.mkdirSync(path.join(root, 'dist', 'main', 'main'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist', 'main', 'shared'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'dist', 'main', 'main', 'index.js'),
      opts.mainFile ?? 'MAIN-V1'
    );
    fs.writeFileSync(path.join(root, 'dist', 'main', 'main', 'preload.js'), 'PRELOAD-V1');
    fs.writeFileSync(
      path.join(root, 'dist', 'main', 'shared', 'build-info.js'),
      opts.buildInfo ?? 'BUILD-DATE-1'
    );
  }
  fs.mkdirSync(path.join(root, 'dist', 'renderer', 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'dist', 'renderer', 'index.html'),
    opts.rendererHtml ?? '<html>V1</html>'
  );
  fs.writeFileSync(
    path.join(root, 'dist', 'renderer', 'assets', 'a.js'),
    opts.rendererAsset ?? 'ASSET-V1'
  );
}

describe('hashTreeFiles / hashMainCode', () => {
  it('递归枚举并按相对路径排序，内容变则 hash 变', () => {
    const root = dir();
    makeAppTree(root);
    const files = hashTreeFiles(fs, root);
    expect(files.length).toBe(5);
    const rels = files.map((f) => f.rel);
    expect(rels).toEqual([...rels].sort());
    const before = hashMainCode(fs, root);
    fs.writeFileSync(path.join(root, 'dist', 'main', 'main', 'index.js'), 'MAIN-V2');
    const after = hashMainCode(fs, root);
    expect(after.get('dist/main/main/index.js')).not.toBe(before.get('dist/main/main/index.js'));
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('mainCodeUnchanged — 构造性兼容守卫', () => {
  it('dist/main 逐字节一致（仅 build-info 构建注入不同）→ 一致', () => {
    const cur = dir();
    const cand = dir();
    makeAppTree(cur, { buildInfo: 'BUILD-DATE-1' });
    makeAppTree(cand, { buildInfo: 'BUILD-DATE-99' });
    expect(mainCodeUnchanged(hashMainCode(fs, cur), hashMainCode(fs, cand))).toBe(true);
    fs.rmSync(cur, { recursive: true, force: true });
    fs.rmSync(cand, { recursive: true, force: true });
  });

  it('主进程任一文件变化 → 不一致', () => {
    const cur = dir();
    const cand = dir();
    makeAppTree(cur);
    makeAppTree(cand, { mainFile: 'MAIN-V2' });
    expect(mainCodeUnchanged(hashMainCode(fs, cur), hashMainCode(fs, cand))).toBe(false);
    fs.rmSync(cur, { recursive: true, force: true });
    fs.rmSync(cand, { recursive: true, force: true });
  });

  it('preload 变化（IPC 面变化）→ 不一致', () => {
    const cur = dir();
    const cand = dir();
    makeAppTree(cur);
    makeAppTree(cand, { mainFile: 'MAIN-V1', buildInfo: 'BUILD-DATE-1' });
    fs.writeFileSync(path.join(cand, 'dist', 'main', 'main', 'preload.js'), 'PRELOAD-V2');
    expect(mainCodeUnchanged(hashMainCode(fs, cur), hashMainCode(fs, cand))).toBe(false);
    fs.rmSync(cur, { recursive: true, force: true });
    fs.rmSync(cand, { recursive: true, force: true });
  });

  it('一侧 dist/main 缺失（无法证明一致）→ 不一致', () => {
    const cur = dir();
    const cand = dir();
    makeAppTree(cur);
    makeAppTree(cand, { withMain: false });
    expect(mainCodeUnchanged(hashMainCode(fs, cur), hashMainCode(fs, cand))).toBe(false);
    fs.rmSync(cur, { recursive: true, force: true });
    fs.rmSync(cand, { recursive: true, force: true });
  });

  it('渲染端一致 / 不一致的判定', () => {
    const cur = dir();
    const cand = dir();
    makeAppTree(cur);
    makeAppTree(cand);
    // rendererUnchanged 接收全树哈希（内部按目录切面比较）
    const toMap = (root: string) => new Map(hashTreeFiles(fs, root).map((e) => [e.rel, e.hash]));
    const a = toMap(cur);
    const b = toMap(cand);
    expect(rendererUnchanged(a, b)).toBe(true);
    fs.writeFileSync(path.join(cand, 'dist', 'renderer', 'index.html'), '<html>V2</html>');
    expect(rendererUnchanged(a, toMap(cand))).toBe(false);
    fs.rmSync(cur, { recursive: true, force: true });
    fs.rmSync(cand, { recursive: true, force: true });
  });
});

describe('applyHotSwapFromRoots', () => {
  it('main 一致 + renderer 有差异 → applied：复制渲染端、写标记、清暂存与历史版本', () => {
    const cur = dir();
    const cand = dir();
    const userData = dir();
    makeAppTree(cur);
    makeAppTree(cand, { buildInfo: 'BUILD-DATE-99', rendererHtml: '<html>V2</html>' });
    // 预置历史版本目录 + 上次中断的暂存 → 应被清理
    fs.mkdirSync(path.join(userData, 'renderer-hot', '0.0.1'), { recursive: true });
    fs.mkdirSync(path.join(userData, 'renderer-hot', '.0.3.6.staging'), { recursive: true });

    const outcome = applyHotSwapFromRoots({
      currentRoot: cur,
      candidateRoot: cand,
      version: 'v0.3.6',
      userDataDir: userData,
      fsMod: fs,
    });

    expect(outcome).resolves.toBe('applied');
    return outcome.then(() => {
      const hotRoot = path.join(userData, 'renderer-hot');
      // 新渲染端已就位
      expect(fs.readFileSync(path.join(hotRoot, '0.3.6', 'index.html'), 'utf8')).toBe(
        '<html>V2</html>'
      );
      expect(fs.readFileSync(path.join(hotRoot, '0.3.6', 'assets', 'a.js'), 'utf8')).toBe(
        'ASSET-V1'
      );
      // 暂存与历史版本清理，只留当前版本
      expect(fs.readdirSync(hotRoot).sort()).toEqual(['0.3.6']);
      // 状态标记已写
      const state = JSON.parse(
        fs.readFileSync(path.join(userData, 'renderer-hot-state.json'), 'utf8')
      );
      expect(state).toMatchObject({ schema: 1, version: '0.3.6', dirName: '0.3.6' });
      fs.rmSync(cur, { recursive: true, force: true });
      fs.rmSync(cand, { recursive: true, force: true });
      fs.rmSync(userData, { recursive: true, force: true });
    });
  });

  it('main 有差异 → main-changed，不写任何状态', () => {
    const cur = dir();
    const cand = dir();
    const userData = dir();
    makeAppTree(cur);
    makeAppTree(cand, { mainFile: 'MAIN-V2' });
    return applyHotSwapFromRoots({
      currentRoot: cur,
      candidateRoot: cand,
      version: '0.4.0',
      userDataDir: userData,
      fsMod: fs,
    }).then((outcome) => {
      expect(outcome).toBe('main-changed');
      expect(fs.existsSync(path.join(userData, 'renderer-hot-state.json'))).toBe(false);
      fs.rmSync(cur, { recursive: true, force: true });
      fs.rmSync(cand, { recursive: true, force: true });
      fs.rmSync(userData, { recursive: true, force: true });
    });
  });

  it('渲染端缺 index.html → failed，不留暂存', () => {
    const cur = dir();
    const cand = dir();
    const userData = dir();
    makeAppTree(cur);
    makeAppTree(cand, { rendererHtml: '' });
    fs.rmSync(path.join(cand, 'dist', 'renderer', 'index.html'));
    return applyHotSwapFromRoots({
      currentRoot: cur,
      candidateRoot: cand,
      version: '0.4.0',
      userDataDir: userData,
      fsMod: fs,
    }).then((outcome) => {
      expect(outcome).toBe('failed');
      expect(fs.existsSync(path.join(userData, 'renderer-hot', '.0.4.0.staging'))).toBe(false);
      fs.rmSync(cur, { recursive: true, force: true });
      fs.rmSync(cand, { recursive: true, force: true });
      fs.rmSync(userData, { recursive: true, force: true });
    });
  });
});

describe('RendererHotStateStore', () => {
  it('write → load 回读；clear 连状态带目录全清', () => {
    const userData = dir();
    const store = new RendererHotStateStore(userData, fs);
    fs.mkdirSync(path.join(store.hotRootDir, '0.3.6'), { recursive: true });
    fs.writeFileSync(path.join(store.hotRootDir, '0.3.6', 'index.html'), 'x');
    store.write({ schema: 1, version: '0.3.6', dirName: '0.3.6', appliedAt: 'now' });
    expect(store.load()?.version).toBe('0.3.6');
    store.clear();
    expect(store.load()).toBeNull();
    expect(fs.existsSync(store.hotRootDir)).toBe(false);
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('损坏 JSON / 路径穿越 dirName / 缺 index.html → null', () => {
    const userData = dir();
    const store = new RendererHotStateStore(userData, fs);
    fs.writeFileSync(path.join(userData, 'renderer-hot-state.json'), '{ broken');
    expect(store.load()).toBeNull();

    fs.writeFileSync(
      path.join(userData, 'renderer-hot-state.json'),
      JSON.stringify({ schema: 1, version: '1', dirName: '../evil', appliedAt: 'now' })
    );
    expect(store.load()).toBeNull();

    fs.writeFileSync(
      path.join(userData, 'renderer-hot-state.json'),
      JSON.stringify({ schema: 1, version: '1.0.0', dirName: '1.0.0', appliedAt: 'now' })
    );
    expect(store.load()).toBeNull();
    fs.rmSync(userData, { recursive: true, force: true });
  });
});
