import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

/** 将随包静态面板复制到应用数据目录，供受 macOS TCC 限制的提权内核读取。 */
export async function stageDashboard(source: string, cacheRoot: string): Promise<string> {
  const fingerprint = createHash('sha256');
  async function visit(relative: string): Promise<void> {
    const dir = path.join(source, relative);
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink())
        throw new Error('Dashboard assets must not contain symbolic links');
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(path.join(source, name));
        fingerprint.update(name).update('\0').update(createHash('sha256').update(bytes).digest());
      } else throw new Error('Dashboard assets must be regular files');
    }
  }
  await visit('');
  if (!(await fs.stat(path.join(source, 'index.html'))).isFile())
    throw new Error('Dashboard index is missing');
  const target = path.join(cacheRoot, fingerprint.digest('hex'));
  const ready = async () => {
    try {
      return (await fs.stat(path.join(target, 'index.html'))).isFile();
    } catch {
      return false;
    }
  };
  if (await ready()) return target;
  await fs.mkdir(cacheRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(cacheRoot, '.stage-'));
  try {
    await fs.cp(source, staging, { recursive: true, dereference: false });
    // 只有完整复制后才发布，避免异常启动留下半份面板。
    try {
      await fs.rename(staging, target);
    } catch (error) {
      if (!(await ready())) throw error;
    }
    return target;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
