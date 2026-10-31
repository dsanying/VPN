import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { compareSemver } from '../../shared/version';
import { getUserDataPath } from '../utils/paths';
import {
  MAIN_CODE_DIR,
  RendererHotStateStore,
  hashTreeFiles,
  mainCodeUnchanged,
  rendererUnchanged,
} from './renderer-hot';
import type { LogManager } from './LogManager';

/**
 * 渲染端热替换（App 更新免整包重启）。
 *
 * #背景：App 自更新 = 退出 → 换包 → 重启，代理随退出停止（有更新重启状态恢复兜底，但仍是断流重连）。
 * 大量版本只改界面（web/），主进程一行未动——这类版本可以不重启：把新渲染端复制到 userData 外置目录，
 * 主窗口改从外置目录加载并 reload，主进程/代理/托盘全程不动，代理不断流。
 *
 * #兼容守卫（构造性，非版本号约定）：候选包 app.asar 内 dist/main/**（主进程 + preload + shared 编译产物）
 * 与当前运行逐字节一致（排除 build-info 注入文件）才允许热替换。preload 是 IPC 唯一入口且在 dist/main 内，
 * preload 未变 ⇒ 新渲染端可调用的 IPC 面与旧主进程提供的完全一致，不存在新旧协议错配。
 * dist/main 有变化（或无法证明一致）→ 一律走整包安装路径（含更新重启状态恢复）。
 *
 * #平台：macOS（DMG 挂载读取）与 Linux（AppImage 自解压 / dpkg-deb -x）可离线提取候选包 asar；
 * Windows（NSIS/便携单文件）无离线提取手段 → 不支持，走整包路径。
 *
 * #签名/文件锁安全：绝不改动运行中 App 的任何文件（asar 只读），外置目录在 userData（不在签名封印内）；
 * 整包安装延后到「某个 dist/main 有变化的版本」出现时自然发生，届时正常走换包重启。
 *
 * #生命周期：外置覆盖跨会话持久（renderer-hot-state.json）；磁盘版本追上覆盖版本（整包安装真正发生）后，
 * 启动校验清除覆盖与目录，回归原生加载。
 */

/** execFile 的 Promise 包装（stdout 为字符串）。 */
function execFileAsync(cmd: string, args: string[], opts?: { cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', ...opts }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
  });
}

interface ExtractedCandidate {
  /** 可供 fs 透明读取的 app.asar 路径（Electron fs 对 asar 内路径透明）。 */
  asarRoot: string;
  /** 清理挂载点/临时目录。 */
  cleanup: () => void;
}

/** 限深搜索 root 下任意层级的 resources/app.asar（AppImage squashfs-root 与 deb 包内布局不同，不做假设）。 */
function findAppAsar(root: string, maxDepth = 5): string | null {
  const walk = (dir: string, depth: number): string | null => {
    if (depth > maxDepth) return null;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'resources' && fs.existsSync(path.join(abs, 'app.asar'))) {
          return path.join(abs, 'app.asar');
        }
        const found = walk(abs, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root, 0);
}

/**
 * 从下载好的更新包离线提取 app.asar。支持 mac DMG / Linux AppImage / Linux deb；
 * Windows 与未知形态返回 null（调用方走整包安装路径）。
 * 导出供真机 e2e 驱动复用（提取是平台执行项，jest 只能测其上的纯逻辑）。
 */
export async function extractCandidateAsar(packagePath: string): Promise<ExtractedCandidate | null> {
  if (process.platform === 'win32') return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-vpn-hotswap-'));
  const cleanup = (extra?: string | null) => () => {
    if (extra) {
      try {
        execFileAsync('hdiutil', ['detach', extra, '-force']).catch(() => {});
      } catch {
        /* detach 失败留挂载点，重启自然消失 */
      }
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败无害 */
    }
  };
  try {
    if (process.platform === 'darwin') {
      if (!packagePath.endsWith('.dmg')) return null;
      // -readonly 挂载到私有临时目录；stdout 每行「dev\t挂载点」，取 /tmp|/var 下的挂载点。
      const out = await execFileAsync('hdiutil', [
        'attach',
        packagePath,
        '-readonly',
        '-nobrowse',
        '-noautoopen',
        '-mountrandom',
        tmp,
      ]);
      const lines = out.split('\n').map((l) => l.split('\t').pop()?.trim() ?? '');
      const mountPoint = lines.reverse().find((p) => p.startsWith('/'));
      if (!mountPoint) return null;
      let appBundle: string | null = null;
      for (const entry of fs.readdirSync(mountPoint, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.endsWith('.app')) {
          appBundle = path.join(mountPoint, entry.name);
          break;
        }
      }
      const asar = appBundle ? path.join(appBundle, 'Contents', 'Resources', 'app.asar') : null;
      if (!asar || !fs.existsSync(asar)) {
        cleanup(mountPoint)();
        return null;
      }
      return { asarRoot: asar, cleanup: cleanup(mountPoint) };
    }
    // Linux：AppImage 自解压（type 2 runtime 内建 --appimage-extract，输出 <cwd>/squashfs-root）。
    if (packagePath.endsWith('.AppImage')) {
      fs.chmodSync(packagePath, 0o755);
      await execFileAsync(packagePath, ['--appimage-extract'], { cwd: tmp });
      const asar = findAppAsar(path.join(tmp, 'squashfs-root'));
      if (!asar) {
        cleanup(null)();
        return null;
      }
      return { asarRoot: asar, cleanup: cleanup(null) };
    }
    // deb：dpkg-deb -x 解包（debian 系自带；AppImage 运行态用户不会拿到 deb 资产，双守卫见 UpdateService）。
    if (packagePath.endsWith('.deb')) {
      await execFileAsync('dpkg-deb', ['-x', packagePath, tmp]);
      const asar = findAppAsar(tmp);
      if (!asar) {
        cleanup(null)();
        return null;
      }
      return { asarRoot: asar, cleanup: cleanup(null) };
    }
    return null;
  } catch (error) {
    cleanup(null)();
    throw error;
  }
}

export type HotSwapOutcome = 'applied' | 'main-changed' | 'failed';

/**
 * 从「当前运行根」与「候选包 asar 根」两棵树执行热替换判定与落地（纯编排，fs/路径全注入 → 可单测）。
 * - applied：dist/main 一致且渲染端有差异 → 复制渲染端 + 写覆盖标记
 * - main-changed：主进程代码有差异（或任一侧 dist/main 为空无法证明一致）→ 不热替换
 * - failed：中途 IO 异常（已尽力清理，不落半截状态）
 */
export async function applyHotSwapFromRoots(deps: {
  currentRoot: string;
  candidateRoot: string;
  version: string;
  userDataDir: string;
  log?: (message: string) => void;
  fsMod?: typeof fs;
}): Promise<HotSwapOutcome> {
  const fsm = deps.fsMod ?? fs;
  const log = deps.log ?? (() => {});
  // 全树哈希（主进程 + 渲染端），再按目录切面比较。
  const toMap = (root: string): Map<string, string> =>
    new Map(hashTreeFiles(fsm, root).map((e) => [e.rel, e.hash]));
  const mainOf = (m: Map<string, string>): Map<string, string> =>
    new Map([...m].filter(([rel]) => rel.startsWith(`${MAIN_CODE_DIR}/`)));
  const currentAll = toMap(deps.currentRoot);
  const candidateAll = toMap(deps.candidateRoot);
  if (!mainCodeUnchanged(mainOf(currentAll), mainOf(candidateAll))) {
    log('主进程代码存在差异（或无法证明一致），走整包安装');
    return 'main-changed';
  }
  if (rendererUnchanged(currentAll, candidateAll)) {
    // 渲染端也一致（同版本重装等）：热替换无意义，交整包路径收尾（同版本安装是幂等重建）。
    log('候选包与当前运行内容一致，无需热替换');
    return 'main-changed';
  }

  const store = new RendererHotStateStore(deps.userDataDir, fsm);
  const version = deps.version.replace(/^v/, '');
  const staging = store.versionDir(`.${version}.staging`);
  const dest = store.versionDir(version);
  try {
    fsm.mkdirSync(store.hotRootDir, { recursive: true });
    fsm.rmSync(staging, { recursive: true, force: true });
    fsm.rmSync(dest, { recursive: true, force: true });
    // 从候选 asar 复制 dist/renderer → 暂存目录（readFileSync+writeFileSync：Electron fs 对 asar 读透明，
    // 不用 copyFileSync 以避免 asar 源兼容性差异）。
    const rendererSrc = path.join(deps.candidateRoot, 'dist', 'renderer');
    const copyTree = (src: string, dst: string): void => {
      fsm.mkdirSync(dst, { recursive: true });
      for (const entry of fsm.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyTree(s, d);
        else if (entry.isFile()) fsm.writeFileSync(d, fsm.readFileSync(s));
      }
    };
    copyTree(rendererSrc, staging);
    if (!fsm.existsSync(path.join(staging, 'index.html'))) {
      fsm.rmSync(staging, { recursive: true, force: true });
      log('候选渲染端缺 index.html，放弃热替换');
      return 'failed';
    }
    fsm.renameSync(staging, dest); // 暂存 → 正式（同目录 rename 原子）
    // 只保留当前版本目录，清历史（含上次中断的 .staging）。
    for (const entry of fsm.readdirSync(store.hotRootDir)) {
      if (entry !== version)
        fsm.rmSync(path.join(store.hotRootDir, entry), { recursive: true, force: true });
    }
    store.write({ schema: 1, version, dirName: version, appliedAt: new Date().toISOString() });
    log(`渲染端热替换完成: v${version}（dist/main 逐字节一致，主进程不动，reload 生效）`);
    return 'applied';
  } catch (error) {
    try {
      fsm.rmSync(staging, { recursive: true, force: true });
    } catch {
      /* 清理失败无害：staging 不进加载路径 */
    }
    log(
      `渲染端热替换失败（回退整包安装）: ${error instanceof Error ? error.message : String(error)}`
    );
    return 'failed';
  }
}

/**
 * UpdateService 安装入口调用：先离线提取候选包，再执行热替换判定。
 * 'main-changed' / 'failed' / 'unsupported' 都回退调用方既有整包安装路径。
 */
export async function tryRendererHotSwap(
  packagePath: string,
  version: string,
  logManager: LogManager
): Promise<'applied' | 'main-changed' | 'unsupported' | 'failed'> {
  if (!app.isPackaged || process.platform === 'win32') return 'unsupported';
  let candidate: ExtractedCandidate | null;
  try {
    candidate = await extractCandidateAsar(packagePath);
  } catch (error) {
    logManager.addLog(
      'warn',
      `候选更新包提取失败（回退整包安装）: ${error instanceof Error ? error.message : String(error)}`,
      'UpdateService'
    );
    return 'failed';
  }
  if (!candidate) return 'unsupported';
  try {
    return await applyHotSwapFromRoots({
      currentRoot: app.getAppPath(),
      candidateRoot: candidate.asarRoot,
      version,
      userDataDir: getUserDataPath(),
      log: (message) => logManager.addLog('info', message, 'UpdateService'),
    });
  } finally {
    candidate.cleanup();
  }
}

/**
 * 启动校验：磁盘版本已追上覆盖版本（整包安装真正发生）→ 清覆盖与外置目录，回归原生加载；
 * 覆盖仍领先磁盘版本 → 保留（重启/崩溃重开继续用新界面，不重下）。状态损坏同样清。
 */
export function validateHotRendererOnStartup(logManager?: LogManager): void {
  const store = new RendererHotStateStore(getUserDataPath());
  const state = store.load();
  const diskVersion = app.getVersion();
  if (state && compareSemver(state.version, diskVersion) <= 0) {
    store.clear();
    logManager?.addLog(
      'info',
      `磁盘版本 v${diskVersion} 已包含热更渲染端 v${state.version}，清除外置覆盖`,
      'UpdateService'
    );
    return;
  }
  if (!state) {
    // 无有效状态：外置目录是死重（上次热替换中断/状态损坏），顺手清。
    try {
      if (fs.existsSync(store.hotRootDir))
        fs.rmSync(store.hotRootDir, { recursive: true, force: true });
    } catch {
      /* 无害 */
    }
  }
}

/**
 * 生效版本：热更覆盖领先磁盘版本时返回覆盖版本（更新检查用它判「已是最新」，避免对已热更版本
 * 重复弹窗重复下载）；否则返回磁盘版本。关于页版本展示同样用它，避免「界面是新的、版本号是旧的」错位。
 */
export function effectiveAppVersion(): string {
  const state = new RendererHotStateStore(getUserDataPath()).load();
  const diskVersion = app.getVersion();
  return state && compareSemver(state.version, diskVersion) > 0 ? state.version : diskVersion;
}

/** 主窗口渲染端加载路径：有有效热更覆盖 → 外置 index.html；否则 asar 内原生路径。 */
export function getActiveHotRendererIndexPath(): string | null {
  const store = new RendererHotStateStore(getUserDataPath());
  const state = store.load();
  if (!state) return null;
  // 加载路径的最后一道版本闸：覆盖版本必须领先磁盘版本（启动校验负责清理，这里双保险）。
  return compareSemver(state.version, app.getVersion()) > 0
    ? path.join(store.versionDir(state.dirName), 'index.html')
    : null;
}
