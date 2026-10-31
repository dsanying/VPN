import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * 渲染端热替换核心（纯逻辑，不 import electron，可独立单测）。
 *
 * 设计（详见 renderer-hot-swap.ts 头注释）：App 自更新候选包若 dist/main（主进程全部运行代码，
 * 含 preload/shared）与当前运行的逐字节一致，则只把候选包的 dist/renderer 复制到 userData 外置目录、
 * 主窗口改从该目录加载——主进程/代理全程不动，免整包重启。
 *
 * dist/main 一致性是「新渲染端兼容旧主进程」的构造性守卫：preload 是 IPC 的唯一入口且在 dist/main
 * 内，preload 未变 ⇒ 新渲染端可调用的 IPC 面与旧主进程提供的完全一致。
 * build-info.js（BUILD_DATE/BUILD_COMMIT 注入）随构建日期必然变化，参与比较会永远判不等，排除。
 */

/** 主进程代码目录（asar 内相对路径）。preload.js / preload-update-popup.js / shared 都在其下。 */
export const MAIN_CODE_DIR = 'dist/main';

export interface TreeFileEntry {
  /** 相对 root 的 POSIX 风格路径（'/' 分隔）。 */
  rel: string;
  hash: string;
}

/** build-info 注入文件：每次构建必然不同（构建日期），排除后同源代码构建结果逐字节一致。 */
export function isBuildInfoArtifact(rel: string): boolean {
  return /(^|\/)shared\/build-info\.js(\.map)?$/.test(rel);
}

/** 递归枚举 root 下全部文件并逐个 sha256（fsMod 注入：Electron 的 fs 对 asar 内路径透明）。 */
export function hashTreeFiles(fsMod: typeof fs, root: string, relPrefix = ''): TreeFileEntry[] {
  const out: TreeFileEntry[] = [];
  const walk = (rel: string): void => {
    const abs = rel ? path.join(root, rel) : root;
    let entries: fs.Dirent[];
    try {
      entries = fsMod.readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // 目录缺失（如该树没有 dist/main）→ 该切面为空，由调用方按「无法证明一致」处置
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.isFile()) {
        const hash = createHash('sha256')
          .update(fsMod.readFileSync(path.join(root, childRel)))
          .digest('hex');
        out.push({ rel: childRel, hash });
      }
      // 符号链接等非常规项：asar 内不存在、真实目录不该有，跳过（比较以常规文件为准）。
    }
  };
  walk(relPrefix);
  out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return out;
}

/** 提取某棵树里主进程代码（dist/main/**）的 {rel → hash} 表。 */
export function hashMainCode(fsMod: typeof fs, asarRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { rel, hash } of hashTreeFiles(fsMod, asarRoot, MAIN_CODE_DIR)) map.set(rel, hash);
  return map;
}

/**
 * 主进程代码是否逐字节一致（排除 build-info 注入文件）。
 * 空表（dist/main 不存在/为空）不算一致——无法证明兼容时调用方必须走整包安装。
 */
export function mainCodeUnchanged(
  current: Map<string, string>,
  candidate: Map<string, string>
): boolean {
  if (current.size === 0 || candidate.size === 0) return false;
  const curReal = [...current.keys()].filter((rel) => !isBuildInfoArtifact(rel));
  const candReal = [...candidate.keys()].filter((rel) => !isBuildInfoArtifact(rel));
  if (curReal.length !== candReal.length) return false;
  return curReal.every((rel) => candidate.get(rel) === current.get(rel));
}

/** 渲染端树是否一致（一致则热替换无意义，走整包安装收尾）。 */
export function rendererUnchanged(
  current: Map<string, string>,
  candidate: Map<string, string>
): boolean {
  const pick = (m: Map<string, string>) =>
    [...m.entries()].filter(([rel]) => !rel.startsWith(`${MAIN_CODE_DIR}/`));
  const a = pick(current);
  const b = pick(candidate);
  if (a.length !== b.length) return false;
  const bm = new Map(b);
  return a.every(([rel, hash]) => bm.get(rel) === hash);
}

/** 热替换覆盖状态（userData/renderer-hot-state.json）。 */
export interface RendererHotState {
  schema: 1;
  /** 覆盖渲染端所属版本（无 v 前缀）。 */
  version: string;
  /** renderer-hot/ 下的目录名（= 版本号）。 */
  dirName: string;
  /** 写入时刻 ISO。 */
  appliedAt: string;
}

/** dirName 白名单：只允许版本号形态，杜绝路径穿越。 */
function isSafeDirName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..');
}

/**
 * 覆盖状态读写（原子写 + 失败安全，与 update-restart-state 同套路）。
 * userDataDir / fsMod 注入 → 不依赖 electron，可独立单测。
 */
export class RendererHotStateStore {
  constructor(
    private readonly userDataDir: string,
    private readonly fsMod: typeof fs = fs
  ) {}

  get hotRootDir(): string {
    return path.join(this.userDataDir, 'renderer-hot');
  }

  versionDir(dirName: string): string {
    return path.join(this.hotRootDir, dirName);
  }

  private get filePath(): string {
    return path.join(this.userDataDir, 'renderer-hot-state.json');
  }

  write(state: RendererHotState): void {
    const tmp = `${this.filePath}.tmp`;
    this.fsMod.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    this.fsMod.renameSync(tmp, this.filePath);
  }

  clear(): void {
    // 状态文件 + 全部外置渲染目录一起清（调用时机：磁盘版本已追上 / 状态损坏）。
    try {
      this.fsMod.rmSync(this.hotRootDir, { recursive: true, force: true });
    } catch {
      /* 清理失败不阻断；无状态文件后覆盖目录只是死重，下次触发再清。 */
    }
    try {
      this.fsMod.rmSync(this.filePath, { force: true });
    } catch {
      /* 同上 */
    }
  }

  /**
   * 读取有效覆盖状态；无效（损坏/穿越/目录缺失/缺 index.html）返回 null（不主动清文件，
   * 清理决策在调用方——启动校验与热替换写入各自处置）。
   */
  load(): RendererHotState | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fsMod.readFileSync(this.filePath, 'utf8'));
    } catch {
      return null;
    }
    const state = parsed as Partial<RendererHotState> | null;
    if (
      !state ||
      state.schema !== 1 ||
      typeof state.version !== 'string' ||
      !state.version ||
      typeof state.dirName !== 'string' ||
      !isSafeDirName(state.dirName) ||
      typeof state.appliedAt !== 'string'
    )
      return null;
    try {
      if (!this.fsMod.existsSync(path.join(this.versionDir(state.dirName), 'index.html')))
        return null;
    } catch {
      return null;
    }
    return state as RendererHotState;
  }
}
