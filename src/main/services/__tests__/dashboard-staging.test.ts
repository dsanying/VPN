import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { stageDashboard } from '../dashboard-staging';

describe('提权内核面板资源', () => {
  let root: string;
  let source: string;
  let cache: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-dashboard-'));
    source = path.join(root, 'Desktop', 'resources');
    cache = path.join(root, 'Application Support', 'dashboard');
    await fs.mkdir(path.join(source, 'assets'), { recursive: true });
    await fs.writeFile(path.join(source, 'index.html'), '<script src="assets/main.js"></script>');
    await fs.writeFile(path.join(source, 'assets', 'main.js'), 'example');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  it('完整复制出受保护源码目录，复用相同内容，资源变化时创建新版本', async () => {
    const staged = await stageDashboard(source, cache);
    expect(staged.startsWith(cache + path.sep)).toBe(true);
    expect(await fs.readFile(path.join(staged, 'assets', 'main.js'), 'utf8')).toBe('example');
    expect(await stageDashboard(source, cache)).toBe(staged);
    await fs.writeFile(path.join(source, 'assets', 'main.js'), 'changed');
    const updated = await stageDashboard(source, cache);
    expect(updated).not.toBe(staged);
    expect(await fs.readFile(path.join(updated, 'assets', 'main.js'), 'utf8')).toBe('changed');
    expect(await fs.readFile(path.join(staged, 'assets', 'main.js'), 'utf8')).toBe('example');
    expect((await fs.readdir(cache)).some((name) => name.startsWith('.stage-'))).toBe(false);
  });
  it('拒绝仍指向源码的软链接及缺失入口，不发布残缺资源', async () => {
    await fs.symlink(path.join(source, 'assets', 'main.js'), path.join(source, 'link.js'));
    await expect(stageDashboard(source, cache)).rejects.toThrow('symbolic links');
    await fs.unlink(path.join(source, 'link.js'));
    await fs.unlink(path.join(source, 'index.html'));
    await expect(stageDashboard(source, cache)).rejects.toThrow();
    await expect(fs.stat(cache)).rejects.toThrow();
  });
});
