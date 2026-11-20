import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sha256File } from '../../shared/file-hash';
import { corePinsJson } from '../../shared/core-pins';

/** 由应用读取资源，管理员脚本只读取不受 Desktop/Downloads TCC 限制的私有临时文件。 */
export function stageHelperInstallation(
  helper: string,
  core: string,
  activeCoreDir?: string
): {
  directory: string;
  helper: string;
  core: string;
  pins: string;
  helperSha256: string;
  coreSha256: string;
  dispose: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowvpn-helper-install-'));
  fs.chmodSync(directory, 0o700);
  const dispose = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const copy = (source: string, name: string) => {
      if (!fs.lstatSync(source).isFile()) throw new Error('安装资源不是普通文件');
      const digest = sha256File(source);
      const destination = path.join(directory, name);
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
      if (sha256File(destination) !== digest) throw new Error('安装资源校验失败');
      return { destination, digest };
    };
    const helperFile = copy(helper, 'helper');
    const coreFile = copy(core, 'sing-box');
    // pins.json 由两份 manifest 合并生成，并入现役受保护核（若有）→ 同版本重装/回滚不被拒。
    const pinsPath = path.join(directory, 'core-pins.json');
    fs.writeFileSync(pinsPath, corePinsJson(activeCoreDir), { mode: 0o600, flag: 'wx' });
    return {
      directory,
      helper: helperFile.destination,
      core: coreFile.destination,
      pins: pinsPath,
      helperSha256: helperFile.digest,
      coreSha256: coreFile.digest,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
