/**
 * 原子写文件：写**唯一后缀** .tmp（默认 pid+随机）→ rename 替换正本 → 失败清理 .tmp。
 *
 * 唯一后缀杜绝多 writer（跨实例/并发写）写同一 .tmp 致字节交错损坏正本——各 writer 写各自临时文件，
 * rename 各自原子落地（同分区 POSIX rename 原子）。默认不 flush；关键保护记录可以选择 flush，
 * 在确认前同步文件，并在支持目录 fsync 的平台同步替换后的目录。
 *
 * mode：传入时在 open(2) 即生效（umask 只清位不加位）→ tmp 从创建起就是该权限，绝不出现宽权限携密窗口；
 * 非 Windows 额外 chmod 双保险（兼容旧 fd 语义）。
 *
 * makeTmpSuffix：允许调用方定制 .tmp 前的后缀片段（默认 `<pid>.<rand6hex>`）。供 ConfigManager 保留其
 * `<rand6hex>` 后缀以匹配既有 sweepStaleTmpFiles 清扫正则（行为字节保持）。
 */
import * as fs from 'fs/promises';
import { randomBytes } from 'crypto';
import { dirname } from 'path';

export interface WriteFileAtomicOptions {
  /** Sync critical state to disk before acknowledging the replacement. */
  flush?: boolean;
  /** 文件权限（如 0o600）；传入则 write 时即生效 + 非 Windows chmod 双保险。 */
  mode?: number;
  /** .tmp 前缀片段生成器（默认 `<pid>.<rand6hex>`）。 */
  makeTmpSuffix?: () => string;
}

const defaultTmpSuffix = (): string => `${process.pid}.${randomBytes(6).toString('hex')}`;

export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  opts?: WriteFileAtomicOptions
): Promise<void> {
  const suffix = (opts?.makeTmpSuffix ?? defaultTmpSuffix)();
  const tmp = `${filePath}.${suffix}.tmp`;
  try {
    const options =
      opts?.mode !== undefined || opts?.flush
        ? {
            ...(opts?.mode !== undefined ? { mode: opts.mode } : {}),
            ...(opts?.flush ? { flush: true } : {}),
          }
        : undefined;
    await fs.writeFile(tmp, data, options);
    if (opts?.mode !== undefined && process.platform !== 'win32') {
      await fs.chmod(tmp, opts.mode);
    }
    await fs.rename(tmp, filePath);
    if (opts?.flush && process.platform !== 'win32') {
      const directory = await fs.open(dirname(filePath), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (e) {
    await fs.unlink(tmp).catch(() => {}); // 清理半写 tmp，避免脏文件堆积
    throw e;
  }
}
