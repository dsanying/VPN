import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stageHelperInstallation } from '../helper-install-staging';
describe('提权助手资源暂存', () => {
  let source: string;
  beforeEach(() => {
    source = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-helper-source-'));
    fs.writeFileSync(path.join(source, 'helper'), 'helper');
    fs.writeFileSync(path.join(source, 'core'), 'core');
  });
  afterEach(() => fs.rmSync(source, { recursive: true, force: true }));
  it('以普通用户先复制资源到私有临时目录，校验内容并完整清理', () => {
    const staged = stageHelperInstallation(path.join(source, 'helper'), path.join(source, 'core'));
    expect(staged.directory.startsWith(os.tmpdir())).toBe(true);
    expect(fs.statSync(staged.directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(staged.helper).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(staged.helper, 'utf8')).toBe('helper');
    expect(staged.helperSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(staged.coreSha256).not.toBe(staged.helperSha256);
    staged.dispose();
    expect(fs.existsSync(staged.directory)).toBe(false);
  });
  it('拒绝符号链接资源，第二份复制失败时不残留暂存目录', () => {
    const link = path.join(source, 'link');
    fs.symlinkSync(path.join(source, 'helper'), link);
    expect(() => stageHelperInstallation(link, path.join(source, 'core'))).toThrow(
      '安装资源不是普通文件'
    );
    const before = fs
      .readdirSync(os.tmpdir())
      .filter((name) => name.startsWith('shadowvpn-helper-install-'));
    expect(() =>
      stageHelperInstallation(path.join(source, 'helper'), path.join(source, 'missing'))
    ).toThrow();
    expect(
      fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('shadowvpn-helper-install-'))
    ).toEqual(before);
  });
});
